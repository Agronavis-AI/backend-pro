import path from 'node:path';
import fs from 'node:fs';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import type { DiseasePrediction } from '@agronavis/shared-types';
import { logger } from '../../config/logger';
import {
  labelsFromV1,
  parseLabelSet,
  readableClass,
  readForCrop,
  softmax,
  cropKey,
  type LabelSet,
} from './disease-labels';
import { scorePlant, type PlantGate } from './plant-gate.service';

export { readableClass } from './disease-labels';

/**
 * Plant disease classification, run inside this process.
 *
 * The model was trained in PyTorch and is served here as ONNX. The original
 * service around it needed torch and CLIP, about 1.1 GB before a request
 * arrives, which will not start on a 512 MB instance. Exported to ONNX the same
 * weights are 43 MB and run under onnxruntime in roughly 120 MB, so the API
 * keeps one service instead of depending on a second one being alive.
 *
 * Two generations of weights can sit in model/:
 *  · v1 — the original ResNet-18, trained on lab photographs of single leaves.
 *  · v2 — trained by ml/disease/train_disease_v2.ipynb on field photographs,
 *    with the crops West Bengal actually grows. Used whenever its files are
 *    present; v1 is the fallback, so dropping v2 in needs no code change.
 */
const MODEL_DIR = path.join(__dirname, '../../../model');
const V1_MODEL = path.join(MODEL_DIR, 'plant_disease_resnet18.onnx');
const V1_CLASSES = path.join(MODEL_DIR, 'class_names.json');
const V2_MODEL = path.join(MODEL_DIR, 'v2', 'disease_v2.onnx');
const V2_LABELS = path.join(MODEL_DIR, 'v2', 'labels.json');

/**
 * Below this the answer is not worth putting in front of a farmer.
 *
 * The classifier has no way to say "this is not a leaf" — every image is forced
 * into one of 86 classes — so a photograph of a hand or the sky still produces a
 * winner. On random noise the top class came out at 33%, so anything under half
 * is treated as no answer rather than a quiet guess.
 */
const MIN_CONFIDENCE = 0.5;


/**
 * How much of the frame looks like a plant.
 *
 * The classifier must return one of its 86 labels for any image at all, so a
 * photograph of a hand, a wall or the sky still produces a winner — the
 * original service answered this with CLIP, which needs 600 MB of weights and
 * will not start alongside this API on a small instance.
 *
 * The excess green index is the standard cheap test for vegetation in the field
 * and costs one pass over the pixels. It is taken on chromaticity — each channel
 * over the pixel's total — rather than on the raw channels, which makes it a
 * question of colour alone and not of how bright the photograph is. On raw
 * channels a grey wall sits near zero and sensor noise alone pushes a third of
 * its pixels over any low threshold; normalised, grey is zero however noisy or
 * dark it is, and a leaf in shade scores the same as a leaf in sun.
 *
 * It stays green-led on purpose. An earlier version also counted any warm pixel
 * — red above blue, green above blue — so that browning tissue would pass, but
 * that rule is a textbook description of human skin, and a selfie came back as
 * healthy rice at 78%. Skin, bare wood and earth all sit red-dominant with blue
 * high enough to push the index negative, while leaf tissue from deep green
 * through chlorotic yellow keeps blue low enough to stay above it, so the one
 * index separates them without a second rule carving the first one back.
 *
 * What this gives up is fully necrotic tissue — brown, no green left. That
 * photograph is refused with an explanation rather than answered, which is the
 * right way round: a farmer who is told to reframe loses a moment, and a farmer
 * told their face is healthy rice has no reason to trust anything else here.
 */
export function vegetationShare(data: Buffer): number {
  let vegetation = 0;
  const pixels = data.length / 3;

  for (let i = 0; i < data.length; i += 3) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;

    // Near-black pixels carry no usable colour — the ratios below would be
    // mostly sensor noise — so they are counted as not plant rather than
    // amplified into one.
    const total = r + g + b;
    if (total < 90) continue;

    if ((2 * g - r - b) / total > 0.08) vegetation += 1;
  }

  return vegetation / pixels;
}

/**
 * Under this share of the frame, the photograph is treated as not showing a
 * crop. Chosen low on purpose: a farmer holding one leaf against the soil is
 * the normal case, and a wrong rejection is worse than a weak answer the
 * confidence score already qualifies.
 */
const MIN_VEGETATION = 0.15;

/**
 * How sure the second model must be that it is looking at something a crop
 * photograph cannot contain, before that outweighs the colour in the frame.
 * Set high on purpose: a mistaken refusal costs the farmer the scan they came
 * for, and letting a non-crop through only returns the scanner to where it was.
 */
const MIN_NOT_CROP_SCORE = 0.35;

/**
 * Whether the second model's reading outweighs the colour in the frame.
 *
 * Kept as a plain function of the two scores so every branch can be tested
 * without loading 13 MB of weights to find out. All three conditions must hold:
 * the model was actually asked, it is looking at something a crop photograph
 * cannot contain, and it is sure enough to override what the colour said.
 */
export function refusedByGate(gate: PlantGate): boolean {
  return gate.available && gate.topIsNotCrop && gate.topScore >= MIN_NOT_CROP_SCORE;
}

/**
 * How much of the model's belief must sit on the crop the farmer named before
 * the answer counts as confident. Below this the photograph probably is not
 * that crop — or not a leaf the model can read — and a ranking among that
 * crop's diseases would be a guess dressed as a diagnosis.
 */
const MIN_CROP_MASS = 0.3;

let session: ort.InferenceSession | null = null;
let labels: LabelSet | null = null;
let loadFailed = false;

