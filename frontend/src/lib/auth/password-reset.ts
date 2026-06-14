import { randomBytes, createHash } from 'crypto';

const TOKEN_BYTES = 32;
const DEFAULT_RESET_TTL_MINUTES = 30;

export function generatePasswordResetToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashPasswordResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function hashPasswordResetIdentity(value: string): string {
  return createHash('sha256').update(value.toLowerCase().trim()).digest('hex');
}

export function getPasswordResetExpiry(): Date {
  const raw = process.env.PASSWORD_RESET_TTL_MINUTES;
  const ttlMinutes = raw ? Number.parseInt(raw, 10) : DEFAULT_RESET_TTL_MINUTES;
  const safeTtl = Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : DEFAULT_RESET_TTL_MINUTES;
  return new Date(Date.now() + safeTtl * 60 * 1000);
}
