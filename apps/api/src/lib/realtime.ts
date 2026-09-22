import { prisma } from "@ke/database";
import { broadcastToEvent, emitToSocket, getIo, type AppSocket } from "./socket.js";
import { canAccessEvent } from "./access.js";
import { writeAudit } from "./audit.js";

interface Presence {
  socketId: string;
  judgeId: string;
  judgeCode: string;
  sessionId: string;
  joinedAt: number;
}

const judgePresence = new Map<string, Presence>();

export function isJudgeOnline(sessionId: string): boolean {
  return judgePresence.has(sessionId);
}

/**
 * Deliver an event to exactly one judge session, not every device the judge has
 * open. Terminating a single session must not lock the judge out on all of
 * their other devices. Falls back to nothing when that session is offline
 * (the next poll will pick up the termination anyway).
 */
export function emitToJudgeSession(sessionId: string, event: string, payload: unknown): void {
  const presence = judgePresence.get(sessionId);
  if (presence) emitToSocket(presence.socketId, event, payload);
}

export function registerRealtimeHandlers(): void {
  const io = getIo();

  io.on("connection", (socket: AppSocket) => {
    if (socket.authIsAdmin) {
      const auth = {
        userId: socket.authUserId ?? "",
        role: socket.authUserRole ?? "EVENT_ADMIN",
        isAdmin: true as const,
      };

      socket.on("admin:join", async (payload: { eventId?: string }) => {
        if (!payload?.eventId) return;
        if (!(await canAccessEvent(payload.eventId, auth))) return;
        socket.join(`event:${payload.eventId}`);
        await surveyEventPresence(io, socket, payload.eventId);
      });

      socket.on("admin:change-slide", async (payload: { pitchSessionId: string; slide: number }, ack) => {
        if (!payload?.pitchSessionId) return ack?.({ ok: false, error: "pitchSessionId required" });
        const pitch = await prisma.pitchSession.findUnique({
          where: { id: payload.pitchSessionId },
          include: { deck: true },
        });
        if (!pitch) return ack?.({ ok: false, error: "Not found" });
        if (!(await canAccessEvent(pitch.eventId, auth))) {
          return ack?.({ ok: false, error: "Forbidden" });
        }
        const clamped = Math.min(Math.max(payload.slide, 1), Math.max(pitch.deck.slideCount, 1));
        await prisma.pitchSession.update({
          where: { id: pitch.id },
          data: { currentSlide: clamped },
        });
        io.to(`pitch:${pitch.id}`).emit("slide:change", { slide: clamped });
        broadcastToEvent(pitch.eventId, "pitch:slide-changed", {
          pitchSessionId: pitch.id,
          slide: clamped,
        });
        ack?.({ ok: true, slide: clamped });
      });

      // Event-day escape hatch: temporarily relax camera enforcement without
      // touching the stored event settings.
      socket.on(
        "admin:security-override",
        async (payload: { eventId: string; detectionAction: string | null; pitchSessionId?: string }, ack) => {
          if (!payload?.eventId) return ack?.({ ok: false, error: "eventId required" });
          if (!(await canAccessEvent(payload.eventId, auth))) {
            return ack?.({ ok: false, error: "Forbidden" });
          }
          const action = payload.detectionAction ?? null;
          if (action && !["LOG", "WARN", "BLUR", "LOCK"].includes(action)) {
            return ack?.({ ok: false, error: "Invalid detection action" });
          }

          await writeAudit({
            adminId: auth.userId,
            action: "SECURITY_OVERRIDE",
            targetType: "Event",
            targetId: payload.eventId,
            metadata: { detectionAction: action, pitchSessionId: payload.pitchSessionId ?? null },
          });

          broadcastToEvent(payload.eventId, "security:override", {
            detectionAction: action,
            at: new Date().toISOString(),
          });
          ack?.({ ok: true, detectionAction: action });
        }
      );
      return;
    }

    if (socket.authJudgeId && socket.authEventId) {
      socket.join(`event:${socket.authEventId}`);
      socket.join(`judge:${socket.authJudgeId}`);

      const presence: Presence = {
        socketId: socket.id,
        judgeId: socket.authJudgeId,
        judgeCode: socket.handshake.auth?.judgeCode ?? "?",
        sessionId: socket.authSessionId ?? "",
        joinedAt: Date.now(),
      };
      judgePresence.set(presence.sessionId || socket.id, presence);

      socket.on("pitch:join", (payload: { pitchSessionId?: string }) => {
        if (payload?.pitchSessionId) {
          socket.join(`pitch:${payload.pitchSessionId}`);
        }
        broadcastToEvent(socket.authEventId!, "judge:online", {
          judgeId: presence.judgeId,
          judgeCode: presence.judgeCode,
          sessionId: presence.sessionId,
        });
      });

      socket.on("disconnect", () => {
        judgePresence.delete(presence.sessionId || socket.id);
        broadcastToEvent(socket.authEventId!, "judge:offline", {
          judgeId: presence.judgeId,
          judgeCode: presence.judgeCode,
          sessionId: presence.sessionId,
        });
      });
    }
  });
}

async function surveyEventPresence(io: ReturnType<typeof getIo>, socket: AppSocket, eventId: string): Promise<void> {
  try {
    const rows = await prisma.judgeSession.findMany({
      where: { eventId, status: "ACTIVE", lastSeenAt: { gte: new Date(Date.now() - 30 * 60_000) } },
      include: { judge: { select: { judgeCode: true, name: true } } },
      orderBy: { lastSeenAt: "desc" },
    });
    io.to(socket.id).emit(
      "judge:connection-list",
      rows.map((r) => ({
        sessionId: r.id,
        judgeId: r.judgeId,
        judgeCode: r.judge.judgeCode,
        judgeName: r.judge.name,
        lastSeenAt: r.lastSeenAt,
        online: judgePresence.has(r.id),
      }))
    );
  } catch {
    // non-fatal
  }
}