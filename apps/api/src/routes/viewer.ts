import { type FastifyInstance } from "fastify";
import { prisma } from "@ke/database";
import type { JudgeContext } from "@ke/types";
import { applyWatermark } from "../lib/watermark.js";
import { deviceToken } from "../lib/device.js";
import { canJudgeViewSection } from "../lib/access.js";
import type { ApiEnv } from "@ke/config";

interface SlideFetcher {
  fetchAsBuffer(id: string, kind?: string): Promise<{ data: Buffer; mime: string }>;
}

const watermarkCache = new Map<string, { data: Buffer; mime: string; createdAt: number }>();
const CACHE_TTL_MS = 6 * 3600_000;
const MAX_CACHE_ENTRIES = 400;

type SlideTier = "preview" | "standard" | "full";
const SLIDE_TIERS = ["preview", "standard", "full"] as const;

function isTier(value: string | undefined): value is SlideTier {
  return value === "preview" || value === "standard" || value === "full";
}

function cacheKey(slideId: string, judgeCode: string, checksum: string): string {
  return `${slideId}:${judgeCode}:${checksum}`;
}

export async function viewerRoutes(app: FastifyInstance, env: ApiEnv, fetcher: SlideFetcher): Promise<void> {
  app.register(async (judge) => {
    judge.addHook("preHandler", judge.requireJudge);

    judge.get("/viewer/state", async (req) => {
      const ctx = req.auth as JudgeContext;

      const [session, security, judgeRow, activePitch] = await Promise.all([
        prisma.judgeSession.findUnique({ where: { id: ctx.sessionId } }),
        prisma.eventSecuritySettings.findUnique({ where: { eventId: ctx.eventId } }),
        prisma.judge.findUnique({ where: { id: ctx.judgeId } }),
        prisma.pitchSession.findFirst({
          where: { eventId: ctx.eventId, status: "ACTIVE" },
          include: {
            deck: { include: { slides: { orderBy: { number: "asc" } } } },
            startup: { select: { id: true, name: true } },
            pitchSection: { select: { name: true, type: true } },
            event: { select: { title: true, id: true } },
          },
        }),
      ]);

      if (!session || session.status !== "ACTIVE") {
        return replyDenied();
      }
      if (!judgeRow || !judgeRow.active) {
        return replyDenied();
      }

      // Re-check round admission for this connected judge: assignment is not
      // only a login-time gate, it must also hold as pitches move between
      // rounds while a judge's session stays open.
      const mayView = await canJudgeViewSection({
        eventId: ctx.eventId,
        judgeId: ctx.judgeId,
        pitchSectionId: activePitch?.pitchSectionId ?? null,
      });

      const deckActive = activePitch !== null && mayView;
      // Judges always navigate the active deck independently, including older
      // events that still have the old presenter-follow value stored.
      const allowJudgeNavigation = true;
      const slideCount = deckActive ? (activePitch?.deck.slideCount ?? 0) : 0;
      // Judges always start on the first slide; the viewer remembers its own
      // position between reloads while navigation is enabled.
      const currentSlide = deckActive ? 1 : 0;

      return {
        ok: true,
        event: activePitch && mayView
          ? { id: activePitch.event.id, title: activePitch.event.title }
          : null,
        sessionActive: true,
        deckActive,
        pitchSessionId: deckActive ? (activePitch?.id ?? null) : null,
        startupId: deckActive ? (activePitch?.startup.id ?? null) : null,
        startupName: deckActive ? (activePitch?.startup.name ?? null) : null,
        sectionName: deckActive ? (activePitch?.pitchSection?.name ?? null) : null,
        currentSlide,
        slideCount,
        allowJudgeNavigation,
        // Per-slide image size tiers; the client picks based on its network.
        tiers: SLIDE_TIERS,
        // Bearer proof of this device, used for slide images that cannot send headers.
        deviceToken:
          env.JWT_SECRET && session.deviceId
            ? deviceToken(session.id, session.deviceId, env.JWT_SECRET)
            : undefined,
        judge: { code: judgeRow.judgeCode, name: judgeRow.name },
        security: {
          watermark: security?.watermark ?? true,
          watermarkText: security?.watermarkText ?? "CONFIDENTIAL",
          hideOnTabSwitch: security?.hideOnTabSwitch ?? true,
          blockScreenshots: security?.blockScreenshots ?? false,
          requireFullscreen: security?.requireFullscreen ?? false,
          faceDetection: security?.faceDetection ?? false,
          multiplePersonDetection: security?.multiplePersonDetection ?? false,
          phoneDetection: security?.phoneDetection ?? false,
          // An in-flight override (admin console) wins until it is cleared.
          detectionAction: security?.overrideDetectionAction ?? security?.detectionAction ?? "LOG",
          allowJudgeNavigation,
        },
      };

      function replyDenied() {
        return {
          ok: false,
          sessionActive: false,
          deckActive: false,
          currentSlide: 0,
          slideCount: 0,
        } as const;
      }
    });

    judge.get("/viewer/slides/:number", async (req, reply) => {
      const ctx = req.auth as JudgeContext;
      const number = Number((req.params as { number: string }).number);
      const { pitchSessionId, tier } = req.query as { pitchSessionId?: string; tier?: string };
      const slideTier: SlideTier = isTier(tier) ? tier : "full";

      const [session, activePitch, security, judgeRow] = await Promise.all([
        prisma.judgeSession.findUnique({ where: { id: ctx.sessionId } }),
        prisma.pitchSession.findFirst({
          where: { eventId: ctx.eventId, status: "ACTIVE" },
          include: { deck: { include: { slides: { orderBy: { number: "asc" } } } }, startup: true, pitchSection: true },
        }),
        prisma.eventSecuritySettings.findUnique({ where: { eventId: ctx.eventId } }),
        prisma.judge.findUnique({ where: { id: ctx.judgeId } }),
      ]);

      if (!session || session.status !== "ACTIVE" || !judgeRow || !judgeRow.active) {
        return reply.code(403).send({ error: "Session not active" });
      }
      if (!activePitch) return reply.code(403).send({ error: "No active presentation" });

      // Connected judges must meet round assignment on every slide request, not
      // only at QR login.
      if (
        !(await canJudgeViewSection({
          eventId: ctx.eventId,
          judgeId: ctx.judgeId,
          pitchSectionId: activePitch.pitchSectionId,
        }))
      ) {
        return reply.code(403).send({ error: "You are not assigned to this round" });
      }

      if (!Number.isInteger(number) || number < 1) {
        return reply.code(400).send({ error: "Invalid slide number" });
      }
      if (pitchSessionId && pitchSessionId !== activePitch.id) {
        return reply.code(403).send({ error: "Presentation is no longer active" });
      }
      const slide = activePitch.deck.slides.find((s) => s.number === number);
      if (!slide) return reply.code(404).send({ error: "Slide not found" });

      // Older decks (pre-tier) only have the full image; fall back gracefully.
      const usingRealPreview = slideTier === "preview" && slide.previewPath != null;
      const storedPath =
        slideTier === "preview"
          ? (slide.previewPath ?? slide.filePath)
          : slideTier === "standard"
            ? (slide.standardPath ?? slide.filePath)
            : slide.filePath;

      const { data } = await fetcher.fetchAsBuffer(storedPath, "slides");
      if (!data?.length) return reply.code(404).send({ error: "Slide content missing" });

      const watermarkOn = security?.watermark ?? true;
      const watermarkText = (security?.watermarkText ?? "CONFIDENTIAL").toUpperCase();
      const ws = (process.env.SECURITY_SALT_VERSION ?? "v1") + judgeRow.id.slice(-6);
      // Whether these exact bytes are raw or watermarked. The ETag must capture
      // this (and the watermark toggle) or a client that cached the unwatermarked
      // image would be handed a 304 after watermarking was switched on.
      const serveRaw = !watermarkOn || usingRealPreview;
      // Stable per (judge, slide, tier, serve-raw, watermark config): drives the
      // server cache key and the ETag so browsers/Cache Storage can revalidate.
      const checksum = `${ws}:${judgeRow.judgeCode}:${slideTier}:${number}:${watermarkText}:${serveRaw ? "raw" : "wm"}`;
      // Weak ETag: regeneration is byte-deterministic, but a weak tag keeps the
      // semantics correct even if the encoder's output ever differs slightly.
      const etag = `W/"${checksum}"`;

      const setHeaders = () => {
        reply.header("Content-Type", "image/webp");
        reply.header("Cache-Control", "private, max-age=3600");
        reply.header("ETag", etag);
        reply.header("X-Slide-Number", String(number));
      };

      if (req.headers["if-none-match"] === etag) {
        setHeaders();
        return reply.code(304).send();
      }

      // The preview tier is noise-level and is served raw (no watermark): it is
      // tiny, cheap, and degraded enough that it never leaks usable content.
      // This exemption only applies to genuine downscaled previews: when a
      // pre-tier deck lacks a preview image and falls back to the full-size
      // image, that full-res content must still be watermarked.
      if (serveRaw) {
        setHeaders();
        return reply.send(data);
      }

      const cKey = cacheKey(slide.id, judgeRow.judgeCode, checksum);
      const cached = watermarkCache.get(cKey);
      if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
        setHeaders();
        return reply.send(cached.data);
      }

      const event = await prisma.event.findUnique({ where: { id: ctx.eventId } });
      const sectionLabel = activePitch.pitchSection?.name ?? "SESSION";
      const watermarked = await applyWatermark(data, {
        seed: cKey,
        judgeCode: judgeRow.judgeCode,
        eventTitle: event?.title ?? "SECURE PITCH",
        roundLabel: sectionLabel.toUpperCase(),
        confidentialLabel: watermarkText,
        // The live timestamp overlay is rendered client-side by
        // WatermarkOverlay so the server bytes (and ETag) stay cacheable.
      });

      if (watermarkCache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = watermarkCache.keys().next().value as string | undefined;
        if (oldestKey) watermarkCache.delete(oldestKey);
      }
      watermarkCache.set(cKey, { data: watermarked, mime: "image/webp", createdAt: Date.now() });

      setHeaders();
      return reply.send(watermarked);
    });
  });
}