import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  generatePasswordResetToken,
  getPasswordResetExpiry,
  hashPasswordResetIdentity,
  hashPasswordResetToken,
} from './password-reset';

describe('password reset helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('generates URL-safe random tokens', () => {
    const token = generatePasswordResetToken();

    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hashes reset tokens deterministically without returning the raw token', () => {
    const token = 'token-value';

    expect(hashPasswordResetToken(token)).toBe(hashPasswordResetToken(token));
    expect(hashPasswordResetToken(token)).not.toBe(token);
  });

  it('normalizes identity hashes', () => {
    expect(hashPasswordResetIdentity(' USER@example.com ')).toBe(
      hashPasswordResetIdentity('user@example.com')
    );
  });

  it('uses the configured reset TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.stubEnv('PASSWORD_RESET_TTL_MINUTES', '45');

    expect(getPasswordResetExpiry().toISOString()).toBe('2026-01-01T00:45:00.000Z');
  });
});
