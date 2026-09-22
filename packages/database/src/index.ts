import { PrismaClient } from "../generated/client/index.js";

const nodeEnv =
  (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.NODE_ENV ?? "production";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: nodeEnv === "development" ? ["warn", "error"] : ["error"],
  });

if (nodeEnv !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "../generated/client/index.js";
export type { EventSecuritySettings, DetectionAction, SecurityEventType } from "../generated/client/index.js";

export default prisma;