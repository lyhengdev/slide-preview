import "dotenv/config";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fsp from "node:fs/promises";
import fs from "node:fs";
import { Readable } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { loadEnv, storageEnvSchema, type StorageEnv } from "@ke/config";

const ALLOWED_KINDS = new Set(["originals", "slides", "temporary"]);
const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".ppt": "application/vnd.ms-powerpoint",
  ".json": "application/json",
};

interface FileMeta {
  id: string;
  kind: string;
  originalName: string;
  mime: string;
  size: number;
  path: string;
  createdAt: string;
}

/**
 * Backing store behind the storage service's HTTP contract. The wire protocol
 * (multipart upload / byte download / delete) is identical regardless of the
 * store, so the API and worker never know whether files live on disk or in
 * S3-compatible object storage.
 */
interface StorageBackend {
  /** Persists one object (a slide/original bytes or a JSON meta file). */
  writeFile(key: string, content: Buffer, contentType: string): Promise<void>;
  /** Returns a readable stream for an object, or null when it is missing. */
  readFile(key: string): Promise<{ stream: Readable; size: number } | null>;
  deleteFile(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Local-disk backend (default when no S3 credentials are configured)
// ---------------------------------------------------------------------------

function diskBackend(dataDir: string): StorageBackend {
  const resolve = (key: string) => path.join(dataDir, key);
  return {
    async writeFile(key, content) {
      const abs = resolve(key);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, content);
    },
    async readFile(key) {
      const abs = resolve(key);
      if (!fs.existsSync(abs)) return null;
      return { stream: fs.createReadStream(abs), size: fs.statSync(abs).size };
    },
    async deleteFile(key) {
      await fsp.rm(resolve(key), { force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// S3-compatible backend (Neon Storage, MinIO, AWS S3, …)
// ---------------------------------------------------------------------------

function s3Enabled(env: StorageEnv): boolean {
  return Boolean(env.AWS_ENDPOINT_URL_S3 && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);
}

function createS3Client(env: StorageEnv): S3Client {
  // Neon Storage / MinIO require path-style addressing (bucket in the path).
  return new S3Client({
    endpoint: env.AWS_ENDPOINT_URL_S3,
    region: env.AWS_REGION ?? "us-east-2",
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
  });
}

function s3Backend(env: StorageEnv): StorageBackend {
  const client = createS3Client(env);
  const bucket = env.S3_BUCKET;
  return {
    async writeFile(key, content, contentType = "application/octet-stream") {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: content, ContentType: contentType })
      );
    },
    async readFile(key) {
      try {
        const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        // In Node the SDK returns a Readable stream for the object body.
        const stream = object.Body as Readable | undefined;
        if (!stream) return null;
        return { stream, size: object.ContentLength ?? 0 };
      } catch {
        // Neon S3 returns NoSuchKey for missing objects; treat any read
        // failure of the target as "not here" so lookups can move on.
        return null;
      }
    },
    async deleteFile(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined);
    },
  };
}

// ---------------------------------------------------------------------------
// Meta helpers (works on any backend; meta files are plain JSON objects)
// ---------------------------------------------------------------------------

function metaKey(kind: string, id: string): string {
  return `${kind}/${id}.json`;
}

async function readMeta(backend: StorageBackend, kind: string, id: string): Promise<FileMeta | null> {
  const file = await backend.readFile(metaKey(kind, id));
  if (!file) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of file.stream) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8")) as FileMeta;
  } catch {
    return null;
  }
}

async function writeMeta(backend: StorageBackend, meta: FileMeta): Promise<void> {
  await backend.writeFile(
    metaKey(meta.kind, meta.id),
    Buffer.from(JSON.stringify(meta, null, 2), "utf-8"),
    "application/json"
  );
}

// ---------------------------------------------------------------------------
// Fastify app
// ---------------------------------------------------------------------------

export async function buildStorageApp(env: StorageEnv): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } });

  const dataDir = path.resolve(env.DATA_DIR);
  const backend = s3Enabled(env)
    ? s3Backend(env)
    : ((await fsp.mkdir(dataDir, { recursive: true })), diskBackend(dataDir));

  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith("/internal/health")) return;
    if (req.headers["x-storage-token"] !== env.STORAGE_TOKEN) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.get("/internal/health", async () => ({ ok: true, backend: s3Enabled(env) ? "s3" : "disk" }));

  app.post("/internal/files", async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: "No file provided" });

    const kind = String((data.fields.kind as { value?: string } | undefined)?.value ?? "temporary");
    if (!ALLOWED_KINDS.has(kind)) {
      return reply.code(400).send({ error: `Invalid kind: ${kind}` });
    }

    const mime = data.mimetype || "application/octet-stream";
    const ext = extFor(mime, path.extname(data.filename || "") || ".bin");
    const id = randomUUID();
    const content = await data.toBuffer();

    const meta: FileMeta = {
      id,
      kind,
      originalName: data.filename || id,
      mime,
      size: content.length,
      path: `${kind}/${id}${ext}`,
      createdAt: new Date().toISOString(),
    };
    await backend.writeFile(meta.path, content, mime);
    await writeMeta(backend, meta);

    return reply.code(201).send(meta);
  });

  app.get("/internal/files/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const passedKind = (req.query as { kind?: string }).kind;
    const kinds = passedKind && ALLOWED_KINDS.has(passedKind) ? [passedKind] : [...ALLOWED_KINDS];

    for (const kind of kinds) {
      const meta = await readMeta(backend, kind, id);
      if (!meta) continue;
      const file = await backend.readFile(meta.path);
      if (!file) {
        return reply.code(404).send({ error: "File missing in storage" });
      }
      return reply
        .header("Content-Type", meta.mime)
        .header("Content-Length", file.size)
        .header("Cache-Control", "private, no-store")
        .header(
          "Content-Disposition",
          (req.query as { download?: string }).download === "1"
            ? `attachment; filename="${meta.originalName}"`
            : "inline"
        )
        .send(file.stream);
    }
    return reply.code(404).send({ error: "Not found" });
  });

  app.delete("/internal/files/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    let deleted = false;
    for (const kind of ALLOWED_KINDS) {
      const meta = await readMeta(backend, kind, id);
      if (!meta) continue;
      await backend.deleteFile(meta.path);
      await backend.deleteFile(metaKey(kind, id));
      deleted = true;
      break;
    }
    return reply.code(deleted ? 200 : 404).send({ deleted });
  });

  return app;
}

function extFor(mime: string, fallbackExt = ".bin"): string {
  const entry = Object.entries(MIME_BY_EXT).find(([, m]) => m === mime);
  return entry ? entry[0] : fallbackExt;
}

export async function main(): Promise<void> {
  const env = loadEnv(storageEnvSchema);
  const app = await buildStorageApp(env);
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

// The entry point only runs when executed directly; consumers that import
// buildStorageApp (tests, lambdas) set SKIP_STORAGE_MAIN to avoid a listener.
if (process.env.SKIP_STORAGE_MAIN !== "1") {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

// Internal-only: the AWS SDK signs requests automatically, so the service
// streams bytes to its own consumers. `s3-request-presigner` is available if a
// truly client-facing expiring link is ever needed.