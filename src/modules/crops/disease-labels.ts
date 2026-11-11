/**
 * What the disease model's outputs mean, and how to read them for one crop.
 *
 * Pure on purpose — no ONNX, no image decoding — so the parts that decide what
 * a farmer is told can be tested on their own.
 *
 * Two label sets exist:
 *  · v1, the original 86 classes (model/class_names.json). Names only; crop
 *    and condition are parsed out of keys like "tomato_late_blight".
 *  · v2, from ml/disease/train_disease_v2.ipynb (model/v2/labels.json). Each
 *    class carries its crop and condition explicitly, plus the calibration
 *    temperature and input geometry the notebook measured.
 */

export interface LabelClass {
  key: string;
  /** Display name, e.g. "Rice". */
  crop: string;
  condition: string;
  healthy: boolean;
}

export interface LabelSet {
  version: string;
  /** Logits are divided by this before softmax; >1 softens an over-sure model. */
  temperature: number;
  size: number;
  mean: [number, number, number];
  std: [number, number, number];
  classes: LabelClass[];
}

const IMAGENET_MEAN: [number, number, number] = [0.485, 0.456, 0.406];
const IMAGENET_STD: [number, number, number] = [0.229, 0.224, 0.225];

/**
 * The training set names some crops twice. Its disease classes say `grape_*`
 * and `bell_pepper_*` while its healthy ones say `healthy_grapes` and
 * `healthy_pepper`, so the same crop reached the farmer as two entries in the
 * library's filter — Grape beside Grapes, Bell Pepper beside Pepper.
 *
 * The class list itself cannot be renamed: its order is the model's output
 * order, and editing it would silently map every prediction to the wrong
 * disease. So the names are reconciled here, at the one place a class key
 * becomes words, which is also what the reference library is seeded from.
 */
const CROP_ALIASES: Record<string, string> = {
  grapes: 'grape',
  pepper: 'bell pepper',
};

const canonical = (crop: string): string => CROP_ALIASES[crop] ?? crop;

/**
 * Turns "tomato_late_blight" into something a farmer reads.
 *
 * The class key stays on the prediction: it is what the scan is filed under and
 * what the reference library is keyed on.
 */
export function readableClass(key: string): { crop: string; condition: string; healthy: boolean } {
  const title = (s: string) =>
    canonical(s.replace(/_/g, ' ').trim().toLowerCase())
      .replace(/\b[a-z]/g, (c) => c.toUpperCase());

  if (key.startsWith('healthy_')) {
    return { crop: title(key.slice('healthy_'.length)), condition: 'Healthy', healthy: true };
  }
  if (key.startsWith('diseased_')) {
    return {
      crop: title(key.slice('diseased_'.length)),
      condition: 'Disease present, not identified',
      healthy: false,
    };
  }

  const parts = key.split('_');
  // The one crop in the set whose name is two words.
  const span = key.startsWith('bell_pepper') ? 2 : 1;
  return {
    crop: title(parts.slice(0, span).join(' ')),
    condition: title(parts.slice(span).join(' ')),
    healthy: false,
  };
}

export function labelsFromV1(keys: string[]): LabelSet {
  return {
    version: 'v1',
    temperature: 1,
    size: 224,
    mean: IMAGENET_MEAN,
    std: IMAGENET_STD,
    classes: keys.map((key) => ({ key, ...readableClass(key) })),
  };
}

/**
 * Reads model/v2/labels.json, rejecting anything that would misread the model.
 * A label file that does not match its weights maps every prediction to the
 * wrong disease, which is worse than no scanner.
 */
export function parseLabelSet(raw: unknown, outputs?: number): LabelSet {
  const r = raw as Partial<LabelSet> & { classes?: Partial<LabelClass>[] };
  if (!r || !Array.isArray(r.classes) || r.classes.length === 0) throw new Error('labels.json has no classes');

  const classes = r.classes.map((c, i) => {
    if (typeof c?.key !== 'string' || typeof c.crop !== 'string' || typeof c.condition !== 'string') {
      throw new Error(`labels.json class ${i} is missing key, crop or condition`);
    }
    return { key: c.key, crop: c.crop, condition: c.condition, healthy: Boolean(c.healthy) };
  });
  if (outputs !== undefined && outputs !== classes.length) {
    throw new Error(`labels.json lists ${classes.length} classes but the model has ${outputs} outputs`);
  }

  const temperature = typeof r.temperature === 'number' && r.temperature > 0 ? r.temperature : 1;
  const triple = (v: unknown, fallback: [number, number, number]) =>
    Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number')
      ? (v as [number, number, number])
      : fallback;

  return {
    version: typeof r.version === 'string' ? r.version : 'v2',
    temperature,
    size: typeof r.size === 'number' && r.size >= 64 ? r.size : 224,
    mean: triple(r.mean, IMAGENET_MEAN),
    std: triple(r.std, IMAGENET_STD),
    classes,
  };
}

