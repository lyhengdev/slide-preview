import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { prisma } from "@ke/database";
import type { ApiEnv } from "@ke/config";
import { securityRoutes } from "../src/routes/security.js";

test("security override relaxes enforcement without corrupting the event default", async (t) => {
  const app = Fastify();
  function replaceMethod(target: any, name: string, implementation: () => Promise<unknown>) {
    const original = target[name];
    target[name] = implementation;
    t.after(() => { target[name] = original; });
  }
  const upserts: Array<{ where: { eventId: string }; update: Record<string, unknown>; create: Record<string, unknown> }> = [];
  let pitchStatus = "ACTIVE";
  replaceMethod(prisma.pitchSession, "findUnique", async () => ({ id: "pitch-1", eventId: "event-1", status: pitchStatus }));
  replaceMethod(prisma.event, "findUnique", async () => ({ createdById: "admin-1" }));
  replaceMethod(prisma.eventSecuritySettings, "upsert", async (args: any) => {
    upserts.push(args);
    return { id: "settings-1", eventId: args.where.eventId };
  });
  replaceMethod(prisma.auditLog, "create", async () => ({ id: "audit-1" }));
  app.decorate("requireJudge", async (req: any) => {
    req.auth = { sessionId: "session-1", judgeId: "judge-1", eventId: "event-1" };
  });
  app.decorate("requireAdmin", async (req: any) => {
    req.auth = { userId: "admin-1", role: "EVENT_ADMIN" };
  });
  await securityRoutes(app, {} as ApiEnv);
  t.after(() => app.close());

  await t.test("relaxing to LOG only writes the temporary override column", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/pitches/pitch-1/security-override",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ detectionAction: "LOG" }),
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().detectionAction, "LOG");
    assert.equal(upserts.length, 1);
    assert.equal(upserts[0].update.overrideDetectionAction, "LOG");
    // The event's real enforcement default must stay untouched.
    assert.equal("detectionAction" in upserts[0].update, false);
    assert.equal("detectionAction" in upserts[0].create, false);
  });

  await t.test("clearing the override restores the event default", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/pitches/pitch-1/security-override",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ detectionAction: null }),
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().detectionAction, null);
    assert.equal(upserts[1].update.overrideDetectionAction, null);
  });

  await t.test("an ended pitch cannot write the event-wide override", async () => {
    pitchStatus = "ENDED";
    const response = await app.inject({
      method: "POST",
      url: "/pitches/pitch-1/security-override",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ detectionAction: "LOCK" }),
    });
    assert.equal(response.statusCode, 400);
    // No override row was written for the (ended) pitch.
    assert.equal(upserts.length, 2);
  });
});