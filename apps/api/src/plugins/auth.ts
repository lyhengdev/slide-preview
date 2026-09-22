import { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyCookie from "@fastify/cookie";
import { verifyToken } from "@ke/auth";
import type { ApiEnv } from "@ke/config";
import type { AdminContext, JudgeContext } from "@ke/types";
import { prisma } from "@ke/database";
import { verifyDeviceToken } from "../lib/device.js";

const ADMIN_COOKIE = "ke_admin";
const JUDGE_COOKIE = "ke_judge";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AdminContext | JudgeContext;
  }
  interface FastifyInstance {
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;
    requireJudge: (req: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;
  }
}

/**
 * The web app is deployed as its own static site, so cookies must be sent on
 * cross-site XHR and Socket.IO handshakes. SameSite=None (which browsers only
 * accept together with Secure) is required there; plain http development keeps
 * the stricter Lax behaviour.
 */
function sessionCookie(env: ApiEnv, maxAgeHours: number) {
  const secure = env.COOKIE_SECURE === true;
  return {
    httpOnly: true,
    secure,
    sameSite: (secure ? "none" : "lax") as "none" | "lax",
    path: "/",
    maxAge: maxAgeHours * 3600,
  };
}

export function setAdminCookie(
  reply: FastifyReply,
  token: string,
  env: ApiEnv,
  maxAgeHours: number
): void {
  reply.setCookie(ADMIN_COOKIE, token, sessionCookie(env, maxAgeHours));
}

export function clearAdminCookie(reply: FastifyReply): void {
  reply.clearCookie(ADMIN_COOKIE, { path: "/" });
}

export function setJudgeCookie(
  reply: FastifyReply,
  token: string,
  env: ApiEnv,
  maxAgeHours: number
): void {
  reply.setCookie(JUDGE_COOKIE, token, sessionCookie(env, maxAgeHours));
}

export function clearJudgeCookie(reply: FastifyReply): void {
  reply.clearCookie(JUDGE_COOKIE, { path: "/" });
}

export async function registerAuth(app: FastifyInstance, env: ApiEnv): Promise<void> {
  await app.register(fastifyCookie, { secret: env.COOKIE_SECRET });
  app.decorateRequest("auth", undefined);

  app.decorate("requireAdmin", async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies[ADMIN_COOKIE] ?? req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token) return reply.code(401).send({ error: "Authentication required" });
    try {
      const payload = verifyToken(token, env.JWT_SECRET);
      if (payload.type !== "admin") return reply.code(403).send({ error: "Admin only" });
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) return reply.code(401).send({ error: "Account not found" });
      req.auth = { userId: user.id, role: user.role, isAdmin: true };
    } catch {
      return reply.code(401).send({ error: "Invalid or expired session" });
    }
  });

  app.decorate("requireJudge", async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies[JUDGE_COOKIE];
    if (!token) return reply.code(401).send({ error: "Judge authentication required" });
    try {
      const payload = verifyToken(token, env.JWT_SECRET);
      if (payload.type !== "judge") return reply.code(403).send({ error: "Judge only" });

      const session = await prisma.judgeSession.findUnique({ where: { id: payload.sub } });
      if (!session || session.status !== "ACTIVE") {
        return reply.code(401).send({ error: "Session no longer active" });
      }
      if (session.expiresAt < new Date()) {
        return reply.code(401).send({ error: "Session expired" });
      }

      const deviceId = req.headers["x-device-id"];
      const headerDevice = Array.isArray(deviceId) ? deviceId[0] : deviceId;
      const deviceTokenParam = (req.query as { dt?: string } | undefined)?.dt;

      // Device binding is mandatory: either the header (XHR/fetch calls) or a
      // signed device token (image URLs, which cannot carry headers).
      let deviceAuthorized = false;
      if (typeof headerDevice === "string" && headerDevice.length > 0) {
        deviceAuthorized = headerDevice === session.deviceId;
      } else if (typeof deviceTokenParam === "string" && deviceTokenParam.length > 0) {
        deviceAuthorized = verifyDeviceToken(
          session.id,
          session.deviceId,
          env.JWT_SECRET,
          deviceTokenParam
        );
      }
      if (!deviceAuthorized) {
        return reply.code(403).send({ error: "Device not authorized for this session" });
      }

      const judge = await prisma.judge.findUnique({ where: { id: session.judgeId } });
      if (!judge || !judge.active) {
        return reply.code(403).send({ error: "Judge account is disabled" });
      }

      await prisma.judgeSession.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });

      req.auth = {
        judgeId: session.judgeId,
        eventId: session.eventId,
        sessionId: session.id,
        isAdmin: false,
      };
    } catch {
      return reply.code(401).send({ error: "Invalid or expired session" });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err.validation) {
      return reply.code(400).send({
        error: "Validation failed",
        details: err.validation.map((v) => v.message),
      });
    }
    app.log.error(err);
    return reply.code(500).send({ error: "Internal server error" });
  });
}