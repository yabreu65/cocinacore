export interface StoredFile {
  storagePath: string;
  absolutePath?: string;
}

export interface SaveFileInput {
  namespace: string;
  fileName: string;
  bytes: ArrayBuffer;
  contentType?: string;
}

export interface StorageAdapter {
  saveFile(input: SaveFileInput): Promise<StoredFile>;
  deleteFile(storagePath: string | null | undefined): Promise<void>;
}

export type StorageDriver = 'local' | 's3';
