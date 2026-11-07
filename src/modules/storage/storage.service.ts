import crypto from 'crypto';
import type { UploadBucket, UploadResult } from '@agronavis/shared-types';
import { db } from '../../config/supabase';
import { badRequest } from '../../shared/errors';

/**
 * Uploads route through the API so type and size are enforced server-side and
 * the object path is always `{farmerId}/{uuid}.{ext}`.
 */

interface BucketRules {
  maxBytes: number;
  mimeTypes: string[];
  /** Public buckets serve a permanent URL; private ones are served signed. */
  isPublic: boolean;
}

const BUCKET_RULES: Record<UploadBucket, BucketRules> = {
  avatars: {
    maxBytes: 5 * 1024 * 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    isPublic: true,
  },
  'community-media': {
    maxBytes: 50 * 1024 * 1024,
    mimeTypes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'video/mp4',
      'video/quicktime',
      'video/webm',
    ],
    isPublic: true,
  },
  // A diseased-crop photo is tied to a farmer's plot, so this bucket is private.
  'crop-scans': {
    maxBytes: 10 * 1024 * 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    isPublic: false,
  },
};

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 365;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

export const storageService = {
  isBucket(value: string): value is UploadBucket {
    return value in BUCKET_RULES;
  },

  async upload(
    farmerId: string,
    bucket: UploadBucket,
    file: { buffer: Buffer; mimetype: string; size: number },
  ): Promise<UploadResult> {
    const rules = BUCKET_RULES[bucket];

    if (!rules.mimeTypes.includes(file.mimetype)) {
      throw badRequest(
        `${file.mimetype} is not allowed in ${bucket}. Accepted: ${rules.mimeTypes.join(', ')}`,
      );
    }
    if (file.size > rules.maxBytes) {
      throw badRequest(
        `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit for ${bucket} is ${rules.maxBytes / 1024 / 1024} MB`,
      );
    }

    const extension = EXTENSIONS[file.mimetype] ?? 'bin';
    const path = `${farmerId}/${crypto.randomUUID()}.${extension}`;

    const { error } = await db.storage
      .from(bucket)
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
    if (error) throw badRequest(`Upload failed: ${error.message}`);

    return { bucket, path, publicUrl: await this.urlFor(bucket, path) };
  },

  /** A permanent URL for a public bucket, a signed one for a private bucket. */
  async urlFor(bucket: UploadBucket, path: string): Promise<string> {
    if (BUCKET_RULES[bucket].isPublic) {
      return db.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    }
    const { data, error } = await db.storage
      .from(bucket)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data) throw badRequest(`Could not sign ${bucket}/${path}`);
    return data.signedUrl;
  },

  /** Removes an object, but only from inside the caller's own folder. */
  async remove(farmerId: string, bucket: UploadBucket, path: string): Promise<void> {
    if (!path.startsWith(`${farmerId}/`)) {
      throw badRequest('You can only delete your own files');
    }
    const { error } = await db.storage.from(bucket).remove([path]);
    if (error) throw badRequest(`Delete failed: ${error.message}`);
  },
};
