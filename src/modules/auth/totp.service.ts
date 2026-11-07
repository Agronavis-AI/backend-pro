import crypto from 'crypto';
import QRCode from 'qrcode';
import speakeasy from 'speakeasy';
import type { TwoFactorSetup, TwoFactorStatus } from '@agronavis/shared-types';
import { env } from '../../config/env';
import { db } from '../../config/supabase';
import { AppError, badRequest, fromPostgrest, notFound } from '../../shared/errors';

const APP_NAME = 'Agronavis';
const CIPHER = 'aes-256-gcm';

/** TOTP second factor. */

function encryptionKey(): Buffer {
  const raw = env.TOTP_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    throw new AppError(
      503,
      'Two-factor auth is not configured: set TOTP_ENCRYPTION_KEY (32+ chars) in .env',
      'TOTP_NOT_CONFIGURED',
    );
  }
  // Hash to exactly 32 bytes so any passphrase length works.
  return crypto.createHash('sha256').update(raw).digest();
}

function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(CIPHER, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), ciphertext.toString('hex')].join(':');
}

function decrypt(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(':');
  if (!ivHex || !tagHex || !dataHex) throw badRequest('Stored 2FA secret is corrupt — set it up again');
  const decipher = crypto.createDecipheriv(CIPHER, encryptionKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

const hashCode = (code: string): string =>
  crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');

function generateBackupCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
  });
}

export const totpService = {
  /**
   * Step one of enrolment: issue a secret and QR code. 2FA stays disabled until
   * the farmer proves they scanned it by submitting a valid code.
   */
  async setup(farmerId: string, email: string): Promise<TwoFactorSetup> {
    const secret = speakeasy.generateSecret({ name: `${APP_NAME} (${email})`, length: 20 });
    if (!secret.otpauth_url) throw new AppError(500, 'Could not generate a TOTP secret');

    const backupCodes = generateBackupCodes();
    const { error } = await db
      .from('farmers')
      .update({
        two_factor_secret: encrypt(secret.base32),
        two_factor_enabled: false,
        backup_codes: backupCodes.map(hashCode),
      })
      .eq('id', farmerId);
    if (error) throw fromPostgrest(error, 'Start 2FA setup');

    return {
      qrCodeDataUrl: await QRCode.toDataURL(secret.otpauth_url, { margin: 1, width: 320 }),
      manualKey: secret.base32,
      backupCodes, // shown once; only hashes are stored
    };
  },

  /** Verifies a 6-digit code. The first success completes enrolment. */
  async verify(farmerId: string, token: string): Promise<boolean> {
    const { data, error } = await db
      .from('farmers')
      .select('two_factor_secret, two_factor_enabled')
      .eq('id', farmerId)
      .maybeSingle();
    if (error) throw fromPostgrest(error, 'Load 2FA state');
    if (!data) throw notFound('Farmer not found');
    if (!data.two_factor_secret) throw badRequest('Start two-factor setup first');

    const verified = speakeasy.totp.verify({
      secret: decrypt(data.two_factor_secret),
      encoding: 'base32',
      token: token.replace(/\D/g, ''),
      window: 1, // ±30s, for clock drift on cheap handsets
    });

    if (verified && !data.two_factor_enabled) {
      await db.from('farmers').update({ two_factor_enabled: true }).eq('id', farmerId);
    }
    return verified;
  },

  /** Consumes a single-use backup code. */
  async verifyBackupCode(farmerId: string, code: string): Promise<boolean> {
    const { data, error } = await db
      .from('farmers')
      .select('backup_codes')
      .eq('id', farmerId)
      .maybeSingle();
    if (error) throw fromPostgrest(error, 'Load backup codes');

    const codes = data?.backup_codes ?? [];
    const hash = hashCode(code);
    const index = codes.indexOf(hash);
    if (index === -1) return false;

    const remaining = codes.filter((_, i) => i !== index);
    await db.from('farmers').update({ backup_codes: remaining }).eq('id', farmerId);
    return true;
  },

  /** Turning 2FA off requires proving possession first — see the route. */
  async disable(farmerId: string): Promise<void> {
    const { error } = await db
      .from('farmers')
      .update({ two_factor_enabled: false, two_factor_secret: null, backup_codes: [] })
      .eq('id', farmerId);
    if (error) throw fromPostgrest(error, 'Disable 2FA');
  },

  async status(farmerId: string): Promise<TwoFactorStatus> {
    const { data, error } = await db
      .from('farmers')
      .select('two_factor_enabled, backup_codes')
      .eq('id', farmerId)
      .maybeSingle();
    if (error) throw fromPostgrest(error, 'Load 2FA status');
    return {
      enabled: data?.two_factor_enabled ?? false,
      backupCodesRemaining: data?.backup_codes?.length ?? 0,
    };
  },

  async regenerateBackupCodes(farmerId: string): Promise<string[]> {
    const codes = generateBackupCodes();
    const { error } = await db
      .from('farmers')
      .update({ backup_codes: codes.map(hashCode) })
      .eq('id', farmerId);
    if (error) throw fromPostgrest(error, 'Regenerate backup codes');
    return codes;
  },
};
