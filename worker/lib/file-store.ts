import { HttpError } from "./errors.ts";

export interface FileMetadata {
  contentType: string;
  size: number;
  breweryId: string;
  batchId: string;
  uploadedBy: string;
}

export interface StoredFile {
  body: ReadableStream;
  size: number;
}

export interface FileStore {
  put(key: string, body: ReadableStream, metadata: FileMetadata): Promise<void>;
  get(key: string): Promise<StoredFile | null>;
  delete(key: string): Promise<void>;
}

export class R2FileStore implements FileStore {
  constructor(private readonly bucket: R2Bucket) {}

  async put(key: string, body: ReadableStream, metadata: FileMetadata): Promise<void> {
    await this.bucket.put(key, body, {
      httpMetadata: { contentType: metadata.contentType },
      customMetadata: {
        breweryId: metadata.breweryId,
        batchId: metadata.batchId,
        uploadedBy: metadata.uploadedBy,
      },
    });
  }

  async get(key: string): Promise<StoredFile | null> {
    const object = await this.bucket.get(key);
    return object ? { body: object.body, size: object.size } : null;
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}

export class KvFileStore implements FileStore {
  constructor(private readonly namespace: KVNamespace) {}

  async put(key: string, body: ReadableStream, metadata: FileMetadata): Promise<void> {
    await this.namespace.put(key, body, { metadata });
  }

  async get(key: string): Promise<StoredFile | null> {
    const { value, metadata } = await this.namespace.getWithMetadata<FileMetadata>(key, "stream");
    if (!value) return null;
    if (!metadata || !Number.isSafeInteger(metadata.size) || metadata.size < 0 || !metadata.contentType) {
      throw new Error(`KV file metadata is missing or invalid for ${key}`);
    }
    return { body: value, size: metadata.size };
  }

  async delete(key: string): Promise<void> {
    await this.namespace.delete(key);
  }
}

/** Prefer R2 for object storage; KV remains available for environments without R2. */
export function getFileStore(env: Env): FileStore {
  const bindings = env as Partial<Pick<Env, "FILES" | "FILES_KV">>;
  if (bindings.FILES) return new R2FileStore(bindings.FILES);
  if (bindings.FILES_KV) return new KvFileStore(bindings.FILES_KV);
  throw new HttpError(503, "files_disabled", "Bildeopplasting er ikke slått på ennå.");
}
