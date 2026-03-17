export type D1Result<T = unknown> = {
  results?: T[];
  success: boolean;
  meta: {
    duration: number;
    changes: number;
    last_row_id: number | null;
  };
};

export type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(): Promise<T | null>;
};

export type D1Database = {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
};

export type R2Bucket = {
  put(key: string, value: ArrayBuffer | ReadableStream | Blob, opts?: { httpMetadata?: { contentType?: string } }): Promise<void>;
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
};

export type Bindings = {
  DB: D1Database;
  R2_BUCKET?: R2Bucket;
  JWT_SECRET?: string;
  JWT_EXPIRES_IN?: string;
};

export type Env = {
  Bindings: Bindings;
};

