import { afterEach, describe, expect, it, vi } from 'vitest';

describe('getStorageDriver', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to local', async () => {
    const { getStorageDriver } = await import('./index');
    expect(getStorageDriver()).toBe('local');
  });

  it('accepts s3', async () => {
    vi.stubEnv('STORAGE_DRIVER', 's3');
    const { getStorageDriver } = await import('./index');
    expect(getStorageDriver()).toBe('s3');
  });

  it('rejects unsupported drivers', async () => {
    vi.stubEnv('STORAGE_DRIVER', 'ftp');
    const { getStorageDriver } = await import('./index');
    expect(() => getStorageDriver()).toThrow("Use 'local' or 's3'");
  });
});


describe('getStorageAdapter', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the local adapter by default', async () => {
    const { getStorageAdapter } = await import('./index');
    const { localStorageAdapter } = await import('./localStorageAdapter');

    expect(getStorageAdapter()).toBe(localStorageAdapter);
  });

  it('returns the S3 adapter when STORAGE_DRIVER=s3', async () => {
    vi.stubEnv('STORAGE_DRIVER', 's3');
    const { getStorageAdapter } = await import('./index');
    const { s3StorageAdapter } = await import('./s3StorageAdapter');

    expect(getStorageAdapter()).toBe(s3StorageAdapter);
  });
});
