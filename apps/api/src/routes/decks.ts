import { type FastifyInstance } from "fastify";
import { prisma } from "@ke/database";
import { enqueueDeckProcessing } from "../lib/queue.js";
import { writeAudit } from "../lib/audit.js";
import { guardEvent } from "../lib/access.js";
import type { ApiEnv } from "@ke/config";

const ALLOWED_DECK_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "application/octet-stream",
]);

interface AppStorage {
  upload(opts: {
    kind: "originals" | "slides" | "temporary";
    filename: string;
    mime: string;
    data: Buffer;
  }): Promise<{ id: string }>;
  remove(id: string): Promise<void>;
}

export async function deckRoutes(app: FastifyInstance, env: ApiEnv, storage: AppStorage): Promise<void> {
  app.register(async (admin) => {
    admin.addHook("preHandler", admin.requireAdmin);

    admin.post(
      "/events/:eventId/startups/:startupId/decks",
      async (req, reply) => {
        const { eventId, startupId } = req.params as { eventId: string; startupId: string };
        const ctx = req.auth as { userId: string; role: string };

        const startup = await prisma.startup.findFirst({ where: { id: startupId, eventId } });
        if (!startup) return reply.code(404).send({ error: "Startup not found" });
        if (await guardEvent(reply, eventId, ctx)) return reply;

        const data = await req.file();
        if (!data) return reply.code(400).send({ error: "No deck file provided" });

        const mime = data.mimetype || "application/octet-stream";
        if (!ALLOWED_DECK_MIMES.has(mime)) {
          return reply.code(415).send({ error: "Only PDF and PowerPoint files are allowed" });
        }

        const buffer = await data.toBuffer();
        const stored = await storage.upload({
          kind: "originals",
          filename: data.filename || `deck-${Date.now()}`,
          mime,
          data: buffer,
        });

        const deck = await prisma.deck.create({
          data: {
            startupId,
            originalName: data.filename || `deck-${Date.now()}`,
            originalPath: stored.id,
            status: "UPLOADED",
          },
        });

        try {
          await enqueueDeckProcessing({
            deckId: deck.id,
            startupId,
            storageId: stored.id,
            originalName: deck.originalName,
            mime,
          });
        } catch (err) {
          await prisma.deck.update({
            where: { id: deck.id },
            data: { status: "FAILED", error: "Could not enqueue processing job" },
          });
          await writeAudit({
            adminId: ctx.userId,
            action: "DECK_UPLOAD_FAILED",
            targetType: "Event",
            targetId: eventId,
            metadata: { deckId: deck.id },
            request: req,
          });
          return reply.code(202).send({ ...deck, processingError: (err as Error).message });
        }

        await writeAudit({
          adminId: ctx.userId,
          action: "DECK_UPLOADED",
          targetType: "Event",
          targetId: eventId,
          metadata: { deckId: deck.id, filename: deck.originalName, size: buffer.length },
          request: req,
        });

        return reply.code(201).send(deck);
      }
    );

    admin.get("/decks/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = req.auth as { userId: string; role: string };
      const deck = await prisma.deck.findUnique({
        where: { id },
        include: {
          startup: { include: { event: true } },
          slides: { orderBy: { number: "asc" } },
        },
      });
      if (!deck) return reply.code(404).send({ error: "Deck not found" });
      if (await guardEvent(reply, deck.startup.eventId, ctx)) return reply;
      return deck;
    });

    /** Re-queue processing, e.g. after installing LibreOffice or to retry a failure. */
    admin.post("/decks/:id/reprocess", async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = req.auth as { userId: string; role: string };
      const deck = await prisma.deck.findUnique({
        where: { id },
        include: { startup: { select: { eventId: true } } },
      });
      if (!deck) return reply.code(404).send({ error: "Deck not found" });
      if (await guardEvent(reply, deck.startup.eventId, ctx)) return reply;
      if (!deck.originalPath) return reply.code(400).send({ error: "Deck has no stored original file" });

      await prisma.deck.update({
        where: { id },
        data: { status: "UPLOADED", error: null },
      });

      try {
        await enqueueDeckProcessing({
          deckId: deck.id,
          startupId: deck.startupId,
          storageId: deck.originalPath,
          originalName: deck.originalName,
          mime: mimeFromName(deck.originalName),
        });
      } catch (err) {
        await prisma.deck.update({
          where: { id },
          data: { status: "FAILED", error: "Could not enqueue processing job" },
        });
        return reply.code(202).send({ ...deck, processingError: (err as Error).message });
      }

      await writeAudit({
        adminId: ctx.userId,
        action: "DECK_REPROCESS_REQUESTED",
        targetType: "Deck",
        targetId: id,
        metadata: { filename: deck.originalName },
        request: req,
      });
      return reply.code(202).send({ ok: true });
    });

    admin.delete("/decks/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      const deck = await prisma.deck.findUnique({
        where: { id },
        include: { startup: { select: { eventId: true } } },
      });
      if (!deck) return reply.code(404).send({ error: "Deck not found" });
      const ctx = req.auth as { userId: string; role: string };
      if (await guardEvent(reply, deck.startup.eventId, ctx)) return reply;

      const activeSession = await prisma.pitchSession.findFirst({
        where: { deckId: id, status: "ACTIVE" },
        select: { id: true },
      });
      if (activeSession) {
        return reply.code(409).send({ error: "This deck is currently live. End the presentation first." });
      }

      if (deck.originalPath) {
        await storage.remove(deck.originalPath).catch(() => undefined);
      }
      for (const slide of await prisma.slide.findMany({ where: { deckId: id } })) {
        await storage.remove(slide.filePath).catch(() => undefined);
      }
      await prisma.deck.delete({ where: { id } });

      await writeAudit({
        adminId: ctx.userId,
        action: "DECK_DELETED",
        targetType: "Deck",
        targetId: id,
        metadata: { filename: deck.originalName },
        request: req,
      });
      return reply.send({ ok: true });
    });

    admin.get("/events/:eventId/decks/status", async (req, reply) => {
      const { eventId } = req.params as { eventId: string };
      const ctx = req.auth as { userId: string; role: string };
      if (await guardEvent(reply, eventId, ctx)) return reply;
      return prisma.deck.findMany({
        where: { startup: { eventId } },
        include: { startup: { select: { name: true, id: true } } },
        orderBy: { updatedAt: "desc" },
      });
    });
  });
}

function mimeFromName(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (lower.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  return "application/octet-stream";
}

export type { AppStorage };