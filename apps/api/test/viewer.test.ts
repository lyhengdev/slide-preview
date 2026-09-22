import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { prisma } from "@ke/database";
import type { ApiEnv } from "@ke/config";
import { viewerRoutes } from "../src/routes/viewer.js";

test("judges can browse the active deck independently while session checks remain enforced", async (t) => {
  const app = Fastify();
  // Prisma delegates expose methods through a proxy rather than own properties.
  function replaceMethod(target: any, name: string, implementation: () => Promise<unknown>) {
    const original = target[name];
    target[name] = implementation;
    t.after(() => { target[name] = original; });
  }
  let sessionActive = true;
  let pitchActive = true;
  const pitch = {
    id: "pitch-1",
    currentSlide: 2,
    deck: {
      slideCount: 3,
      slides: [1, 2, 3].map((number) => ({ id: `slide-${number}`, number, filePath: `slide-${number}` })),
    },
    startup: { name: "Example startup" },
    pitchSection: null,
    event: { id: "event-1", title: "Example event" },
  };
  replaceMethod(prisma.judgeSession, "findUnique", async () => ({ status: sessionActive ? "ACTIVE" : "EXPIRED" }));
  replaceMethod(prisma.judge, "findUnique", async () => ({ id: "judge-1", active: true, judgeCode: "J01", name: "Judge" }));
  replaceMethod(prisma.pitchSession, "findFirst", async () => pitchActive ? pitch : null);
  // Existing events may still have the old presenter-follow setting stored.
  replaceMethod(prisma.eventSecuritySettings, "findUnique", async () => ({ allowJudgeNavigation: false, watermark: false, overrideDetectionAction: "WARN", detectionAction: "LOCK" }));
  app.decorate("requireJudge", async (req: any) => {
    req.auth = { sessionId: "session-1", judgeId: "judge-1", eventId: "event-1" };
  });
  await viewerRoutes(app, {} as ApiEnv, {
    fetchAsBuffer: async (id) => ({ data: Buffer.from(id), mime: "image/webp" }),
  });
  t.after(() => app.close());

  await t.test("viewer enables navigation for older events and starts at slide one", async () => {
    const response = await app.inject("/viewer/state");
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().allowJudgeNavigation, true);
    assert.equal(response.json().security.allowJudgeNavigation, true);
    assert.equal(response.json().currentSlide, 1);
    // An in-flight override wins over the event default until it is cleared.
    assert.equal(response.json().security.detectionAction, "WARN");
  });

  await t.test("all slides are available without changing the shared slide", async () => {
    for (const number of [3, 1, 2]) {
      const response = await app.inject(`/viewer/slides/${number}?pitchSessionId=pitch-1`);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body, `slide-${number}`);
      assert.equal(response.headers["cache-control"], "private, max-age=3600");
    }
    assert.equal(pitch.currentSlide, 2);
  });

  await t.test("slides are tiered and served with a cacheable ETag (304 revalidation)", async () => {
    const response = await app.inject("/viewer/slides/1?tier=preview");
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, "slide-1");
    assert.equal(response.headers["cache-control"], "private, max-age=3600");
    const etag = response.headers["etag"];
    assert.ok(typeof etag === "string" && etag.length > 0, "etag header present");
    // Missing tier columns on older decks fall back to the full image.
    const standard = await app.inject("/viewer/slides/2?tier=standard");
    assert.equal(standard.statusCode, 200);
    assert.equal(standard.body, "slide-2");
    // Matching the ETag returns an empty 304 instead of re-transferring bytes.
    const revalidate = await app.inject({
      method: "GET",
      url: "/viewer/slides/1?tier=preview",
      headers: { "if-none-match": etag },
    });
    assert.equal(revalidate.statusCode, 304);
    assert.equal(revalidate.body, "");
  });

  await t.test("invalid slide numbers and stale presentations are rejected", async () => {
    for (const number of ["0", "-1", "1.5", "NaN"]) {
      assert.equal((await app.inject(`/viewer/slides/${number}`)).statusCode, 400);
    }
    assert.equal((await app.inject("/viewer/slides/4")).statusCode, 404);
    assert.equal((await app.inject("/viewer/slides/1?pitchSessionId=old-pitch")).statusCode, 403);
  });

  await t.test("ended presentations and expired judge sessions deny slide access", async () => {
    pitchActive = false;
    assert.equal((await app.inject("/viewer/slides/1")).statusCode, 403);
    assert.equal((await app.inject("/viewer/state")).json().deckActive, false);
    pitchActive = true;
    sessionActive = false;
    assert.equal((await app.inject("/viewer/slides/1")).statusCode, 403);
    assert.equal((await app.inject("/viewer/state")).json().ok, false);
  });
});
