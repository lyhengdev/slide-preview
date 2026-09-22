import Fastify from "fastify";
import { prisma } from "@ke/database";
import { securityRoutes } from "./src/routes/security.js";

const app = Fastify();
function replaceMethod(target: any, name: string, implementation: () => Promise<unknown>) {
  const original = target[name];
  target[name] = implementation;
}
replaceMethod(prisma.pitchSession, "findUnique", async () => ({ id: "pitch-1", eventId: "event-1" }));
replaceMethod(prisma.event, "findUnique", async () => ({ createdById: "admin-1" }));
replaceMethod(prisma.eventSecuritySettings, "upsert", async (args: any) => ({ id: "settings-1" }));
replaceMethod(prisma.auditLog, "create", async () => ({ id: "audit-1" }));
app.decorate("requireAdmin", async (req: any) => { req.auth = { userId: "admin-1", role: "EVENT_ADMIN" }; });
await securityRoutes(app, {} as any);
for (const payload of [{ detectionAction: "LOG" }, { detectionAction: null }]) {
  const res = await app.inject({ method: "POST", url: "/pitches/pitch-1/security-override", headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) });
  console.log(JSON.stringify(payload), "->", res.statusCode, res.body);
}
process.exit(0);