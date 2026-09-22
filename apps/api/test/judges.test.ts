import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { prisma } from "@ke/database";
import type { ApiEnv } from "@ke/config";
import { judgeRoutes } from "../src/routes/judges.js";

test("judge session termination is scoped to the authorized judge and event", async (t) => {
  const app = Fastify();
  function replaceMethod(target: any, name: string, implementation: () => Promise<unknown>) {
    const original = target[name];
    target[name] = implementation;
    t.after(() => { target[name] = original; });
  }

  replaceMethod(prisma.judge, "findUnique", async () => ({ id: "judge-1", eventId: "event-1" }));
  replaceMethod(prisma.event, "findUnique", async () => ({ createdById: "admin-1" }));
  let sessionRow: { id: string; eventId: string } | null = null;
  let terminated: string[] = [];
  replaceMethod(prisma.judgeSession, "findFirst", async () => sessionRow);
  replaceMethod(prisma.judgeSession, "update", async (args: any) => {
    terminated.push(args.where.id);
    return { id: args.where.id, status: "TERMINATED" };
  });
  replaceMethod(prisma.auditLog, "create", async () => ({ id: "audit-1" }));
  app.decorate("requireAdmin", async (req: any) => {
    req.auth = { userId: "admin-1", role: "EVENT_ADMIN" };
  });
  await judgeRoutes(app, {} as ApiEnv);
  t.after(() => app.close());

  await t.test("a session id that does not belong to the judge is rejected", async () => {
    sessionRow = null; // findFirst filters by judgeId, so a foreign session misses
    const response = await app.inject({
      method: "POST",
      url: "/judges/judge-1/sessions/foreign-session/terminate",
    });
    assert.equal(response.statusCode, 404);
    assert.equal(terminated.length, 0);
  });

  await t.test("the judge's own session can be terminated", async () => {
    sessionRow = { id: "session-1", eventId: "event-1" };
    const response = await app.inject({
      method: "POST",
      url: "/judges/judge-1/sessions/session-1/terminate",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, "TERMINATED");
    assert.deepEqual(terminated, ["session-1"]);
  });
});

test("judge assignments reject rounds from another event", async (t) => {
  const app = Fastify();
  function replaceMethod(target: any, name: string, implementation: () => Promise<unknown>) {
    const original = target[name];
    target[name] = implementation;
    t.after(() => { target[name] = original; });
  }

  replaceMethod(prisma.judge, "findUnique", async () => ({ id: "judge-1", eventId: "event-1" }));
  replaceMethod(prisma.event, "findUnique", async () => ({ createdById: "admin-1" }));
  let sectionEventId: string | null = "event-2";
  replaceMethod(prisma.pitchSection, "findUnique", async () => (sectionEventId ? { eventId: sectionEventId } : null));
  let upserted = false;
  replaceMethod(prisma.judgeAssignment, "upsert", async () => {
    upserted = true;
    return { id: "assignment-1", judgeId: "judge-1", pitchSectionId: "section-1" };
  });
  app.decorate("requireAdmin", async (req: any) => {
    req.auth = { userId: "admin-1", role: "EVENT_ADMIN" };
  });
  await judgeRoutes(app, {} as ApiEnv);
  t.after(() => app.close());

  await t.test("a round from a different event is rejected and never upserted", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/judges/judge-1/assignments",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ pitchSectionId: "section-1" }),
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "Round belongs to a different event");
    assert.equal(upserted, false);
  });

  await t.test("an in-event round is accepted", async () => {
    sectionEventId = "event-1";
    const response = await app.inject({
      method: "POST",
      url: "/judges/judge-1/assignments",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ pitchSectionId: "section-1" }),
    });
    assert.equal(response.statusCode, 201);
    assert.equal(upserted, true);
  });
});