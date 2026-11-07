import { PDFDocument, PDFDict, PDFName, PDFRawStream } from 'pdf-lib';
import sharp from 'sharp';

// One resume at a time on a small instance; sharp defaults to one worker per core.
sharp.concurrency(1);
sharp.cache(false);

const JPEG_QUALITY = 78;
const MAX_EDGE = 1800; // ~215 DPI across an A4 page, comfortable for scanned text
const MAX_PIXELS = 40_000_000; // refuse decompression bombs
const TIME_BUDGET_MS = 20_000;

export type Compressed = {
  bytes: Buffer;
  mimeType: string;
  /** Extension to store the file under, when re-encoding changed the format. */
  extension: string | null;
  originalBytes: number;
  note: string;
};

const unchanged = (bytes: Buffer, mimeType: string, note: string): Compressed => ({
  bytes,
  mimeType,
  extension: null,
  originalBytes: bytes.length,
  note,
});

/** Re-encodes one embedded image, returning null when it is not worth replacing. */
async function shrinkImage(source: Buffer): Promise<{ data: Buffer; width: number; height: number } | null> {
  const meta = await sharp(source).metadata();
  if (!meta.width || !meta.height) return null;
  if (meta.width * meta.height > MAX_PIXELS) return null;

  const data = await sharp(source, { failOn: 'none' })
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0' })
    .toBuffer();

  if (data.length >= source.length) return null;

  const out = await sharp(data).metadata();
  if (!out.width || !out.height) return null;
  return { data, width: out.width, height: out.height };
}

/**
 * Shrinks the images inside a PDF. Text, vectors and structure are untouched,
 * so a text-only CV comes back byte-identical rather than needlessly rewritten.
 */
async function compressPdf(input: Buffer): Promise<Compressed> {
  const deadline = Date.now() + TIME_BUDGET_MS;

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    return unchanged(input, 'application/pdf', 'unreadable pdf, stored as uploaded');
  }

  let replaced = 0;

  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (Date.now() > deadline) break;
    if (!(obj instanceof PDFRawStream)) continue;

    const dict = obj.dict;
    if (!(dict instanceof PDFDict)) continue;
    if (dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue;

    // Only JPEG streams decode cleanly on their own. Flate images carry their
    // colour space in the dictionary and are not safe to reinterpret here.
    if (dict.get(PDFName.of('Filter'))?.toString() !== '/DCTDecode') continue;
    if (dict.has(PDFName.of('SMask')) || dict.has(PDFName.of('Mask'))) continue;

    const source = Buffer.from(obj.getContents());
    let shrunk: Awaited<ReturnType<typeof shrinkImage>> = null;
    try {
      shrunk = await shrinkImage(source);
    } catch {
      continue;
    }
    if (!shrunk) continue;

    dict.set(PDFName.of('Length'), doc.context.obj(shrunk.data.length));
    dict.set(PDFName.of('Width'), doc.context.obj(shrunk.width));
    dict.set(PDFName.of('Height'), doc.context.obj(shrunk.height));
    dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
    dict.set(PDFName.of('BitsPerComponent'), doc.context.obj(8));

    // contents is readonly on the public type; the stream is replaced in place.
    (obj as unknown as { contents: Uint8Array }).contents = shrunk.data;
    replaced++;
  }

  if (replaced === 0) return unchanged(input, 'application/pdf', 'no compressible images');

  const bytes = Buffer.from(await doc.save({ useObjectStreams: true }));
  if (bytes.length >= input.length) {
    return unchanged(input, 'application/pdf', 'rewrite was not smaller');
  }

  return {
    bytes,
    mimeType: 'application/pdf',
    extension: null,
    originalBytes: input.length,
    note: `${replaced} image${replaced === 1 ? '' : 's'} re-encoded`,
  };
}

/** A photographed or exported CV. Stored as JPEG regardless of what arrived. */
async function compressImage(input: Buffer): Promise<Compressed> {
  try {
    const bytes = await sharp(input, { failOn: 'none' })
      .rotate() // honour EXIF orientation before the metadata is dropped
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();

    if (bytes.length >= input.length) return unchanged(input, 'image/jpeg', 'already small');

    return {
      bytes,
      mimeType: 'image/jpeg',
      extension: 'jpg',
      originalBytes: input.length,
      note: 're-encoded',
    };
  } catch {
    return unchanged(input, 'image/jpeg', 'could not re-encode');
  }
}

/**
 * Best-effort. Any failure returns the original bytes, because storing a
 * slightly larger resume beats losing one.
 */
export async function compressResume(input: Buffer, mimeType: string): Promise<Compressed> {
  if (mimeType === 'application/pdf') return compressPdf(input);
  if (mimeType.startsWith('image/')) return compressImage(input);
  // Word documents are zip archives already; recompressing gains nothing.
  return unchanged(input, mimeType, 'format not compressible');
}
