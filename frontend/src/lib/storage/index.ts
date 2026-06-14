import { localStorageAdapter } from './localStorageAdapter';
import { s3StorageAdapter } from './s3StorageAdapter';
import type { StorageAdapter, StorageDriver } from './types';

export type { SaveFileInput, StorageAdapter, StoredFile, StorageDriver } from './types';

export function getStorageDriver(): StorageDriver {
  const driver = process.env.STORAGE_DRIVER?.trim().toLowerCase() || 'local';
  if (driver !== 'local' && driver !== 's3') {
    throw new Error(`Unsupported storage driver: ${driver}. Use 'local' or 's3'.`);
  }
  return driver;
}

export function getStorageAdapter(): StorageAdapter {
  return getStorageDriver() === 's3' ? s3StorageAdapter : localStorageAdapter;
}
