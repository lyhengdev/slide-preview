import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { prisma } from "@ke/database";
import type { ApiEnv } from "@ke/config";
import { securityRoutes } from "../src/routes/security.js";

test("phone detections use the security-event API and retain confidence and metadata", async (t) => {
  const app = Fastify();
  const oldPitch = prisma.pitchSession.findFirst;
  const oldCreate = prisma.securityEvent.create;
  let saved: any;
  prisma.pitchSession.findFirst = (async () => ({ id: "pitch-1" })) as any;
  prisma.securityEvent.create = (async (args: any) => {
    saved = args.data;
    return { id: "alert-1", createdAt: new Date() };
  }) as any;
  t.after(async () => {
    prisma.pitchSession.findFirst = oldPitch;
    prisma.securityEvent.create = oldCreate;
    await app.close();
  });
  app.decorate("requireJudge", async (req: any) => {
    req.auth = { judgeId: "judge-1", eventId: "event-1", sessionId: "session-1" };
  });
  app.decorate("requireAdmin", async (req: any) => {
    req.auth = { userId: "admin-1", role: "EVENT_ADMIN", isAdmin: true };
  });
  await securityRoutes(app, {} as ApiEnv);
  const metadata = { detector: "efficientdet-lite2-int8", category: "cell phone", count: 1, confirmationMs: 1200 };
  const response = await app.inject({
    method: "POST", url: "/security/events",
    payload: { type: "POSSIBLE_PHONE_DETECTED", confidence: 0.73, metadata },
  });
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json(), { id: "alert-1" });
  assert.deepEqual(saved, { eventId: "event-1", judgeId: "judge-1", pitchSessionId: "pitch-1", type: "POSSIBLE_PHONE_DETECTED", confidence: 0.73, metadata });
});
