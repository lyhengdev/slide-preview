import { type FastifyInstance } from "fastify";
import { bodySchema } from "../lib/schema.js";
import { prisma, type SecurityEventType, type Prisma } from "@ke/database";
import { securityEventSchema, securityOverrideSchema } from "@ke/validation";
import type { JudgeContext } from "@ke/types";
import { broadcastToEvent, broadcastToPitchSession } from "../lib/socket.js";
import { guardEvent } from "../lib/access.js";
import { writeAudit } from "../lib/audit.js";
import type { ApiEnv } from "@ke/config";

const EVENT_TYPE_TO_ENUM: Record<string, SecurityEventType> = {
  FACE_MISSING: "FACE_MISSING",
  FACE_RESTORED: "FACE_RESTORED",
  MULTIPLE_PERSONS: "MULTIPLE_PERSONS",
  POSSIBLE_PHONE_DETECTED: "POSSIBLE_PHONE_DETECTED",
  TAB_HIDDEN: "TAB_HIDDEN",
  TAB_VISIBLE: "TAB_VISIBLE",
  FULLSCREEN_EXIT: "FULLSCREEN_EXIT",
  SCREENSHOT_ATTEMPT: "SCREENSHOT_ATTEMPT",
  SCREENSHOT_BLOCKED: "SCREENSHOT_BLOCKED",
  SCREENSHOT_UNBLOCKED: "SCREENSHOT_UNBLOCKED",
  MULTI_TAB_OPEN: "MULTI_TAB_OPEN",
  DEVICE_CHANGE_BLOCKED: "DEVICE_CHANGE_BLOCKED",
  JOIN_DENIED: "JOIN_DENIED",
};

export async function securityRoutes(app: FastifyInstance, _env: ApiEnv): Promise<void> {
  app.register(async (judge) => {
    judge.addHook("preHandler", judge.requireJudge);

    judge.post("/security/events", { schema: { body: bodySchema(securityEventSchema) } }, async (req, reply) => {
      const ctx = req.auth as JudgeContext;
      const body = req.body as { type: string; confidence?: number; metadata?: Record<string, unknown> };
      const enumType = EVENT_TYPE_TO_ENUM[body.type];
      if (!enumType) return reply.code(400).send({ error: `Unknown security event type: ${body.type}` });

      const activePitch = await prisma.pitchSession.findFirst({
        where: { eventId: ctx.eventId, status: "ACTIVE" },
        select: { id: true },
      });

      const record = await prisma.securityEvent.create({
        data: {
          eventId: ctx.eventId,
          judgeId: ctx.judgeId,
          pitchSessionId: activePitch?.id ?? null,
          type: enumType,
          confidence: body.confidence ?? null,
          metadata: (body.metadata as Record<string, Prisma.InputJsonValue>) ?? undefined,
        },
      });

      broadcastToEvent(ctx.eventId, "security:event", {
        judgeId: ctx.judgeId,
        type: body.type,
        confidence: body.confidence,
        metadata: body.metadata,
        createdAt: record.createdAt,
      });

      return reply.code(201).send({ id: record.id });
    });
  });

  app.register(async (admin) => {
    admin.addHook("preHandler", admin.requireAdmin);

    // Event-day escape hatch: relax or restore camera enforcement for one pitch.
    admin.post("/pitches/:id/security-override", { schema: { body: bodySchema(securityOverrideSchema) } }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { pitchSessionId?: string; detectionAction?: "LOG" | "WARN" | "BLUR" | "LOCK" | null };
      const ctx = req.auth as { userId: string; role: string };

      const pitch = await prisma.pitchSession.findUnique({ where: { id }, select: { eventId: true, status: true } });
      if (!pitch) return reply.code(404).send({ error: "Pitch session not found" });
      if (await guardEvent(reply, pitch.eventId, ctx)) return reply;
      // The override is a one-pitch escape hatch: applying it against an ended
      // pitch would leave a stale event-wide enforcement for the next one.
      if (pitch.status !== "ACTIVE") return reply.code(400).send({ error: "Pitch session is not active" });

      const action = body.detectionAction ?? null;
      // Stored in a dedicated override column so the event's real default is
      // never overwritten; `null` clears the override and restores that default.
      await prisma.eventSecuritySettings.upsert({
        where: { eventId: pitch.eventId },
        update: { overrideDetectionAction: action },
        create: { eventId: pitch.eventId, overrideDetectionAction: action },
      });

      await writeAudit({
        adminId: ctx.userId,
        action: "SECURITY_OVERRIDE",
        targetType: "Event",
        targetId: pitch.eventId,
        metadata: { pitchSessionId: id, detectionAction: action },
        request: req,
      });

      broadcastToPitchSession(id, "security:override", { detectionAction: action });
      return { ok: true, detectionAction: action };
    });
  });
}