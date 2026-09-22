import { type FastifyInstance } from "fastify";
import { bodySchema } from "../lib/schema.js";
import { z } from "zod";
import { prisma, type DetectionAction } from "@ke/database";
import { randomToken, signToken, verifyPassword } from "@ke/auth";
import { judgeJoinSchema, judgeLoginSchema } from "@ke/validation";
import type { ApiEnv } from "@ke/config";
import { clearJudgeCookie, setJudgeCookie } from "../plugins/auth.js";
import { broadcastToEvent } from "../lib/socket.js";
import { isJudgeOnline } from "../lib/realtime.js";
import { canJudgeViewSection } from "../lib/access.js";
import { createRateLimiter } from "../lib/rateLimit.js";

export async function joinRoutes(app: FastifyInstance, env: ApiEnv): Promise<void> {
  const pinLimiter = createRateLimiter({
    maxAttempts: env.LOGIN_MAX_ATTEMPTS,
    lockoutSeconds: env.LOGIN_LOCKOUT_SECONDS,
  });

  async function denyJoin(opts: {
    eventId: string;
    judgeId?: string;
    pitchSessionId?: string;
    reason: string;
    metadata?: Record<string, unknown>;
  }) {
    await prisma.securityEvent
      .create({
        data: {
          eventId: opts.eventId,
          judgeId: opts.judgeId ?? null,
          pitchSessionId: opts.pitchSessionId ?? null,
          type: "JOIN_DENIED",
          metadata: { reason: opts.reason, ...(opts.metadata ?? {}) },
        },
      })
      .catch(() => undefined);
  }

  app.post("/join/resolve", { schema: { body: bodySchema(judgeJoinSchema) } }, async (req, reply) => {
    const body = req.body as z.infer<typeof judgeJoinSchema>;
    const { token, deviceId } = body;

    const session = await prisma.pitchSession.findUnique({
      where: { joinToken: token },
      include: {
        startup: { select: { id: true, name: true } },
        pitchSection: { select: { id: true, name: true, type: true } },
        event: {
          select: { id: true, title: true, security: true },
        },
      },
    });

    if (!session) return reply.code(400).send({ error: "Invalid or expired join code" });
    if (session.status !== "ACTIVE") {
      await denyJoin({
        eventId: session.eventId,
        pitchSessionId: session.id,
        reason: "PRESENTATION_NOT_ACTIVE",
      });
      return reply.code(400).send({ error: "This presentation is not currently open" });
    }
    if (session.joinTokenExpiresAt && session.joinTokenExpiresAt < new Date()) {
      await denyJoin({
        eventId: session.eventId,
        pitchSessionId: session.id,
        reason: "JOIN_TOKEN_EXPIRED",
      });
      return reply.code(400).send({ error: "Join code expired. Ask the admin to refresh it." });
    }
    const security = session.event.security;

    const securityNeeded = {
      faceDetection: security?.faceDetection ?? false,
      multiplePersonDetection: security?.multiplePersonDetection ?? false,
      phoneDetection: security?.phoneDetection ?? false,
      detectionAction: (security?.overrideDetectionAction ?? security?.detectionAction ?? "LOG") as DetectionAction,
      requireFullscreen: security?.requireFullscreen ?? false,
      blockScreenshots: security?.blockScreenshots ?? false,
      watermark: security?.watermark ?? true,
      hideOnTabSwitch: security?.hideOnTabSwitch ?? true,
      singleDevice: security?.singleDevice ?? true,
    };

    return reply.send({
      event: { id: session.event.id, title: session.event.title },
      startup: { id: session.startup.id, name: session.startup.name },
      section: session.pitchSection
        ? { id: session.pitchSection.id, name: session.pitchSection.name, type: session.pitchSection.type }
        : null,
      pitchSessionId: session.id,
      needsPin: true,
      cameraNeeded: securityNeeded.faceDetection || securityNeeded.multiplePersonDetection || securityNeeded.phoneDetection,
      security: securityNeeded,
      joinToken: token,
    });
  });

  app.post("/join/login", { schema: { body: bodySchema(judgeLoginSchema) } }, async (req, reply) => {
    const body = req.body as z.infer<typeof judgeLoginSchema>;
    const judgeCode = body.judgeCode.trim().toUpperCase();
    const limitKey = `join:${judgeCode}:${req.ip}`;

    const decision = pinLimiter.check(limitKey);
    if (!decision.allowed) {
      return reply
        .code(429)
        .header("Retry-After", String(decision.retryAfterSeconds))
        .send({ error: `Too many failed attempts. Try again in ${decision.retryAfterSeconds}s.` });
    }

    const session = await prisma.pitchSession.findUnique({
      where: { joinToken: body.token },
      include: { event: { include: { security: true } }, pitchSection: true },
    });
    if (!session || session.status !== "ACTIVE") {
      pinLimiter.fail(limitKey);
      return reply.code(400).send({ error: "Presentation is not open" });
    }
    // The QR code is short lived; enforce its expiry at the authentication step
    // too, not only when resolving the link.
    if (session.joinTokenExpiresAt && session.joinTokenExpiresAt < new Date()) {
      await denyJoin({ eventId: session.eventId, pitchSessionId: session.id, reason: "JOIN_TOKEN_EXPIRED" });
      pinLimiter.fail(limitKey);
      return reply.code(400).send({ error: "Join code expired. Ask the admin to refresh it." });
    }

    const judge = await prisma.judge.findFirst({
      where: { eventId: session.eventId, judgeCode, active: true },
    });
    if (!judge) {
      pinLimiter.fail(limitKey);
      await denyJoin({
        eventId: session.eventId,
        pitchSessionId: session.id,
        reason: "UNKNOWN_JUDGE_CODE",
        metadata: { judgeCode },
      });
      return reply.code(401).send({ error: "Invalid judge code" });
    }
    if (!judge.pinHash) {
      return reply.code(403).send({ error: "Judge has no PIN configured. Ask the admin to reset it." });
    }
    if (!verifyPassword(body.pin, judge.pinHash)) {
      pinLimiter.fail(limitKey);
      await denyJoin({
        eventId: session.eventId,
        judgeId: judge.id,
        pitchSessionId: session.id,
        reason: "INVALID_PIN",
        metadata: { judgeCode },
      });
      return reply.code(401).send({ error: "Invalid PIN" });
    }

    // Round assignment is enforced at login and re-checked on every viewer state
// poll and slide request, so a connected judge can never follow a round they
// are not assigned to once assignments come into play.
if (!(await canJudgeViewSection({ eventId: session.eventId, judgeId: judge.id, pitchSectionId: session.pitchSectionId }))) {
  await denyJoin({
    eventId: session.eventId,
    judgeId: judge.id,
    pitchSessionId: session.id,
    reason: "NOT_ASSIGNED_TO_ROUND",
    metadata: { judgeCode, pitchSectionId: session.pitchSectionId },
  });
  return reply.code(403).send({ error: "You are not assigned to this round" });
}

    pinLimiter.reset(limitKey);

    const security = session.event.security;
    const singleDevice = security?.singleDevice ?? true;

    if (singleDevice) {
      const existing = await prisma.judgeSession.findFirst({
        where: { judgeId: judge.id, status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
      });
      if (existing) {
        // The binding is decided from the database, never from live socket
        // presence: it must hold after restarts, redeploys and backgrounded tabs.
        if (existing.deviceId !== body.deviceId) {
          await prisma.securityEvent.create({
            data: {
              eventId: session.eventId,
              judgeId: judge.id,
              pitchSessionId: session.id,
              type: "DEVICE_CHANGE_BLOCKED",
              metadata: {
                existingSessionId: existing.id,
                online: isJudgeOnline(existing.id),
                lastSeenAt: existing.lastSeenAt.toISOString(),
              },
            },
          });
          return reply.code(403).send({
            error: "Judge already connected from another device. Ask the admin to release the session.",
          });
        }
        // Same device reconnecting: retire the previous session and issue a new one.
        await prisma.judgeSession.update({
          where: { id: existing.id },
          data: { status: "TERMINATED" },
        });
      }
    }

    const judgeSession = await prisma.judgeSession.create({
      data: {
        judgeId: judge.id,
        eventId: session.eventId,
        deviceId: body.deviceId,
        userAgent: req.headers["user-agent"] ?? null,
        ip: req.ip ?? null,
        tokenHash: randomToken(32),
        expiresAt: new Date(Date.now() + env.JUDGE_SESSION_TTL_HOURS * 3600 * 1000),
      },
    });

    const token = signToken(
      {
        sub: judgeSession.id,
        type: "judge",
        eventId: session.eventId,
      },
      env.JWT_SECRET,
      env.JUDGE_SESSION_TTL_HOURS
    );

    setJudgeCookie(reply, token, env, env.JUDGE_SESSION_TTL_HOURS);
    broadcastToEvent(session.eventId, "judge:connected", {
      judgeId: judge.id,
      judgeCode: judge.judgeCode,
      sessionId: judgeSession.id,
    });

    return reply.send({
      judge: {
        id: judge.id,
        judgeCode: judge.judgeCode,
        name: judge.name,
        eventId: session.eventId,
        sessionId: judgeSession.id,
        deviceId: body.deviceId,
      },
      token,
    });
  });

  app.post("/join/logout", { preHandler: app.requireJudge }, async (req, reply) => {
    const ctx = req.auth as { sessionId: string };
    await prisma.judgeSession.update({ where: { id: ctx.sessionId }, data: { status: "TERMINATED" } });
    clearJudgeCookie(reply);
    return reply.send({ ok: true });
  });
}