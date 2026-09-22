import { type FastifyReply } from "fastify";
import { prisma } from "@ke/database";

/** The minimal admin identity the guards need (satisfied by AdminContext too). */
export interface AdminAuth {
  userId: string;
  role: string;
}

/**
 * Event admins may only touch events they created; super admins see everything.
 * Without this an event admin could read or mutate any event by guessing its id.
 */
export async function canAccessEvent(eventId: string, auth: AdminAuth): Promise<boolean> {
  if (auth.role === "SUPER_ADMIN") return true;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { createdById: true },
  });
  return event?.createdById === auth.userId;
}

export function forbidden(reply: FastifyReply, message = "You do not have access to this event") {
  return reply.code(403).send({ error: message });
}

/** Convenience guard: returns true when the handler already sent a 403. */
export async function guardEvent(
  reply: FastifyReply,
  eventId: string | null | undefined,
  auth: AdminAuth
): Promise<boolean> {
  if (!eventId) {
    forbidden(reply, "Event not found");
    return true;
  }
  if (!(await canAccessEvent(eventId, auth))) {
    forbidden(reply);
    return true;
  }
  return false;
}

export async function eventIdForJudge(judgeId: string): Promise<string | null> {
  const judge = await prisma.judge.findUnique({ where: { id: judgeId }, select: { eventId: true } });
  return judge?.eventId ?? null;
}

export async function eventIdForSection(sectionId: string): Promise<string | null> {
  const section = await prisma.pitchSection.findUnique({
    where: { id: sectionId },
    select: { eventId: true },
  });
  return section?.eventId ?? null;
}

export async function eventIdForStartup(startupId: string): Promise<string | null> {
  const startup = await prisma.startup.findUnique({
    where: { id: startupId },
    select: { eventId: true },
  });
  return startup?.eventId ?? null;
}

export async function eventIdForDeck(deckId: string): Promise<string | null> {
  const deck = await prisma.deck.findUnique({
    where: { id: deckId },
    select: { startup: { select: { eventId: true } } },
  });
  return deck?.startup.eventId ?? null;
}

export async function eventIdForPitchSession(pitchSessionId: string): Promise<string | null> {
  const session = await prisma.pitchSession.findUnique({
    where: { id: pitchSessionId },
    select: { eventId: true },
  });
  return session?.eventId ?? null;
}

/**
 * Round admission for an already-connected judge. Assignment is only enforced
 * when the event actually uses assignments, so events that never assign judges
 * keep working unchanged — mirroring the join-time rule.
 */
export async function canJudgeViewSection(args: {
  eventId: string;
  judgeId: string;
  pitchSectionId?: string | null;
}): Promise<boolean> {
  const { eventId, judgeId, pitchSectionId } = args;
  // A pitch without a round cannot be restricted.
  if (!pitchSectionId) return true;
  const assignmentCount = await prisma.judgeAssignment.count({
    where: { judge: { eventId } },
  });
  if (assignmentCount === 0) return true;
  const assignment = await prisma.judgeAssignment.findFirst({
    where: { judgeId, pitchSectionId },
    select: { id: true },
  });
  return assignment !== null;
}