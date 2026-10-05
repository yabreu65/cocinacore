import { afterEach, describe, expect, it, vi } from 'vitest';

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

describe('Playwright standalone Gemini fixture environment', () => {
  async function getStandaloneServerEnv() {
    vi.resetModules();
    const { default: config } = await import('../../../playwright.config');
    const webServers = Array.isArray(config.webServer)
      ? config.webServer
      : config.webServer
        ? [config.webServer]
        : [];
    const standaloneServer = webServers.find((server) =>
      server.command.includes('node .next/standalone/server.js')
    );

    expect(standaloneServer).toBeDefined();
    return standaloneServer?.env;
  }

  it('uses the deterministic fixture key instead of an ambient placeholder', async () => {
    process.env = { ...ORIGINAL_ENV, GEMINI_API_KEY: 'CHANGE_ME' };

    expect((await getStandaloneServerEnv())?.GEMINI_API_KEY).toBe('e2e-gemini-key');
  });

  it('uses the local fixture URL instead of an ambient external base URL', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      GEMINI_BASE_URL: 'https://ambient.invalid/v1beta',
    };

    expect((await getStandaloneServerEnv())?.GEMINI_BASE_URL).toBe(
      'http://127.0.0.1:4319/v1beta'
    );
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
