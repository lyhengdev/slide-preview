import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { prisma } from "@ke/database";
import type { ApiEnv } from "@ke/config";
import { viewerRoutes } from "../src/routes/viewer.js";
import { pitchRoutes } from "../src/routes/pitches.js";
import { startupRoutes } from "../src/routes/startups.js";

test("round admission is enforced on the active pitch, not just at login", async (t) => {
  const app = Fastify();
  function replaceMethod(target: any, name: string, implementation: () => Promise<unknown>) {
    const original = target[name];
    target[name] = implementation;
    t.after(() => { target[name] = original; });
  }

  const pitchWithRound = {
    id: "pitch-1",
    pitchSectionId: "section-1",
    currentSlide: 1,
    deck: { slideCount: 1, slides: [{ id: "slide-1", number: 1, filePath: "slide-1", previewPath: "preview-1" }] },
    startup: { id: "startup-1", name: "Demo" },
    pitchSection: { name: "Final Round", type: "FINAL" },
    event: { id: "event-1", title: "Example event" },
  };
  let assignmentsActive = true;
  let judgeAssigned = true;
  replaceMethod(prisma.judgeSession, "findUnique", async () => ({ id: "session-1", status: "ACTIVE", deviceId: "device-1" }));
  replaceMethod(prisma.judge, "findUnique", async () => ({ id: "judge-1", active: true, judgeCode: "J01", name: "Judge" }));
  replaceMethod(prisma.pitchSession, "findFirst", async () => pitchWithRound);
  replaceMethod(prisma.eventSecuritySettings, "findUnique", async () => ({ watermark: false }));
  replaceMethod(prisma.judgeAssignment, "count", async () => (assignmentsActive ? 1 : 0));
  replaceMethod(prisma.judgeAssignment, "findFirst", async () => (judgeAssigned ? { id: "assignment-1" } : null));
  app.decorate("requireJudge", async (req: any) => {
    req.auth = { sessionId: "session-1", judgeId: "judge-1", eventId: "event-1" };
  });
  await viewerRoutes(app, {} as ApiEnv, {
    fetchAsBuffer: async (id) => ({ data: Buffer.from(id), mime: "image/webp" }),
  });
  t.after(() => app.close());

  await t.test("an assigned judge sees the deck and receives slides", async () => {
    const state = await app.inject("/viewer/state");
    assert.equal(state.statusCode, 200);
    assert.equal(state.json().deckActive, true);
    assert.equal(state.json().pitchSessionId, "pitch-1");
    assert.equal(state.json().sectionName, "Final Round");
    const slide = await app.inject("/viewer/slides/1?pitchSessionId=pitch-1");
    assert.equal(slide.statusCode, 200);
  });

  await t.test("an unassigned connected judge is hidden and denied slides", async () => {
    judgeAssigned = false;
    const state = await app.inject("/viewer/state");
    assert.equal(state.statusCode, 200);
    assert.equal(state.json().deckActive, false);
    assert.equal(state.json().pitchSessionId, null);
    assert.equal(state.json().sectionName, null);
    const slide = await app.inject("/viewer/slides/1?pitchSessionId=pitch-1");
    assert.equal(slide.statusCode, 403);
    judgeAssigned = true;
  });

  await t.test("unassigned judges are allowed when the event uses no assignments", async () => {
    assignmentsActive = false;
    judgeAssigned = false;
    const slide = await app.inject("/viewer/slides/1?pitchSessionId=pitch-1");
    assert.equal(slide.statusCode, 200);
  });
});

test("pitch creation rejects a round that belongs to another event", async (t) => {
  const app = Fastify();
  function replaceMethod(target: any, name: string, implementation: () => Promise<unknown>) {
    const original = target[name];
    target[name] = implementation;
    t.after(() => { target[name] = original; });
  }
  let sectionEventId: string | null = "event-1";
  replaceMethod(prisma.event, "findUnique", async () => ({ createdById: "admin-1" }));
  replaceMethod(prisma.startup, "findFirst", async () => ({
    id: "startup-1",
    pitchSectionId: "section-1",
    decks: [{ id: "deck-1", slideCount: 1, status: "READY" }],
  }));
  replaceMethod(prisma.pitchSection, "findUnique", async () => (sectionEventId ? { eventId: sectionEventId } : null));
  replaceMethod(prisma.pitchSession, "updateMany", async () => ({ count: 0 }));
  replaceMethod(prisma.eventSecuritySettings, "updateMany", async () => ({ count: 0 }));
  replaceMethod(prisma.auditLog, "create", async () => ({ id: "audit-1" }));
  app.decorate("requireAdmin", async (req: any) => {
    req.auth = { userId: "admin-1", role: "EVENT_ADMIN" };
  });
  const env = { WEB_URL: "http://localhost:5173", QR_TOKEN_TTL_SECONDS: 900 } as unknown as ApiEnv;
  await pitchRoutes(app, env);
  t.after(() => app.close());

  await t.test("explicit foreign round is rejected", async () => {
    sectionEventId = "event-2";
    const response = await app.inject({
      method: "POST",
      url: "/events/event-1/pitches",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ startupId: "startup-1", pitchSectionId: "section-1" }),
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "Round belongs to a different event");
  });

  await t.test("an in-event round (or none) is accepted", async () => {
    sectionEventId = "event-1";
    replaceMethod(prisma.pitchSession, "create", async (args: any) => ({ id: "pitch-2", ...args.data }));
    const response = await app.inject({
      method: "POST",
      url: "/events/event-1/pitches",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ startupId: "startup-1", pitchSectionId: "section-1" }),
    });
    assert.equal(response.statusCode, 201);
  });
});

test("startup create/update reject a round that belongs to another event", async (t) => {
  const app = Fastify();
  function replaceMethod(target: any, name: string, implementation: () => Promise<unknown>) {
    const original = target[name];
    target[name] = implementation;
    t.after(() => { target[name] = original; });
  }
  replaceMethod(prisma.event, "findUnique", async () => ({ createdById: "admin-1" }));
  let sectionEventId: string | null = "event-1";
  replaceMethod(prisma.pitchSection, "findUnique", async () => (sectionEventId ? { eventId: sectionEventId } : null));
  replaceMethod(prisma.startup, "findUnique", async () => ({ id: "startup-1", eventId: "event-1" }));
  replaceMethod(prisma.auditLog, "create", async () => ({ id: "audit-1" }));
  app.decorate("requireAdmin", async (req: any) => {
    req.auth = { userId: "admin-1", role: "EVENT_ADMIN" };
  });
  await startupRoutes(app, {} as ApiEnv);
  t.after(() => app.close());

  await t.test("create with a foreign round is rejected", async () => {
    sectionEventId = "event-2";
    const response = await app.inject({
      method: "POST",
      url: "/events/event-1/startups",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "Startup", pitchSectionId: "section-1" }),
    });
    assert.equal(response.statusCode, 400);
  });

  await t.test("update with a foreign round is rejected, in-event round succeeds", async () => {
    sectionEventId = "event-2";
    const bad = await app.inject({
      method: "PATCH",
      url: "/startups/startup-1",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ pitchSectionId: "section-1" }),
    });
    assert.equal(bad.statusCode, 400);
    sectionEventId = "event-1";
    replaceMethod(prisma.startup, "update", async () => ({ id: "startup-1", pitchSectionId: "section-1" }));
    const ok = await app.inject({
      method: "PATCH",
      url: "/startups/startup-1",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ pitchSectionId: "section-1" }),
    });
    assert.equal(ok.statusCode, 200);
  });
});