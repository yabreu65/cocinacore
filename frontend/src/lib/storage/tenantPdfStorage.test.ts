import { mkdtemp, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  configs: [] as unknown[],
  commands: [] as { type: string; input: unknown }[],
  send: vi.fn(),
}));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    constructor(config: unknown) {
      mocks.configs.push(config);
    }
    send = mocks.send;
  },
  PutObjectCommand: class {
    constructor(input: unknown) {
      mocks.commands.push({ type: 'put', input });
    }
  },
  DeleteObjectCommand: class {
    constructor(input: unknown) {
      mocks.commands.push({ type: 'delete', input });
    }
  },
}));
import { deleteTenantPdf, saveTenantPdf } from './tenantPdfStorage';

const tenant = 'a1234567-1234-4234-8234-123456789abc';
const other = 'b1234567-1234-4234-8234-123456789abc';
const objectId = 'c1234567-1234-4234-8234-123456789abc';
const key = `tenant-pdfs/${tenant}/${objectId}.pdf`;
const bytes = new Uint8Array([1, 2, 3]).buffer;
let temporaryDir: string | undefined;

describe('tenant PDF storage', () => {
  beforeEach(() => {
    mocks.configs.length = 0;
    mocks.commands.length = 0;
    mocks.send.mockReset().mockResolvedValue({});
    vi.stubEnv('STORAGE_DRIVER', 's3');
    vi.stubEnv('S3_ENDPOINT', 'https://storage.example.test');
    vi.stubEnv('S3_REGION', 'auto');
    vi.stubEnv('S3_BUCKET', 'global-bucket');
    vi.stubEnv('S3_ACCESS_KEY_ID', 'global-key');
    vi.stubEnv('S3_SECRET_ACCESS_KEY', 'global-secret');
    vi.stubEnv('S3_TENANT_BUCKET', 'private-bucket');
    vi.stubEnv('S3_TENANT_ACCESS_KEY_ID', 'tenant-key');
    vi.stubEnv('S3_TENANT_SECRET_ACCESS_KEY', 'tenant-secret');
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    if (temporaryDir) await rm(temporaryDir, { recursive: true, force: true });
    temporaryDir = undefined;
  });

  it('uses separate credentials and canonical private keys without exposing paths or global secrets', async () => {
    const result = await saveTenantPdf({
      tenantId: tenant.toUpperCase(),
      fileName: '../../untrusted.pdf',
      bytes,
    });
    expect(Object.keys(result)).toEqual(['storagePath']);
    expect(result.storagePath).toMatch(new RegExp(`^tenant-pdfs/${tenant}/[0-9a-f-]{36}\\.pdf$`));
    expect(mocks.configs).toEqual([
      {
        endpoint: 'https://storage.example.test',
        region: 'auto',
        forcePathStyle: true,
        credentials: { accessKeyId: 'tenant-key', secretAccessKey: 'tenant-secret' },
      },
    ]);
    expect(JSON.stringify(mocks.configs)).not.toContain('global-key');
    expect(JSON.stringify(mocks.configs)).not.toContain('global-secret');
    expect(mocks.commands).toEqual([
      {
        type: 'put',
        input: {
          Bucket: 'private-bucket',
          Key: result.storagePath,
          Body: Buffer.from(bytes),
          ContentType: 'application/pdf',
        },
      },
    ]);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('deletes a matching tenant key with the dedicated client', async () => {
    await deleteTenantPdf({ tenantId: tenant, storagePath: key });
    expect(mocks.commands).toEqual([
      { type: 'delete', input: { Bucket: 'private-bucket', Key: key } },
    ]);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it.each([
    `tenant-pdfs/${other}/${objectId}.pdf`,
    'global-pdfs/file.pdf',
    `/${key}`,
    `${key}/extra`,
    `${key}\n`,
    `tenant-pdfs/${tenant}/../${objectId}.pdf`,
    `tenant-pdfs/${tenant}/${objectId.toUpperCase()}.pdf`,
    `tenant-pdfs/${tenant}/%2e%2e.pdf`,
    '',
  ])('rejects noncanonical or cross-tenant deletion: %s', async (storagePath) => {
    await expect(deleteTenantPdf({ tenantId: tenant, storagePath })).rejects.toThrow(
      'Invalid tenant PDF storage path'
    );
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.configs).toHaveLength(0);
  });
  it.each([
    '',
    '../other',
    'not-a-uuid',
    ` ${tenant}`,
    `${tenant}\n`,
    '00000000-0000-0000-0000-000000000000',
  ])('rejects invalid tenant IDs before either operation: %s', async (tenantId) => {
    await expect(saveTenantPdf({ tenantId, fileName: 'x.pdf', bytes })).rejects.toThrow(
      'Invalid tenant ID'
    );
    await expect(deleteTenantPdf({ tenantId, storagePath: key })).rejects.toThrow(
      'Invalid tenant ID'
    );
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each([
    'S3_TENANT_BUCKET',
    'S3_TENANT_ACCESS_KEY_ID',
    'S3_TENANT_SECRET_ACCESS_KEY',
    'S3_ENDPOINT',
    'S3_REGION',
  ])('fails closed when %s is missing', async (name) => {
    vi.stubEnv(name, '');
    await expect(saveTenantPdf({ tenantId: tenant, fileName: 'x.pdf', bytes })).rejects.toThrow(
      name
    );
    await expect(deleteTenantPdf({ tenantId: tenant, storagePath: key })).rejects.toThrow(name);
    expect(mocks.configs).toHaveLength(0);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each([
    ['S3_TENANT_BUCKET', 'global-bucket'],
    ['S3_TENANT_ACCESS_KEY_ID', 'global-key'],
    ['S3_TENANT_SECRET_ACCESS_KEY', 'CHANGE_ME'],
  ])('rejects unsafe configuration %s', async (name, value) => {
    vi.stubEnv(name, value);
    await expect(saveTenantPdf({ tenantId: tenant, fileName: 'x.pdf', bytes })).rejects.toThrow();
    expect(mocks.configs).toHaveLength(0);
  });
  it('rejects unsupported drivers without contacting storage', async () => {
    vi.stubEnv('STORAGE_DRIVER', 'other');
    await expect(saveTenantPdf({ tenantId: tenant, fileName: 'x.pdf', bytes })).rejects.toThrow(
      'Unsupported storage driver'
    );
    await expect(deleteTenantPdf({ tenantId: tenant, storagePath: key })).rejects.toThrow(
      'Unsupported storage driver'
    );
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('stores and deletes canonical local keys without exposing local paths', async () => {
    temporaryDir = await mkdtemp(path.join(os.tmpdir(), 'tenant-pdf-test-'));
    vi.stubEnv('STORAGE_DRIVER', 'local');
    vi.stubEnv('LOCAL_UPLOAD_DIR', temporaryDir);
    const saved = await saveTenantPdf({ tenantId: tenant, fileName: '../ignored.pdf', bytes });
    expect(Object.keys(saved)).toEqual(['storagePath']);
    expect(saved.storagePath).toMatch(new RegExp(`^tenant-pdfs/${tenant}/[0-9a-f-]{36}\\.pdf$`));
    expect(await readFile(path.join(temporaryDir, saved.storagePath))).toEqual(Buffer.from(bytes));
    await expect(
      deleteTenantPdf({ tenantId: other, storagePath: saved.storagePath })
    ).rejects.toThrow('Invalid tenant PDF storage path');
    await deleteTenantPdf({ tenantId: tenant, storagePath: saved.storagePath });
    await expect(readFile(path.join(temporaryDir, saved.storagePath))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
