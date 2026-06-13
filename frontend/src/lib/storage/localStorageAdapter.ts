import { mkdir, unlink, writeFile } from 'fs/promises';
import path from 'path';

export interface LocalStoredFile {
  storagePath: string;
  absolutePath: string;
}

interface SaveFileInput {
  namespace: string;
  fileName: string;
  bytes: ArrayBuffer;
}

function sanitizeSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._/-]/g, '-');
}

function getStorageDriver(): 'local' {
  const driver = process.env.STORAGE_DRIVER?.trim().toLowerCase() ?? 'local';
  if (driver && driver !== 'local') {
    throw new Error(`Unsupported storage driver: ${driver}. Only 'local' is implemented.`);
  }
  return 'local';
}

function getStorageRoot(): string {
  getStorageDriver();

  const configuredRoot =
    process.env.LOCAL_UPLOAD_DIR?.trim() ||
    process.env.LOCAL_STORAGE_ROOT?.trim();

  return configuredRoot && configuredRoot.length > 0
    ? configuredRoot
    : path.join(process.cwd(), 'uploads');
}

function resolveStoragePath(storagePath: string): string {
  const root = path.resolve(getStorageRoot());
  const absolutePath = path.resolve(root, storagePath);

  if (!absolutePath.startsWith(root)) {
    throw new Error('Invalid storage path');
  }

  return absolutePath;
}

export const localStorageAdapter = {
  async saveFile(input: SaveFileInput): Promise<LocalStoredFile> {
    const sanitizedNamespace = sanitizeSegment(input.namespace).replace(/^\/+|\/+$/g, '');
    const sanitizedName = sanitizeSegment(input.fileName).split('/').pop() || 'file.bin';
    const storagePath = path.posix.join(
      sanitizedNamespace,
      `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${sanitizedName}`
    );
    const absolutePath = resolveStoragePath(storagePath);

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from(input.bytes));

    return { storagePath, absolutePath };
  },

  async deleteFile(storagePath: string | null | undefined): Promise<void> {
    if (!storagePath) {
      return;
    }

    try {
      await unlink(resolveStoragePath(storagePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }
  },

  get publicRoot(): string {
    return getStorageRoot();
  },
};
