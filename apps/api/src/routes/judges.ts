import { type FastifyInstance } from "fastify";
import { bodySchema } from "../lib/schema.js";
import { z } from "zod";
import { prisma } from "@ke/database";
import { createJudgeSchema, updateJudgeSchema } from "@ke/validation";
import { hashPassword, pinCode } from "@ke/auth";
import { writeAudit } from "../lib/audit.js";
import { emitToJudge } from "../lib/socket.js";
import { emitToJudgeSession } from "../lib/realtime.js";
import { guardEvent, eventIdForJudge } from "../lib/access.js";
import type { ApiEnv } from "@ke/config";

/** Never expose the PIN hash to clients. */
const judgeSelect = {
  id: true,
  eventId: true,
  judgeCode: true,
  name: true,
  email: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function judgeRoutes(app: FastifyInstance, _env: ApiEnv): Promise<void> {
  app.register(async (admin) => {
    admin.addHook("preHandler", admin.requireAdmin);

    admin.get("/events/:eventId/judges", async (req, reply) => {
      const { eventId } = req.params as { eventId: string };
      const ctx = req.auth as { userId: string; role: string };
      if (await guardEvent(reply, eventId, ctx)) return reply;
      return prisma.judge.findMany({
        where: { eventId },
        select: {
          ...judgeSelect,
          _count: { select: { sessions: true } },
          assignments: { include: { pitchSection: true } },
        },
        orderBy: { judgeCode: "asc" },
      });
    });

    admin.post("/events/:eventId/judges", { schema: { body: bodySchema(createJudgeSchema) } }, async (req, reply) => {
      const { eventId } = req.params as { eventId: string };
      const body = req.body as z.infer<typeof createJudgeSchema>;
      const ctx = req.auth as { userId: string; role: string };
      if (await guardEvent(reply, eventId, ctx)) return reply;

      const existing = await prisma.judge.findMany({ where: { eventId }, select: { judgeCode: true } });
      const used = new Set(existing.map((j) => j.judgeCode));
      let seq = existing.length + 1;
      while (used.has(`J${String(seq).padStart(3, "0")}`)) seq += 1;
      const code = `J${String(seq).padStart(3, "0")}`;
      const pin = body.pin ?? pinCode(4);

      const judge = await prisma.judge.create({
        data: {
          eventId,
          judgeCode: code,
          name: body.name,
          email: body.email?.toLowerCase() ?? null,
          pinHash: hashPassword(pin),
        },
        select: judgeSelect,
      });

      await writeAudit({
        adminId: ctx.userId,
        action: "JUDGE_CREATED",
        targetType: "Event",
        targetId: eventId,
        metadata: { judgeId: judge.id, judgeCode: judge.judgeCode },
        request: req,
      });

      return reply.code(201).send({ ...judge, generatedPin: pin });
    });

    admin.patch("/judges/:id", { schema: { body: bodySchema(updateJudgeSchema) } }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof updateJudgeSchema>;
      const ctx = req.auth as { userId: string; role: string };
      if (await guardEvent(reply, await eventIdForJudge(id), ctx)) return reply;

      const judge = await prisma.judge.update({
        where: { id },
        data: {
          name: body.name,
          email: body.email === undefined ? undefined : body.email ? body.email.toLowerCase() : null,
          active: body.active,
          pinHash: body.pin ? hashPassword(body.pin) : undefined,
        },
        select: judgeSelect,
      });

      // A disabled judge must not keep watching an open deck: terminate their
      // live sessions and push the lock immediately, instead of leaving it to
      // (up to) the next state poll to hide the already-loaded slide.
      let terminatedCount = 0;
      if (body.active === false) {
        const result = await prisma.judgeSession.updateMany({
          where: { judgeId: id, status: "ACTIVE" },
          data: { status: "TERMINATED" },
        });
        terminatedCount = result.count;
        if (terminatedCount > 0) emitToJudge(id, "judge:terminated", { reason: "account_disabled" });
      }

      await writeAudit({
        adminId: ctx.userId,
        action: "JUDGE_UPDATED",
        targetType: "Judge",
        targetId: id,
        metadata: { judgeCode: judge.judgeCode, pinReset: !!body.pin, active: judge.active, terminatedSessions: terminatedCount },
        request: req,
      });

      return { ...judge, generatedPin: body.pin ?? undefined };
    });

    admin.delete("/judges/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = req.auth as { userId: string; role: string };
      const eventId = await eventIdForJudge(id);
      if (await guardEvent(reply, eventId, ctx)) return reply;
      await prisma.judge.delete({ where: { id } });
      await writeAudit({
        adminId: ctx.userId,
        action: "JUDGE_DELETED",
        targetType: "Event",
        targetId: eventId ?? undefined,
        metadata: { judgeId: id },
        request: req,
      });
      return reply.send({ ok: true });
    });

    admin.post("/judges/:id/assignments", async (req, reply) => {
      const { id } = req.params as { id: string };
      const { pitchSectionId } = req.body as { pitchSectionId?: string };
      const ctx = req.auth as { userId: string; role: string };
      if (!pitchSectionId) return reply.code(400).send({ error: "pitchSectionId is required" });

      const judge = await prisma.judge.findUnique({ where: { id }, select: { id: true, eventId: true } });
      if (!judge) return reply.code(404).send({ error: "Judge not found" });
      if (await guardEvent(reply, judge.eventId, ctx)) return reply;

      const section = await prisma.pitchSection.findUnique({
        where: { id: pitchSectionId },
        select: { eventId: true },
      });
      if (!section) return reply.code(404).send({ error: "Round not found" });
      // A round from another event must never be attached to this judge; it
      // would give them access to a presentation they have no right to see.
      if (section.eventId !== judge.eventId) {
        return reply.code(400).send({ error: "Round belongs to a different event" });
      }

      const assignment = await prisma.judgeAssignment.upsert({
        where: { judgeId_pitchSectionId: { judgeId: judge.id, pitchSectionId } },
        create: { judgeId: judge.id, pitchSectionId },
        update: {},
      });
      return reply.code(201).send(assignment);
    });

    admin.delete("/judges/:id/assignments/:sectionId", async (req, reply) => {
      const { id, sectionId } = req.params as { id: string; sectionId: string };
      const ctx = req.auth as { userId: string; role: string };
      if (await guardEvent(reply, await eventIdForJudge(id), ctx)) return reply;
      await prisma.judgeAssignment.deleteMany({
        where: { judgeId: id, pitchSectionId: sectionId },
      });
      return reply.send({ ok: true });
    });

    admin.get("/judges/:id/sessions", async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = req.auth as { userId: string; role: string };
      if (await guardEvent(reply, await eventIdForJudge(id), ctx)) return reply;
      return prisma.judgeSession.findMany({
        where: { judgeId: id },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
    });

    admin.post("/judges/:id/sessions/:sessionId/terminate", async (req, reply) => {
      const { id, sessionId } = req.params as { id: string; sessionId: string };
      const ctx = req.auth as { userId: string; role: string };

      const judge = await prisma.judge.findUnique({ where: { id }, select: { id: true, eventId: true } });
      if (!judge) return reply.code(404).send({ error: "Judge not found" });
      if (await guardEvent(reply, judge.eventId, ctx)) return reply;

      // The session in the URL must actually belong to this judge (and thus to
      // the authorized event); otherwise a session id guessed from another event
      // would be terminated here.
      const session = await prisma.judgeSession.findFirst({
        where: { id: sessionId, judgeId: id, eventId: judge.eventId },
        select: { id: true, eventId: true },
      });
      if (!session) return reply.code(404).send({ error: "Judge session not found" });

      await prisma.judgeSession.update({
        where: { id: session.id },
        data: { status: "TERMINATED" },
      });

      // Push the lock only to this exact session: terminating one device must
      // not hide the deck on the judge's other open devices (singleDevice off).
      emitToJudgeSession(session.id, "judge:terminated", {
        sessionId: session.id,
        reason: "terminated_by_admin",
      });

      await writeAudit({
        adminId: ctx.userId,
        action: "JUDGE_SESSION_TERMINATED",
        targetType: "JudgeSession",
        targetId: session.id,
        metadata: { judgeId: id, eventId: session.eventId },
        request: req,
      });
      return { id: session.id, status: "TERMINATED" };
    });

    /**
     * "Allow device change": releases every active session for this judge so they
     * can sign in again from a different phone or laptop.
     */
    admin.post("/judges/:id/sessions/release", async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = req.auth as { userId: string; role: string };
      const eventId = await eventIdForJudge(id);
      if (await guardEvent(reply, eventId, ctx)) return reply;

      const result = await prisma.judgeSession.updateMany({
        where: { judgeId: id, status: "ACTIVE" },
        data: { status: "TERMINATED" },
      });

      if (result.count > 0) emitToJudge(id, "judge:terminated", { reason: "device_change_allowed" });

      await writeAudit({
        adminId: ctx.userId,
        action: "JUDGE_SESSION_RELEASED",
        targetType: "Judge",
        targetId: id,
        metadata: { released: result.count },
        request: req,
      });
      return { released: result.count };
    });
  });
}
