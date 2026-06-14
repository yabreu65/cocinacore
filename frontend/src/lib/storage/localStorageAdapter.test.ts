import { mkdtemp, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localStorageAdapter } from './localStorageAdapter';

let tmpDir = '';

describe('localStorageAdapter', () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cocinacore-storage-'));
    vi.stubEnv('LOCAL_UPLOAD_DIR', tmpDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes sanitized files under the configured root', async () => {
    const stored = await localStorageAdapter.saveFile({
      namespace: 'Tenant PDFs',
      fileName: '../../Recipe.PDF',
      bytes: new TextEncoder().encode('pdf').buffer,
    });

    expect(stored.storagePath).toMatch(/^tenant-pdfs\//);
    expect(stored.absolutePath).toBeDefined();
    expect(await readFile(stored.absolutePath!, 'utf8')).toBe('pdf');
  });

  it('deletes existing files and ignores missing files', async () => {
    const stored = await localStorageAdapter.saveFile({
      namespace: 'x',
      fileName: 'file.pdf',
      bytes: new ArrayBuffer(0),
    });

    await expect(localStorageAdapter.deleteFile(stored.storagePath)).resolves.toBeUndefined();
    await expect(localStorageAdapter.deleteFile(stored.storagePath)).resolves.toBeUndefined();
  });

  it('rejects path traversal deletes', async () => {
    await expect(localStorageAdapter.deleteFile('../secret')).rejects.toThrow('Invalid storage path');
  });
});
