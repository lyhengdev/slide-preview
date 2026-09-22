import { type FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@ke/database";
import { hashPassword } from "@ke/auth";
import { writeAudit } from "../lib/audit.js";
import type { ApiEnv } from "@ke/config";

export async function systemRoutes(app: FastifyInstance, _env: ApiEnv): Promise<void> {
  app.register(async (admin) => {
    admin.addHook("preHandler", admin.requireAdmin);

    admin.get("/admin/audit-logs", async (req) => {
      const ctx = req.auth as { userId: string; role: string };
      const where = ctx.role === "SUPER_ADMIN" ? {} : { adminId: ctx.userId };
      return prisma.auditLog.findMany({
        where,
        include: { admin: { select: { email: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 300,
      });
    });

    admin.get("/admin/stats", async (req) => {
      const ctx = req.auth as { userId: string; role: string };
      const whereEvents = ctx.role === "SUPER_ADMIN" ? {} : { createdById: ctx.userId };
      const [events, activePitches, activeJudgeSessions, securityEvents24h] = await Promise.all([
        prisma.event.count({ where: whereEvents }),
        prisma.pitchSession.count({ where: { status: "ACTIVE" } }),
        prisma.judgeSession.count({
          where: { status: "ACTIVE", lastSeenAt: { gte: new Date(Date.now() - 30 * 60_000) } },
        }),
        prisma.securityEvent.count({
          where: { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
        }),
      ]);
      return { events, activePitches, activeJudgeSessions, securityEvents24h };
    });

    admin.get("/admin/super/admin-users", async (req, reply) => {
      const ctx = req.auth as { userId: string; role: string };
      if (ctx.role !== "SUPER_ADMIN") return reply.code(403).send({ error: "Super admin only" });
      return prisma.user.findMany({
        select: { id: true, email: true, name: true, role: true, twoFactorEnabled: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      });
    });

    admin.post("/admin/super/admin-users", async (req, reply) => {
      const ctx = req.auth as { userId: string; role: string };
      if (ctx.role !== "SUPER_ADMIN") return reply.code(403).send({ error: "Super admin only" });
      const body = z
        .object({
          email: z.string().email(),
          name: z.string().min(1),
          password: z.string().min(8),
          role: z.enum(["SUPER_ADMIN", "EVENT_ADMIN"]).default("EVENT_ADMIN"),
        })
        .parse(req.body);
      const user = await prisma.user.create({
        data: {
          email: body.email.toLowerCase(),
          name: body.name,
          passwordHash: hashPassword(body.password),
          role: body.role,
        },
      });
      await writeAudit({
        adminId: ctx.userId,
        action: "ADMIN_USER_CREATED",
        targetType: "User",
        targetId: user.id,
        metadata: { email: user.email, role: user.role },
        request: req,
      });
      return reply.code(201).send({
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      });
    });

    admin.patch("/admin/super/admin-users/:id", async (req, reply) => {
      const ctx = req.auth as { userId: string; role: string };
      if (ctx.role !== "SUPER_ADMIN") return reply.code(403).send({ error: "Super admin only" });
      const { id } = req.params as { id: string };
      const body = req.body as { name?: string; role?: "SUPER_ADMIN" | "EVENT_ADMIN"; password?: string; email?: string };
      const user = await prisma.user.update({
        where: { id },
        data: {
          name: body.name,
          role: body.role,
          email: body.email ? body.email.toLowerCase() : undefined,
          passwordHash: body.password ? hashPassword(body.password) : undefined,
        },
      });
      await writeAudit({
        adminId: ctx.userId,
        action: "ADMIN_USER_UPDATED",
        targetType: "User",
        targetId: id,
        request: req,
      });
      return { user: { id: user.id, email: user.email, name: user.name, role: user.role } };
    });
  });
}