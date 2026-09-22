import { z } from "zod";

const boolFromEnv = z
  .string()
  .optional()
  .transform((v) => {
    if (!v) return undefined;
    return v === "true" || v === "1";
  });

export const apiEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().default(4000),
  PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  WEB_URL: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  STORAGE_URL: z.string().default("http://localhost:4100"),
  JWT_SECRET: z.string().min(16).default("dev-insecure-jwt-secret-change-me"),
  COOKIE_SECRET: z.string().min(16).default("dev-insecure-cookie-secret"),
  COOKIE_SECURE: boolFromEnv.default("false"),
  QR_TOKEN_TTL_SECONDS: z.coerce.number().default(15 * 60),
  JUDGE_SESSION_TTL_HOURS: z.coerce.number().default(12),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().default(12),
  // Comma separated extra browser origins allowed to call the API (WEB_URL is always allowed).
  CORS_ORIGINS: z.string().optional(),
  // Failed judge/admin logins tolerated before a temporary lockout.
  LOGIN_MAX_ATTEMPTS: z.coerce.number().min(1).default(8),
  LOGIN_LOCKOUT_SECONDS: z.coerce.number().min(10).default(120),
});

export function corsOrigins(env: Pick<ApiEnv, "WEB_URL" | "CORS_ORIGINS">): string[] {
  const extra = (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return [...new Set([env.WEB_URL, ...extra])];
}

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const workerEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  STORAGE_URL: z.string().default("http://localhost:4100"),
  // Full-resolution tier (per-slide WebP).
  SLIDE_WIDTH: z.coerce.number().default(1920),
  SLIDE_QUALITY: z.coerce.number().min(1).max(100).default(80),
  // Standard tier: preferred for battery/slow networks.
  SLIDE_WIDTH_STANDARD: z.coerce.number().default(1280),
  SLIDE_QUALITY_STANDARD: z.coerce.number().min(1).max(100).default(72),
  // Minimal preview tier shown instantly on slow connections.
  SLIDE_WIDTH_PREVIEW: z.coerce.number().default(384),
  SLIDE_QUALITY_PREVIEW: z.coerce.number().min(1).max(100).default(55),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export const storageEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().default(4100),
  DATA_DIR: z.string().default("./var/data"),
  STORAGE_TOKEN: z.string().min(16).default("dev-storage-token-change-me"),
  // When set, the storage service persists in S3-compatible object storage
  // (e.g. Neon Storage) instead of the local disk. All variables are required
  // together to enable the S3 backend.
  AWS_ENDPOINT_URL_S3: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().optional(),
  S3_BUCKET: z.string().default("assets"),
});

export type StorageEnv = z.infer<typeof storageEnvSchema>;

export function loadEnv<S extends z.ZodTypeAny>(
  schema: S,
  source = process.env,
): z.infer<S> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}