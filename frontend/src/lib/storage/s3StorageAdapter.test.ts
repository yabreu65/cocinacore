import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.fn();
const commandPayloads: unknown[] = [];

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class MockS3Client {
    send = sendMock;
  },
  PutObjectCommand: class MockPutObjectCommand {
    constructor(input: unknown) {
      commandPayloads.push({ type: 'put', input });
    }
  },
  DeleteObjectCommand: class MockDeleteObjectCommand {
    constructor(input: unknown) {
      commandPayloads.push({ type: 'delete', input });
    }
  },
}));

describe('s3StorageAdapter', () => {
  beforeEach(() => {
    vi.resetModules();
    commandPayloads.length = 0;
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
    vi.stubEnv('S3_ENDPOINT', 'https://s3.example.test');
    vi.stubEnv('S3_REGION', 'auto');
    vi.stubEnv('S3_BUCKET', 'cocinacore-test');
    vi.stubEnv('S3_ACCESS_KEY_ID', 'access');
    vi.stubEnv('S3_SECRET_ACCESS_KEY', 'secret');
    vi.stubEnv('S3_FORCE_PATH_STYLE', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('stores sanitized object keys in the configured bucket', async () => {
    const { s3StorageAdapter } = await import('./s3StorageAdapter');

    const stored = await s3StorageAdapter.saveFile({
      namespace: 'global-pdfs',
      fileName: '../../My Book.PDF',
      bytes: new Uint8Array([1, 2, 3]).buffer,
      contentType: 'application/pdf',
    });

    expect(stored.storagePath).toMatch(/^global-pdfs\//);
    expect(stored.storagePath).toContain('my-book.pdf');
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(commandPayloads[0]).toMatchObject({
      type: 'put',
      input: {
        Bucket: 'cocinacore-test',
        ContentType: 'application/pdf',
      },
    });
  });

  it('deletes only a canonical global object key', async () => {
    const { s3StorageAdapter } = await import('./s3StorageAdapter');

    await s3StorageAdapter.deleteFile('global-pdfs/file.pdf');

    expect(commandPayloads[0]).toMatchObject({
      type: 'delete',
      input: {
        Bucket: 'cocinacore-test',
        Key: 'global-pdfs/file.pdf',
      },
    });
  });

  it('rejects path traversal deletes', async () => {
    const { s3StorageAdapter } = await import('./s3StorageAdapter');

    await expect(s3StorageAdapter.deleteFile('../secret')).rejects.toThrow('Invalid storage path');
  });

  it.each([
    'tenant-pdfs/a/file.pdf',
    'global-pdfs/../tenant-pdfs/a/file.pdf',
    '/global-pdfs/file.pdf',
    'global-pdfs/a/file.pdf',
    'global-pdfs/%2e%2e',
  ])('rejects noncanonical or private keys before contacting S3: %s', async (key) => {
    const { s3StorageAdapter } = await import('./s3StorageAdapter');
    await expect(s3StorageAdapter.deleteFile(key)).rejects.toThrow('Invalid storage path');
    expect(sendMock).not.toHaveBeenCalled();
  });
  it.each(['tenant-pdfs/a', 'global-pdfs/../tenant-pdfs/a', 'Global PDFs'])(
    'rejects unauthorized namespaces: %s',
    async (namespace) => {
      const { s3StorageAdapter } = await import('./s3StorageAdapter');
      await expect(
        s3StorageAdapter.saveFile({ namespace, fileName: 'file.pdf', bytes: new ArrayBuffer(0) })
      ).rejects.toThrow('Unsupported S3 storage namespace');
      expect(sendMock).not.toHaveBeenCalled();
    }
  );

  it('requires S3 configuration before writes', async () => {
    vi.unstubAllEnvs();
    const { s3StorageAdapter } = await import('./s3StorageAdapter');

    await expect(
      s3StorageAdapter.saveFile({
        namespace: 'global-pdfs',
        fileName: 'x.pdf',
        bytes: new ArrayBuffer(0),
      })
    ).rejects.toThrow('S3_ENDPOINT is required');
  });
});
