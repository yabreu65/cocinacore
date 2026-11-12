import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import path from 'path';
import type { SaveFileInput, StorageAdapter, StoredFile } from './types';

interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

let client: S3Client | null = null;
let cachedConfig: S3Config | null = null;

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || value === 'CHANGE_ME') {
    throw new Error(`${name} is required for S3 storage.`);
  }
  return value;
}

function getS3Config(): S3Config {
  if (cachedConfig) return cachedConfig;

  cachedConfig = {
    endpoint: readRequiredEnv('S3_ENDPOINT'),
    region: readRequiredEnv('S3_REGION'),
    bucket: readRequiredEnv('S3_BUCKET'),
    accessKeyId: readRequiredEnv('S3_ACCESS_KEY_ID'),
    secretAccessKey: readRequiredEnv('S3_SECRET_ACCESS_KEY'),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE?.trim().toLowerCase() !== 'false',
  };

  return cachedConfig;
}

function getS3Client(): S3Client {
  if (client) return client;
  const config = getS3Config();
  client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return client;
}

function sanitizeSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._/-]/g, '-');
}

function buildObjectKey(input: SaveFileInput): string {
  // Only the platform-owner global library currently has an S3 write lane.
  if (input.namespace !== 'global-pdfs') throw new Error('Unsupported S3 storage namespace');
  const sanitizedName = sanitizeSegment(input.fileName).split('/').pop() || 'file.bin';
  return path.posix.join(
    'global-pdfs',
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${sanitizedName}`
  );
}

function normalizeObjectKey(storagePath: string): string {
  // Reject ambiguous keys instead of normalizing them into another namespace.
  if (!/^global-pdfs\/[a-z0-9][a-z0-9._-]*$/.test(storagePath)) {
    throw new Error('Invalid storage path');
  }
  return storagePath;
}

export const s3StorageAdapter: StorageAdapter = {
  async saveFile(input: SaveFileInput): Promise<StoredFile> {
    const storagePath = buildObjectKey(input);
    const config = getS3Config();

    await getS3Client().send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: storagePath,
        Body: Buffer.from(input.bytes),
        ContentType: input.contentType ?? 'application/octet-stream',
      })
    );

    return { storagePath };
  },

  async deleteFile(storagePath: string | null | undefined): Promise<void> {
    if (!storagePath) return;
    const key = normalizeObjectKey(storagePath);
    const config = getS3Config();
    await getS3Client().send(
      new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: key,
      })
    );
  },
};
