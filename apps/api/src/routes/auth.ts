import { type FastifyInstance } from "fastify";
import { bodySchema } from "../lib/schema.js";
import { z } from "zod";
import { prisma } from "@ke/database";
import { hashPassword, signToken, verifyPassword } from "@ke/auth";
import { adminLoginSchema } from "@ke/validation";
import { clearAdminCookie, setAdminCookie } from "../plugins/auth.js";
import type { ApiEnv } from "@ke/config";
import { writeAudit } from "../lib/audit.js";
import { createRateLimiter } from "../lib/rateLimit.js";

export async function authRoutes(app: FastifyInstance, env: ApiEnv): Promise<void> {
  const loginLimiter = createRateLimiter({
    maxAttempts: env.LOGIN_MAX_ATTEMPTS,
    lockoutSeconds: env.LOGIN_LOCKOUT_SECONDS,
  });

  app.post("/auth/login", { schema: { body: bodySchema(adminLoginSchema) } }, async (req, reply) => {
    const { email, password } = req.body as z.infer<typeof adminLoginSchema>;
    const limitKey = `admin:${email.toLowerCase()}:${req.ip}`;

    const decision = loginLimiter.check(limitKey);
    if (!decision.allowed) {
      return reply
        .code(429)
        .header("Retry-After", String(decision.retryAfterSeconds))
        .send({ error: `Too many failed attempts. Try again in ${decision.retryAfterSeconds}s.` });
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      loginLimiter.fail(limitKey);
      return reply.code(401).send({ error: "Invalid email or password" });
    }
    loginLimiter.reset(limitKey);

    const token = signToken({ sub: user.id, type: "admin" }, env.JWT_SECRET, env.ADMIN_SESSION_TTL_HOURS);
    setAdminCookie(reply, token, env, env.ADMIN_SESSION_TTL_HOURS);
    await writeAudit({ adminId: user.id, action: "ADMIN_LOGIN", request: req });

    return reply.send({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  });

  app.post("/auth/logout", async (req, reply) => {
    const ctx = req.auth;
    if (ctx?.isAdmin && ctx.userId) {
      await writeAudit({ adminId: ctx.userId, action: "ADMIN_LOGOUT", request: req });
    }
    clearAdminCookie(reply);
    return reply.send({ ok: true });
  });

  app.get("/auth/me", { preHandler: app.requireAdmin }, async (req) => {
    const ctx = req.auth as { userId: string; role: string };
    const user = await prisma.user.findUnique({ where: { id: ctx.userId } });
    if (!user) return { user: null };
    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  });

  app.post("/auth/register-admin", async (req, reply) => {
    const count = await prisma.user.count();
    if (count > 0) {
      return reply.code(403).send({ error: "An admin account already exists. Bootstrap is closed." });
    }
    const body = z
      .object({ email: z.string().email(), name: z.string().min(1), password: z.string().min(6) })
      .parse(req.body);
    const user = await prisma.user.create({
      data: {
        email: body.email.toLowerCase(),
        name: body.name,
        passwordHash: hashPassword(body.password),
        role: "SUPER_ADMIN",
      },
    });
    return reply.code(201).send({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  });
}