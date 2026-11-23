import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { rename } from 'fs/promises';
import path from 'path';
import { localStorageAdapter } from './localStorageAdapter';

interface SaveTenantPdfInput {
  tenantId: string;
  fileName: string;
  bytes: ArrayBuffer;
}

interface DeleteTenantPdfInput {
  tenantId: string;
  storagePath: string;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const tenantIdPattern = new RegExp(`^${UUID}$`);
const keyPattern = new RegExp(`^tenant-pdfs/(${UUID})/(${UUID})\\.pdf$`);

function normalizeTenantId(tenantId: string): string {
  const normalized = tenantId.toLowerCase();
  if (normalized.length !== 36 || !tenantIdPattern.test(normalized))
    throw new Error('Invalid tenant ID');
  return normalized;
}

function validateKey(storagePath: string, tenantId: string): string {
  const match = keyPattern.exec(storagePath);
  if (!match || match[0] !== storagePath || match[1] !== tenantId)
    throw new Error('Invalid tenant PDF storage path');
  return storagePath;
}

function storageDriver(): 'local' | 's3' {
  const driver = process.env.STORAGE_DRIVER?.trim().toLowerCase() || 'local';
  if (driver !== 'local' && driver !== 's3') throw new Error('Unsupported storage driver');
  return driver;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || value === 'CHANGE_ME') throw new Error(`${name} is required for tenant S3 storage`);
  return value;
}

function tenantS3() {
  const bucket = requiredEnv('S3_TENANT_BUCKET');
  const accessKeyId = requiredEnv('S3_TENANT_ACCESS_KEY_ID');
  const secretAccessKey = requiredEnv('S3_TENANT_SECRET_ACCESS_KEY');
  const endpoint = requiredEnv('S3_ENDPOINT');
  const region = requiredEnv('S3_REGION');
  if (
    bucket === process.env.S3_BUCKET?.trim() ||
    accessKeyId === process.env.S3_ACCESS_KEY_ID?.trim()
  ) {
    throw new Error('Tenant S3 bucket and credentials must be separate from global storage');
  }
  return {
    bucket,
    client: new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

export async function saveTenantPdf(input: SaveTenantPdfInput): Promise<{ storagePath: string }> {
  const tenantId = normalizeTenantId(input.tenantId);
  const namespace = `tenant-pdfs/${tenantId}`;
  const storagePath = `${namespace}/${randomUUID()}.pdf`;
  if (storageDriver() === 's3') {
    const { bucket, client } = tenantS3();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: storagePath,
        Body: Buffer.from(input.bytes),
        ContentType: 'application/pdf',
      })
    );
  } else {
    // The local adapter adds a prefix; move its output to the canonical private key.
    const temporary = await localStorageAdapter.saveFile({
      namespace,
      fileName: `${randomUUID()}.pdf`,
      bytes: input.bytes,
      contentType: 'application/pdf',
    });
    if (!temporary.absolutePath) throw new Error('Local storage did not return an absolute path');
    try {
      await rename(
        temporary.absolutePath,
        path.join(path.dirname(temporary.absolutePath), path.posix.basename(storagePath))
      );
    } catch (error) {
      await localStorageAdapter.deleteFile(temporary.storagePath);
      throw error;
    }
  }
  return { storagePath };
}

export async function deleteTenantPdf(input: DeleteTenantPdfInput): Promise<void> {
  const tenantId = normalizeTenantId(input.tenantId);
  const storagePath = validateKey(input.storagePath, tenantId);
  if (storageDriver() === 's3') {
    const { bucket, client } = tenantS3();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: storagePath }));
  } else {
    await localStorageAdapter.deleteFile(storagePath);
  }
}
