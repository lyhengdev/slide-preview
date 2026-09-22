import { z } from "zod";
import { type FastifyInstance } from "fastify";
import { bodySchema } from "../lib/schema.js";
import { prisma } from "@ke/database";
import QRCode from "qrcode";
import { randomToken } from "@ke/auth";
import { beginPitchSchema, changeSlideSchema, refreshJoinTokenSchema } from "@ke/validation";
import type { ApiEnv } from "@ke/config";
import { writeAudit } from "../lib/audit.js";
import { broadcastToEvent, broadcastToPitchSession } from "../lib/socket.js";
import { guardEvent } from "../lib/access.js";

export function qrJoinUrl(env: ApiEnv, token: string): string {
  const base = env.WEB_URL.endsWith("/") ? env.WEB_URL.slice(0, -1) : env.WEB_URL;
  return `${base}/join?token=${encodeURIComponent(token)}`;
}

export async function pitchRoutes(app: FastifyInstance, env: ApiEnv): Promise<void> {
  app.register(async (admin) => {
    admin.addHook("preHandler", admin.requireAdmin);

    // The one-pitch camera override is scoped to a single presentation only.
    // Clear it whenever that pitch ends so it cannot leak into a later one.
    async function clearEventOverride(eventId: string): Promise<void> {
      await prisma.eventSecuritySettings.updateMany({
        where: { eventId, overrideDetectionAction: { not: null } },
        data: { overrideDetectionAction: null },
      });
    }

    admin.post("/events/:eventId/pitches", { schema: { body: bodySchema(beginPitchSchema) } }, async (req, reply) => {
      const { eventId } = req.params as { eventId: string };
      const body = req.body as z.infer<typeof beginPitchSchema>;
      const ctx = req.auth as { userId: string; role: string };

      if (await guardEvent(reply, eventId, ctx)) return reply;

      const startup = await prisma.startup.findFirst({
        where: { id: body.startupId, eventId },
        include: { decks: { where: { status: "READY" }, orderBy: { updatedAt: "desc" } } },
      });
      if (!startup) return reply.code(404).send({ error: "Startup not found" });
      const deck = startup.decks[0];
      if (!deck) return reply.code(400).send({ error: "Startup has no ready deck" });

      // A round from another event must never be attached to this pitch: it
      // would defeat the round-based join restriction.
      const resolvedSectionId = body.pitchSectionId ?? startup.pitchSectionId ?? null;
      if (resolvedSectionId) {
        const section = await prisma.pitchSection.findUnique({
          where: { id: resolvedSectionId },
          select: { eventId: true },
        });
        if (!section || section.eventId !== eventId) {
          return reply.code(400).send({ error: "Round belongs to a different event" });
        }
      }

      await prisma.pitchSession.updateMany({
        where: { eventId, status: "ACTIVE" },
        data: { status: "ENDED", endedAt: new Date() },
      });

      // The previous pitch is over; its one-pitch camera override must not
      // carry into the presentation about to start.
      await clearEventOverride(eventId);

      const joinToken = randomToken(24);
      const expiresAt = new Date(Date.now() + env.QR_TOKEN_TTL_SECONDS * 1000);

      const session = await prisma.pitchSession.create({
        data: {
          eventId,
          // Live Control starts pitches without an explicit round in some flows;
          // fall back to the startup's own round assignment so the round-based
          // join restriction is never silently skipped.
          pitchSectionId: resolvedSectionId,
          startupId: startup.id,
          deckId: deck.id,
          status: "ACTIVE",
          currentSlide: 1,
          joinToken,
          joinTokenExpiresAt: expiresAt,
          startedAt: new Date(),
        },
        include: { startup: true, deck: true, pitchSection: true },
      });

      const qr = await QRCode.toDataURL(qrJoinUrl(env, joinToken), {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 480,
      });

      await writeAudit({
        adminId: ctx.userId,
        action: "PITCH_STARTED",
        targetType: "Event",
        targetId: eventId,
        metadata: { pitchSessionId: session.id, startupId: startup.id, deckId: deck.id },
        request: req,
      });

      broadcastToEvent(eventId, "pitch:started", {
        pitchSessionId: session.id,
        startupName: startup.name,
        deckId: deck.id,
        slideCount: deck.slideCount,
        currentSlide: 1,
      });

      return reply.code(201).send({ session, qr, qrUrl: qrJoinUrl(env, joinToken), expiresAt });
    });

    admin.post("/pitches/:id/end", async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = req.auth as { userId: string; role: string };

      const session = await prisma.pitchSession.findUnique({
        where: { id },
        include: { event: true },
      });
      if (!session) return reply.code(404).send({ error: "Pitch session not found" });
      if (await guardEvent(reply, session.eventId, ctx)) return reply;

      await prisma.pitchSession.update({
        where: { id },
        data: { status: "ENDED", endedAt: new Date(), joinToken: null, joinTokenExpiresAt: null },
      });

      // One-pitch camera override is spent once the presentation ends.
      await clearEventOverride(session.eventId);

      await writeAudit({
        adminId: ctx.userId,
        action: "PITCH_ENDED",
        targetType: "Event",
        targetId: session.eventId,
        metadata: { pitchSessionId: id },
        request: req,
      });

      broadcastToEvent(session.eventId, "pitch:ended", { pitchSessionId: id });
      broadcastToPitchSession(id, "pitch:locked", {});
      return reply.send({ ok: true });
    });

    admin.post("/pitches/:id/slide", { schema: { body: bodySchema(changeSlideSchema) } }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const { slide } = req.body as z.infer<typeof changeSlideSchema>;
      const ctx = req.auth as { userId: string; role: string };

      const session = await prisma.pitchSession.findUnique({
        where: { id },
        include: { deck: true, event: true },
      });
      if (!session) return reply.code(404).send({ error: "Pitch session not found" });
      if (await guardEvent(reply, session.eventId, ctx)) return reply;
      if (session.status !== "ACTIVE") return reply.code(400).send({ error: "Pitch session is not active" });

      const clamped = Math.min(Math.max(slide, 1), Math.max(session.deck.slideCount, 1));
      await prisma.pitchSession.update({ where: { id }, data: { currentSlide: clamped } });

      await writeAudit({
        adminId: ctx.userId,
        action: "PITCH_SLIDE_CHANGE",
        targetType: "Event",
        targetId: session.eventId,
        metadata: { pitchSessionId: id, slide: clamped },
        request: req,
      });

      broadcastToPitchSession(id, "slide:change", { slide: clamped });
      return { slide: clamped };
    });

    admin.post("/pitches/:id/refresh-token", { schema: { body: bodySchema(refreshJoinTokenSchema) } }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = req.auth as { userId: string; role: string };
      const session = await prisma.pitchSession.findUnique({ where: { id } });
      if (!session) return reply.code(404).send({ error: "Pitch session not found" });
      if (await guardEvent(reply, session.eventId, ctx)) return reply;

      const joinToken = randomToken(24);
      const expiresAt = new Date(Date.now() + env.QR_TOKEN_TTL_SECONDS * 1000);
      await prisma.pitchSession.update({
        where: { id },
        data: { joinToken, joinTokenExpiresAt: expiresAt },
      });

      const qr = await QRCode.toDataURL(qrJoinUrl(env, joinToken), { errorCorrectionLevel: "M", margin: 1, width: 480 });
      return { qr, qrUrl: qrJoinUrl(env, joinToken), expiresAt };
    });

    admin.get("/events/:eventId/pitches", async (req, reply) => {
      const { eventId } = req.params as { eventId: string };
      const ctx = req.auth as { userId: string; role: string };
      if (await guardEvent(reply, eventId, ctx)) return reply;
      return prisma.pitchSession.findMany({
        where: { eventId },
        include: { startup: true, deck: true, pitchSection: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
    });

    admin.get("/events/:eventId/pitches/active", async (req, reply) => {
      const { eventId } = req.params as { eventId: string };
      const ctx = req.auth as { userId: string; role: string };
      if (await guardEvent(reply, eventId, ctx)) return reply;
      const session = await prisma.pitchSession.findFirst({
        where: { eventId, status: "ACTIVE" },
        include: {
          startup: true,
          deck: { include: { slides: { orderBy: { number: "asc" } } } },
          pitchSection: true,
        },
      });
      return { session };
    });
  });
}