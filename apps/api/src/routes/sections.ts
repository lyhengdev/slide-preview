import { type FastifyInstance } from "fastify";
import { bodySchema } from "../lib/schema.js";
import { z } from "zod";
import { prisma } from "@ke/database";
import { createSectionSchema, updateSectionSchema } from "@ke/validation";
import { writeAudit } from "../lib/audit.js";
import { guardEvent } from "../lib/access.js";
import type { ApiEnv } from "@ke/config";

export async function sectionRoutes(app: FastifyInstance, _env: ApiEnv): Promise<void> {
  app.register(async (admin) => {
    admin.addHook("preHandler", admin.requireAdmin);

    admin.post("/events/:eventId/sections", { schema: { body: bodySchema(createSectionSchema) } }, async (req, reply) => {
      const { eventId } = req.params as { eventId: string };
      const body = req.body as z.infer<typeof createSectionSchema>;
      const ctx = req.auth as { userId: string; role: string };
      if (await guardEvent(reply, eventId, ctx)) return reply;

      const section = await prisma.pitchSection.create({
        data: { eventId, name: body.name, type: body.type, order: body.order },
      });
      await writeAudit({
        adminId: ctx.userId,
        action: "SECTION_CREATED",
        targetType: "Event",
        targetId: eventId,
        metadata: { sectionId: section.id, name: section.name },
        request: req,
      });
      return reply.code(201).send(section);
    });

    admin.patch("/sections/:id", { schema: { body: bodySchema(updateSectionSchema) } }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof updateSectionSchema>;
      const ctx = req.auth as { userId: string; role: string };
      const section = await prisma.pitchSection.findUnique({ where: { id }, select: { eventId: true } });
      if (!section) return reply.code(404).send({ error: "Round not found" });
      if (await guardEvent(reply, section.eventId, ctx)) return reply;

      const updated = await prisma.pitchSection.update({ where: { id }, data: body });
      await writeAudit({
        adminId: ctx.userId,
        action: "SECTION_UPDATED",
        targetType: "Event",
        targetId: section.eventId,
        metadata: { sectionId: id, ...body },
        request: req,
      });
      return updated;
    });

    admin.delete("/sections/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = req.auth as { userId: string; role: string };
      const section = await prisma.pitchSection.findUnique({ where: { id }, select: { eventId: true } });
      if (!section) return reply.code(404).send({ error: "Round not found" });
      if (await guardEvent(reply, section.eventId, ctx)) return reply;

      await prisma.pitchSection.delete({ where: { id } });
      await writeAudit({
        adminId: ctx.userId,
        action: "SECTION_DELETED",
        targetType: "Event",
        targetId: section.eventId,
        metadata: { sectionId: id },
        request: req,
      });
      return reply.send({ ok: true });
    });
  });
}