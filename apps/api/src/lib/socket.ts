import { type Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { corsOrigins, type ApiEnv } from "@ke/config";
import { prisma } from "@ke/database";
import { verifyToken } from "@ke/auth";

export interface AppSocket extends Socket {
  authUserId?: string;
  authUserRole?: string;
  authIsAdmin?: boolean;
  authJudgeId?: string;
  authEventId?: string;
  authSessionId?: string;
}

let io: Server;

export function initSocket(httpServer: HttpServer, env: ApiEnv): Server {
  io = new Server(httpServer, {
    cors: {
      origin: corsOrigins(env),
      credentials: true,
    },
  });

  io.use(async (socket: AppSocket, next) => {
    try {
      const auth = (socket.handshake.auth ?? {}) as Record<string, string | undefined>;
      const token = auth.token ?? readCookie(socket.handshake.headers.cookie, "ke_admin");
      const judgeToken = auth.judgeToken;

      if (judgeToken) {
        const payload = verifyToken(judgeToken, env.JWT_SECRET);
        if (payload.type === "judge") {
          // The socket is bound to the same device as the HTTP session so a
          // stolen cookie alone cannot subscribe to judge events.
          const session = await prisma.judgeSession.findUnique({ where: { id: payload.sub } });
          if (
            !session ||
            session.status !== "ACTIVE" ||
            session.expiresAt < new Date() ||
            (auth.deviceId ?? "") !== session.deviceId
          ) {
            return next(new Error("Unauthorized"));
          }
          socket.authJudgeId = session.judgeId;
          socket.authEventId = session.eventId;
          socket.authSessionId = session.id;
          return next();
        }
      }

      if (token) {
        const payload = verifyToken(token, env.JWT_SECRET);
        if (payload.type === "admin") {
          const user = await prisma.user.findUnique({ where: { id: payload.sub } });
          if (!user) return next(new Error("Unauthorized"));
          socket.authUserId = user.id;
          socket.authUserRole = user.role;
          socket.authIsAdmin = true;
          return next();
        }
      }

      next(new Error("Unauthorized"));
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  return io;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  return (header ?? "")
    .split("; ")
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export function getIo(): Server {
  if (!io) throw new Error("Socket.IO not initialized");
  return io;
}

export function broadcastToEvent(eventId: string, event: string, payload: unknown): void {
  io?.to(`event:${eventId}`).emit(event, payload);
}

export function broadcastToPitchSession(pitchSessionId: string, event: string, payload: unknown): void {
  io?.to(`pitch:${pitchSessionId}`).emit(event, payload);
}

export function emitToSocket(socketId: string, event: string, payload: unknown): void {
  io?.to(socketId).emit(event, payload);
}

/** Deliver an event to every open tab/device of one judge. */
export function emitToJudge(judgeId: string, event: string, payload: unknown): void {
  io?.to(`judge:${judgeId}`).emit(event, payload);
}