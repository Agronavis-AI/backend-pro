import path from 'node:path';
import * as ort from 'onnxruntime-node';
import type { Sharp } from 'sharp';
import { logger } from '../../config/logger';

/**
 * Second opinion on whether a photograph shows a crop, asked before the disease
 * model is allowed one.
 *
 * The disease model cannot answer this itself. It was trained on 86 leaf classes
 * and nothing else, so it has no label for "not a leaf" and no score that means
 * one — measured directly, a grey wall came back with a higher top logit than a
 * healthy leaf. The colour gate in diagnose.service.ts catches the common
 * misfires cheaply, but colour is only colour: a green shirt or a painted wall
 * passes it comfortably.
 *
 * So the question goes to a model that has seen the rest of the world.
 * MobileNetV2 on ImageNet is 13 MB and knows a thousand everyday things.
 *
 * It is deliberately asked the negative question. Nothing is refused for failing
 * to look like a plant — ImageNet has no class for "rice leaf at 20 cm", and a
 * close-up of diseased tissue may match nothing it knows, which under a
 * plant-score threshold would refuse exactly the photographs this exists to
 * read. A frame is refused only when the model is confidently looking at
 * something a crop photograph cannot contain, and the colour gate found almost
 * no vegetation to argue otherwise. All three conditions must hold at once.
 *
 * The asymmetry is the point. Set too loosely this misses some non-crops, which
 * is exactly where the scanner already stood. It cannot begin refusing real
 * leaves, because a leaf does not score 40% on "sweatshirt".
 */
const MODEL_PATH = path.join(__dirname, '../../../model/mobilenetv2-12.onnx');

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const SIDE = 224;

/**
 * ImageNet-1k classes that a photograph of a crop cannot be.
 *
 * ImageNet has no class for a person, so a photograph of one lands on what
 * people wear; the rest are the manufactured things a phone sees indoors. Fruit,
 * vegetables, fungi, flowers and flowerpots are deliberately absent — a crop
 * photograph may legitimately be any of those.
 */
const NOT_CROP_CLASSES = new Set([
  // Worn — what a selfie actually scores on
  834, // suit
  836, // sunglass
  837, // sunglasses
  841, // sweatshirt
  610, // jersey, T-shirt
  617, // lab coat
  869, // trench coat
  474, // cardigan
  906, // Windsor tie
  457, // bow tie
  515, // cowboy hat
  808, // sombrero
  433, // bathing cap
  796, // ski mask
  903, // wig
  445, // bikini
  638, // maillot
  400, // academic gown
  655, // miniskirt
  775, // sarong
  // Screens and desks
  664, // monitor
  761, // television
  620, // laptop
  527, // desktop computer
  508, // computer keyboard
  673, // mouse
  526, // desk
  532, // dining table
  // Furnishings and paper
  831, // studio couch
  703, // park bench
  846, // table lamp
  905, // window shade
  750, // quilt
  721, // pillow
  434, // bath towel
  922, // book jacket
  549, // envelope
  923, // menu
  692, // packet
  478, // carton
]);

let session: ort.InferenceSession | null = null;
let loadFailed = false;

/** Loaded on the first scan, so a missing file cannot stop the API booting. */
async function ready(): Promise<boolean> {
  if (session) return true;
  if (loadFailed) return false;
  try {
    session = await ort.InferenceSession.create(MODEL_PATH, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    });
    logger.info('Plant gate model loaded');
    return true;
  } catch (error) {
    loadFailed = true;
    logger.error('Plant gate model failed to load', { error: (error as Error).message });
    return false;
  }
}

export type PlantGate = {
  /** False when the model could not be asked; the caller then does not gate. */
  available: boolean;
  /** The strongest ImageNet class, and how sure it is. */
  topClass: number;
  topScore: number;
  /** True when that class is one a crop photograph cannot contain. */
  topIsNotCrop: boolean;
};

/**
 * Scores one already-decoded image. Takes the sharp pipeline rather than a
 * buffer so the photograph is decoded once and shared with the disease model.
 */
export async function scorePlant(image: Sharp): Promise<PlantGate> {
  if (!(await ready()) || !session) {
    return { available: false, topClass: -1, topScore: 0, topIsNotCrop: false };
  }

  const { data } = await image
    .clone()
    .resize(SIDE, SIDE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const tensor = new Float32Array(3 * SIDE * SIDE);
  const plane = SIDE * SIDE;
  for (let i = 0; i < plane; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      tensor[c * plane + i] = (data[i * 3 + c]! / 255 - MEAN[c]!) / STD[c]!;
    }
  }

  const output = await session.run({
    [session.inputNames[0]!]: new ort.Tensor('float32', tensor, [1, 3, SIDE, SIDE]),
  });
  const logits = output[session.outputNames[0]!]!.data as Float32Array;

  let max = -Infinity;
  for (let i = 0; i < logits.length; i += 1) if (logits[i]! > max) max = logits[i]!;

  let total = 0;
  let topClass = 0;
  for (let i = 0; i < logits.length; i += 1) {
    total += Math.exp(logits[i]! - max);
    if (logits[i]! > logits[topClass]!) topClass = i;
  }

  const topScore = Math.exp(logits[topClass]! - max) / total;

  return {
    available: true,
    topClass,
    topScore,
    topIsNotCrop: NOT_CROP_CLASSES.has(topClass),
  };
}
