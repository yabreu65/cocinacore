import { afterEach, describe, expect, it, vi } from 'vitest';

import { getServerEnvSecrets, getServerSecret } from '../env';

const ORIGINAL_ENV = process.env;

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.unstubAllGlobals();
});

describe('server environment validation', () => {
  it('rejects secret reads from a browser runtime', () => {
    vi.stubGlobal('window', { document: {} });

    expect(() => getServerSecret('GEMINI_API_KEY')).toThrow(
      'Server environment secrets cannot be read from a browser runtime.'
    );
  });

  it('rejects missing or blank server secrets without exposing values', () => {
    process.env = { ...ORIGINAL_ENV, GEMINI_API_KEY: '   ' };

    expect(() => getServerSecret('GEMINI_API_KEY')).toThrow(
      'Missing required server environment variable: GEMINI_API_KEY'
    );
  });

  it('rejects placeholder CHANGE_ME values', () => {
    process.env = { ...ORIGINAL_ENV, AUTH_SECRET: 'CHANGE_ME' };

    expect(() => getServerSecret('AUTH_SECRET')).toThrow(
      'Missing required server environment variable: AUTH_SECRET'
    );
  });

  it('returns only declared server secrets when all values are present', () => {
    process.env = {
      ...ORIGINAL_ENV,
      GEMINI_API_KEY: 'gemini-secret-value',
      DATABASE_URL: 'postgresql://localhost/cocinacore',
      REDIS_URL: 'redis://localhost:6379',
      AUTH_SECRET: 'auth-secret-value',
    };

    expect(getServerEnvSecrets()).toEqual({
      GEMINI_API_KEY: 'gemini-secret-value',
      DATABASE_URL: 'postgresql://localhost/cocinacore',
      REDIS_URL: 'redis://localhost:6379',
      AUTH_SECRET: 'auth-secret-value',
    });
  });
});
