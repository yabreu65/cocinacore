import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildStandaloneServerFixtureEnv } from '../../../e2e/standalone-server-env';
import { getOptionalServerSecret, getServerEnvSecrets, getServerSecret } from '../env';

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

describe('standalone server fixture environment', () => {
  it('uses deterministic Gemini fixtures instead of ambient values', () => {
    const fixtureEnv = buildStandaloneServerFixtureEnv(
      {
        GEMINI_API_KEY: 'CHANGE_ME',
        GEMINI_BASE_URL: 'https://ambient.invalid/v1beta',
      },
      4319
    );

    expect(fixtureEnv.GEMINI_API_KEY).toBe('e2e-gemini-key');
    expect(fixtureEnv.GEMINI_BASE_URL).toBe('http://127.0.0.1:4319/v1beta');
  });

  it('preserves auth and storage defaults and accepts configured values', () => {
    expect(buildStandaloneServerFixtureEnv({}, 4319)).toMatchObject({
      AUTH_SECRET: 'e2e-auth-secret-change-me',
      STORAGE_DRIVER: 'local',
      LOCAL_UPLOAD_DIR: './uploads',
    });
    expect(
      buildStandaloneServerFixtureEnv(
        {
          AUTH_SECRET: 'configured-auth-secret',
          STORAGE_DRIVER: 's3',
          LOCAL_UPLOAD_DIR: '/configured/uploads',
        },
        4319
      )
    ).toMatchObject({
      AUTH_SECRET: 'configured-auth-secret',
      STORAGE_DRIVER: 's3',
      LOCAL_UPLOAD_DIR: '/configured/uploads',
    });
  });

  it('keeps CHANGE_ME invalid for the application Gemini configuration', async () => {
    process.env = { ...ORIGINAL_ENV, GEMINI_API_KEY: 'CHANGE_ME' };
    vi.resetModules();
    const { getGeminiApiKey } = await import('@/lib/ai/gemini-config');

    expect(getGeminiApiKey()).toBeNull();
  });
});

describe('getOptionalServerSecret', () => {
  it('returns the value when set to a real value', () => {
    process.env = { ...ORIGINAL_ENV, GEMINI_API_KEY: 'real-key' };

    expect(getOptionalServerSecret('GEMINI_API_KEY')).toBe('real-key');
  });

  it('returns undefined when the key is not set', () => {
    delete process.env.GEMINI_API_KEY;

    expect(getOptionalServerSecret('GEMINI_API_KEY')).toBeUndefined();
  });

  it('returns undefined when the value is blank', () => {
    process.env = { ...ORIGINAL_ENV, GEMINI_API_KEY: '   ' };

    expect(getOptionalServerSecret('GEMINI_API_KEY')).toBeUndefined();
  });

  it('returns undefined when the value is CHANGE_ME', () => {
    process.env = { ...ORIGINAL_ENV, GEMINI_API_KEY: 'CHANGE_ME' };

    expect(getOptionalServerSecret('GEMINI_API_KEY')).toBeUndefined();
  });

  it('rejects reads from a browser runtime', () => {
    vi.stubGlobal('window', { document: {} });

    expect(() => getOptionalServerSecret('GEMINI_API_KEY')).toThrow(
      'Server environment secrets cannot be read from a browser runtime.'
    );
  });
});
