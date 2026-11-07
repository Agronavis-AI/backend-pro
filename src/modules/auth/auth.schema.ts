import { z } from 'zod';

export const totpTokenSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
});

export const backupCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Fa-f0-9]{4}-?[A-Fa-f0-9]{4}$/, 'Backup codes look like A1B2-C3D4'),
});
