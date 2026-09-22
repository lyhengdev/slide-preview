import { type FastifyInstance } from "fastify";
import { bodySchema } from "../lib/schema.js";
import { z } from "zod";
import { prisma } from "@ke/database";
import {
  createEventSchema,
  securitySettingsSchema,
  updateEventSchema,
} from "@ke/validation";
import { writeAudit } from "../lib/audit.js";
import { guardEvent } from "../lib/access.js";
import type { ApiEnv } from "@ke/config";

export async function eventRoutes(app: FastifyInstance, _env: ApiEnv): Promise<void> {
  app.register(async (admin) => {
    admin.addHook("preHandler", admin.requireAdmin);

    admin.get("/events", async (req) => {
      const ctx = req.auth as { userId: string; role: string };
      const where = ctx.role === "SUPER_ADMIN" ? {} : { createdById: ctx.userId };
      return prisma.event.findMany({
        where,
        include: {
          _count: { select: { judges: true, startups: true, sections: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    admin.post("/events", { schema: { body: bodySchema(createEventSchema) } }, async (req, reply) => {
      const ctx = req.auth as { userId: string; role: string };
      const body = req.body as z.infer<typeof createEventSchema>;
      const event = await prisma.event.create({
        data: {
          title: body.title,
          slug: body.slug.toLowerCase(),
          description: body.description,
          startDate: body.startDate ? new Date(body.startDate) : null,
          endDate: body.endDate ? new Date(body.endDate) : null,
          createdById: ctx.userId,
          security: { create: {} },
        },
        include: { security: true },
      });
      await writeAudit({
        adminId: ctx.userId,
        action: "EVENT_CREATED",
        targetType: "Event",
        targetId: event.id,
        metadata: { title: event.title },
        request: req,
      });
      return reply.code(201).send(event);
    });

    admin.get("/events/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = req.auth as { userId: string; role: string };
      if (await guardEvent(reply, id, ctx)) return reply;
      const event = await prisma.event.findUnique({
        where: { id },
        include: {
          security: true,
          sections: { orderBy: { order: "asc" } },
          judges: true,
          startups: { include: { decks: true }, orderBy: { name: "asc" } },
        },
      });
      if (!event) return reply.code(404).send({ error: "Event not found" });
      return event;
    });

    admin.patch("/events/:id", { schema: { body: bodySchema(updateEventSchema) } }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof updateEventSchema>;
      const ctx = req.auth as { userId: string; role: string };

      const exists = await prisma.event.findUnique({ where: { id } });
      if (!exists) return reply.code(404).send({ error: "Event not found" });
      if (await guardEvent(reply, id, ctx)) return reply;

      const event = await prisma.event.update({
        where: { id },
        data: {
          title: body.title,
          slug: body.slug?.toLowerCase(),
          description: body.description,
          status: body.status,
          startDate: body.startDate ? new Date(body.startDate) : undefined,
          endDate: body.endDate ? new Date(body.endDate) : undefined,
        },
        include: { security: true },
      });
      await writeAudit({
        adminId: ctx.userId,
        action: "EVENT_UPDATED",
        targetType: "Event",
        targetId: event.id,
        request: req,
      });
      return event;
    });

    admin.delete("/events/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = req.auth as { userId: string; role: string };
      if (await guardEvent(reply, id, ctx)) return reply;
      await prisma.event.delete({ where: { id } });
      await writeAudit({
        adminId: ctx.userId,
        action: "EVENT_DELETED",
        targetType: "Event",
        targetId: id,
        request: req,
      });
      return reply.send({ ok: true });
    });

    admin.patch("/events/:id/security", { schema: { body: bodySchema(securitySettingsSchema) } }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof securitySettingsSchema>;
      const ctx = req.auth as { userId: string; role: string };
      if (await guardEvent(reply, id, ctx)) return reply;

      const settings = await prisma.eventSecuritySettings.upsert({
        where: { eventId: id },
        create: { eventId: id, ...body },
        update: body,
      });
      await writeAudit({
        adminId: ctx.userId,
        action: "SECURITY_SETTINGS_UPDATED",
        targetType: "Event",
        targetId: id,
        metadata: { ...body },
        request: req,
      });
      return settings;
    });

    admin.get("/events/:id/audit", async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = req.auth as { userId: string; role: string };
      if (await guardEvent(reply, id, ctx)) return reply;
      return prisma.auditLog.findMany({
        where: { OR: [{ targetType: "Event", targetId: id }, { metadata: { path: ["eventId"], equals: id } }] },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
    });

    admin.get("/events/:id/security-events", async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = req.auth as { userId: string; role: string };
      if (await guardEvent(reply, id, ctx)) return reply;
      return prisma.securityEvent.findMany({
        where: { eventId: id },
        include: { judge: { select: { judgeCode: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 500,
      });
    });
  });
}