/** Softmax over logits divided by the calibration temperature. */
export function softmax(logits: ArrayLike<number>, temperature = 1): number[] {
  const scaled = Array.from(logits, (v) => v / temperature);
  const max = Math.max(...scaled);
  const exps = scaled.map((v) => Math.exp(v - max));
  const total = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / total);
}

/**
 * What a farmer calls their crop, reduced to the name the model uses.
 *
 * The app sends whatever the farmer's crop list says — "Paddy (Dhan)",
 * "Aloo", "Maize" — and the model says "Rice", "Potato", "Corn".
 */
const CROP_WORDS: Record<string, string> = {
  paddy: 'rice', dhan: 'rice', rice: 'rice', chawal: 'rice',
  potato: 'potato', aloo: 'potato', alu: 'potato',
  wheat: 'wheat', gehun: 'wheat', gehu: 'wheat',
  maize: 'corn', corn: 'corn', makka: 'corn', makkai: 'corn',
  tomato: 'tomato', tamatar: 'tomato',
  jute: 'jute', pat: 'jute',
  mustard: 'mustard', sarson: 'mustard', rai: 'mustard',
  brinjal: 'brinjal', eggplant: 'brinjal', baingan: 'brinjal', begun: 'brinjal',
  cotton: 'cotton', kapas: 'cotton',
  sugarcane: 'sugarcane', ganna: 'sugarcane',
  groundnut: 'groundnut', peanut: 'groundnut', moongphali: 'groundnut',
  chilli: 'chilli', chili: 'chilli', mirchi: 'chilli',
  cauliflower: 'cauliflower', gobhi: 'cauliflower',
  grape: 'grape', grapes: 'grape',
  apple: 'apple', bean: 'bean', beans: 'bean', cherry: 'cherry', cucumber: 'cucumber',
  guava: 'guava', lemon: 'lemon', peach: 'peach', pumpkin: 'pumpkin', strawberry: 'strawberry',
};

export function cropKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (/bell\s*pepper|capsicum|shimla/.test(lower)) return 'bell pepper';
  for (const word of lower.split(/[^a-z]+/).filter(Boolean)) {
    const hit = CROP_WORDS[word];
    if (hit) return hit;
  }
  return null;
}

export interface CropReading {
  /** Indices into the label set, strongest first, within the crop. */
  ranked: { index: number; confidence: number }[];
  /** How much of the model's belief sat on this crop at all, 0–1. */
  cropMass: number;
}

/**
 * The ranking among one crop's conditions only.
 *
 * The farmer knows what they are growing; the model does not have to guess it.
 * Restricting the answer to that crop removes the worst mistake a general
 * classifier makes — a rice leaf called tomato blight — and the confidences are
 * renormalised within the crop so they still read as shares.
 *
 * Returns null when the model has no classes for that crop, in which case the
 * caller ranks across everything rather than pretending.
 */
export function readForCrop(scores: number[], labels: LabelSet, crop: string): CropReading | null {
  const wanted = cropKey(crop);
  if (!wanted) return null;

  const indices = labels.classes
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => cropKey(c.crop) === wanted)
    .map(({ i }) => i);
  if (indices.length === 0) return null;

  const cropMass = indices.reduce((sum, i) => sum + (scores[i] ?? 0), 0);
  if (cropMass <= 0) return { ranked: indices.map((index) => ({ index, confidence: 0 })), cropMass: 0 };

  const ranked = indices
    .map((index) => ({ index, confidence: (scores[index] ?? 0) / cropMass }))
    .sort((a, b) => b.confidence - a.confidence);
  return { ranked, cropMass };
}