async function open(modelPath: string): Promise<ort.InferenceSession> {
  return ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  });
}

/**
 * Loaded once, on the first scan rather than at boot, so a missing model file
 * cannot stop the API serving everything else. v2 is preferred; if its files
 * are missing or do not agree with each other, v1 answers instead.
 */
async function ready(): Promise<boolean> {
  if (session && labels) return true;
  if (loadFailed) return false;

  if (fs.existsSync(V2_MODEL) && fs.existsSync(V2_LABELS)) {
    try {
      const candidate = await open(V2_MODEL);
      const outputs = (candidate as unknown as { outputMetadata?: { shape?: unknown[] }[] }).outputMetadata?.[0]?.shape;
      const width = Array.isArray(outputs) ? Number(outputs[outputs.length - 1]) : undefined;
      labels = parseLabelSet(
        JSON.parse(fs.readFileSync(V2_LABELS, 'utf8')),
        Number.isFinite(width) && (width as number) > 0 ? width : undefined,
      );
      session = candidate;
      logger.info('Disease model loaded', { version: labels.version, classes: labels.classes.length });
      return true;
    } catch (error) {
      logger.error('Disease model v2 could not be used; falling back to v1', {
        error: (error as Error).message,
      });
      session = null;
      labels = null;
    }
  }

  try {
    labels = labelsFromV1(JSON.parse(fs.readFileSync(V1_CLASSES, 'utf8')) as string[]);
    session = await open(V1_MODEL);
    logger.info('Disease model loaded', { version: labels.version, classes: labels.classes.length });
    return true;
  } catch (error) {
    loadFailed = true;
    session = null;
    labels = null;
    logger.error('Disease model failed to load', { error: (error as Error).message });
    return false;
  }
}

export interface DiagnoseOptions {
  /**
   * What the farmer says this crop is. When the model knows the crop, the
   * answer is chosen among that crop's conditions only.
   */
  crop?: string | null;
}

/**
 * Classifies a leaf photograph.
 *
 * Returns the three strongest classes rather than one: the farmer, who can see
 * the plant, is better placed to choose between "early blight" and "late
 * blight" than a model working from one photograph.
 */
export async function diagnose(image: Buffer, options: DiagnoseOptions = {}): Promise<DiseasePrediction> {
  if (!(await ready()) || !session || !labels) {
    return { available: false, confident: false, plantDetected: true, predictions: [] };
  }
  const side = labels.size;

  // Decoded once, shared with the plant gate below.
  const decoded = sharp(image).removeAlpha();

  // Resize to the training geometry and normalise, channel-planar as the model
  // expects (NCHW), which is not the interleaved order sharp returns.
  const { data } = await decoded
    .clone()
    .resize(side, side, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Checked on the decoded frame, before the classifier is asked anything: if
  // there is no plant here, its answer is noise whatever its confidence says.
  const plantShare = vegetationShare(data);
  if (plantShare < MIN_VEGETATION) {
    return { available: true, confident: false, plantDetected: false, predictions: [] };
  }

  // Colour is only colour. A bright green shirt scores at the top of the index,
  // so this runs on every frame that got past it rather than only on the
  // doubtful ones — skipping the confident ones would skip exactly the case the
  // second model exists to catch. It costs about 20 ms and 13 MB, and it is only
  // allowed to refuse on positive evidence: a confident reading of something a
  // crop photograph cannot contain, never a failure to recognise a leaf.
  const gate = await scorePlant(decoded);
  if (refusedByGate(gate)) {
    logger.info('Scan refused by the plant gate', {
      topClass: gate.topClass,
      topScore: Number(gate.topScore.toFixed(3)),
      vegetation: Number(plantShare.toFixed(3)),
    });
    return { available: true, confident: false, plantDetected: false, predictions: [] };
  }

  const pixels = side * side;
  const input = new Float32Array(3 * pixels);
  for (let i = 0; i < pixels; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      input[c * pixels + i] = (data[i * 3 + c]! / 255 - labels.mean[c]!) / labels.std[c]!;
    }
  }

  const output = await session.run({
    image: new ort.Tensor('float32', input, [1, 3, side, side]),
  });

  const logits = output.logits!.data as Float32Array;
  // A label file that does not match its weights would name the wrong disease
  // for every photograph. Better no answer than that.
  if (logits.length !== labels.classes.length) {
    logger.error('Disease model and labels disagree', {
      outputs: logits.length,
      labels: labels.classes.length,
      version: labels.version,
    });
    return { available: false, confident: false, plantDetected: true, predictions: [] };
  }
  const scores = softmax(logits, labels.temperature);
  const classes = labels.classes;

  const forCrop = options.crop ? readForCrop(scores, labels, options.crop) : null;
  const ranked = (forCrop
    ? forCrop.ranked
    : scores.map((confidence, index) => ({ index, confidence })).sort((a, b) => b.confidence - a.confidence)
  )
    .slice(0, 3)
    .map(({ index, confidence }) => {
      const c = classes[index];
      return c
        ? { classKey: c.key, confidence, crop: c.crop, condition: c.condition, healthy: c.healthy }
        : { classKey: `class_${index}`, confidence, ...readableClass(`class_${index}`) };
    });

  const topSure = (ranked[0]?.confidence ?? 0) >= MIN_CONFIDENCE;
  return {
    available: true,
    confident: forCrop ? topSure && forCrop.cropMass >= MIN_CROP_MASS : topSure,
    plantDetected: true,
    predictions: ranked,
    crop: forCrop ? cropKey(options.crop) : null,
    modelVersion: labels.version,
  };
}
