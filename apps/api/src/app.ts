import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { loadEnv, apiEnvSchema, corsOrigins, type ApiEnv } from "@ke/config";
import { prisma } from "@ke/database";
import { registerAuth } from "./plugins/auth.js";
import { createStorageClient, type StorageClient } from "./lib/storage.js";
import { initQueue } from "./lib/queue.js";
import { initSocket } from "./lib/socket.js";
import { registerRealtimeHandlers } from "./lib/realtime.js";
import { startJanitor } from "./lib/janitor.js";
import { authRoutes } from "./routes/auth.js";
import { eventRoutes } from "./routes/events.js";
import { judgeRoutes } from "./routes/judges.js";
import { sectionRoutes } from "./routes/sections.js";
import { startupRoutes } from "./routes/startups.js";
import { deckRoutes } from "./routes/decks.js";
import { pitchRoutes } from "./routes/pitches.js";
import { joinRoutes } from "./routes/join.js";
import { viewerRoutes } from "./routes/viewer.js";
import { securityRoutes } from "./routes/security.js";
import { systemRoutes } from "./routes/system.js";

export interface ApiApp {
  app: FastifyInstance;
  env: ApiEnv;
  storage: StorageClient;
}

export async function buildApiApp(): Promise<ApiApp> {
  const env = loadEnv(apiEnvSchema);
  const app = Fastify({ logger: true, trustProxy: true });

  const allowedOrigins = corsOrigins(env);
  await app.register(cors, {
    origin: (origin, cb) => {
      // No Origin header (same-origin, curl, service-to-service) is allowed through.
      if (!origin) return cb(null, true);
      cb(null, allowedOrigins.includes(origin));
    },
    credentials: true,
  });
  await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } });
  await registerAuth(app, env);

  const storage: StorageClient = createStorageClient(
    env.STORAGE_URL,
    process.env.STORAGE_TOKEN ?? "dev-storage-token-change-me"
  );

  app.get("/api/health", async () => ({
    ok: true,
    uptime: process.uptime(),
    db: await prisma.$queryRaw`SELECT 1`
      .then(() => "up")
      .catch(() => "down"),
  }));

  app.register(async (api) => {
    api.get("/version", async () => ({ name: "ke-pitch-api", version: "0.1.0" }));

    await authRoutes(api, env);
    await eventRoutes(api, env);
    await judgeRoutes(api, env);
    await sectionRoutes(api, env);
    await startupRoutes(api, env);
    await deckRoutes(api, env, storage);
    await pitchRoutes(api, env);
    await joinRoutes(api, env);
    await viewerRoutes(api, env, storage);
    await securityRoutes(api, env);
    await systemRoutes(api, env);
  }, { prefix: "/api/v1" });

  return { app, env, storage };
}

export async function startApi(): Promise<ApiApp> {
  const { app, env, storage } = await buildApiApp();

  initQueue(env.REDIS_URL);
  initSocket(app.server, env);
  registerRealtimeHandlers();
  startJanitor();

  await app.ready();
  const address = await app.listen({ port: env.PORT, host: "0.0.0.0" });
  app.log.info(`API listening on ${address}`);

  return { app, env, storage };
}