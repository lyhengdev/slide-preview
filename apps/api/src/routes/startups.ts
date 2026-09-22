import { type FastifyInstance } from "fastify";
import { bodySchema } from "../lib/schema.js";
import { z } from "zod";
import { prisma } from "@ke/database";
import { createStartupSchema, updateStartupSchema } from "@ke/validation";
import { writeAudit } from "../lib/audit.js";
import { guardEvent, eventIdForStartup } from "../lib/access.js";
import type { ApiEnv } from "@ke/config";

export async function startupRoutes(app: FastifyInstance, _env: ApiEnv): Promise<void> {
  app.register(async (admin) => {
    admin.addHook("preHandler", admin.requireAdmin);

    admin.post("/events/:eventId/startups", { schema: { body: bodySchema(createStartupSchema) } }, async (req, reply) => {
      const { eventId } = req.params as { eventId: string };
      const body = req.body as z.infer<typeof createStartupSchema>;
      const ctx = req.auth as { userId: string; role: string };
      if (await guardEvent(reply, eventId, ctx)) return reply;

      if (body.pitchSectionId) {
        const section = await prisma.pitchSection.findUnique({
          where: { id: body.pitchSectionId },
          select: { eventId: true },
        });
        if (!section || section.eventId !== eventId) {
          return reply.code(400).send({ error: "Round belongs to a different event" });
        }
      }

      const startup = await prisma.startup.create({
        data: {
          eventId,
          pitchSectionId: body.pitchSectionId ?? null,
          name: body.name,
          description: body.description,
        },
      });
      await writeAudit({
        adminId: ctx.userId,
        action: "STARTUP_CREATED",
        targetType: "Event",
        targetId: eventId,
        metadata: { startupId: startup.id, name: startup.name },
        request: req,
      });
      return reply.code(201).send(startup);
    });

    admin.patch("/startups/:id", { schema: { body: bodySchema(updateStartupSchema) } }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof updateStartupSchema>;
      const ctx = req.auth as { userId: string; role: string };
      const startupEventId = await eventIdForStartup(id);
      if (await guardEvent(reply, startupEventId, ctx)) return reply;

      if (body.pitchSectionId) {
        const section = await prisma.pitchSection.findUnique({
          where: { id: body.pitchSectionId },
          select: { eventId: true },
        });
        if (!section || section.eventId !== startupEventId) {
          return reply.code(400).send({ error: "Round belongs to a different event" });
        }
      }

      return prisma.startup.update({
        where: { id },
        data: {
          name: body.name,
          description: body.description,
          pitchSectionId:
            body.pitchSectionId === undefined ? undefined : body.pitchSectionId ?? null,
        },
      });
    });

    admin.delete("/startups/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = req.auth as { userId: string; role: string };
      if (await guardEvent(reply, await eventIdForStartup(id), ctx)) return reply;
      await prisma.startup.delete({ where: { id } });
      return reply.send({ ok: true });
    });

    admin.get("/startups/:id/decks", async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = req.auth as { userId: string; role: string };
      if (await guardEvent(reply, await eventIdForStartup(id), ctx)) return reply;
      return prisma.deck.findMany({
        where: { startupId: id },
        include: { _count: { select: { slides: true } } },
        orderBy: { createdAt: "desc" },
      });
    });
  });
}