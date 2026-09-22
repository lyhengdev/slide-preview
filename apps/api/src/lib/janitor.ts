import { prisma } from "@ke/database";

const DEFAULT_INTERVAL_MS = 5 * 60_000;

/**
 * A deck left in PROCESSING for a long time means the worker grabbed the
 * job and then died (only worker = nobody marks it stalled, so BullMQ never
 * retries). Fail it so the admin sees the error and can hit Reprocess.
 */
function staleProcessingCutoff(): Date {
  return new Date(Date.now() - 15 * 60_000);
}

/**
 * Keeps the judge_session table honest: sessions past their expiry are marked
 * EXPIRED so device binding and the admin connection list stop seeing them as
 * active. Runs immediately once, then on an interval that never holds the
 * process open.
 */
export function startJanitor(intervalMs = DEFAULT_INTERVAL_MS): NodeJS.Timeout {
  const run = async (): Promise<void> => {
    try {
      await prisma.judgeSession.updateMany({
        where: { status: "ACTIVE", expiresAt: { lt: new Date() } },
        data: { status: "EXPIRED" },
      });
    } catch {
      // Non-fatal: the next tick retries.
    }
    try {
      await prisma.deck.updateMany({
        where: { status: "PROCESSING", updatedAt: { lt: staleProcessingCutoff() } },
        data: {
          status: "FAILED",
          error: "Processing timed out (worker likely crashed). Use Reprocess to try again.",
        },
      });
    } catch {
      // Non-fatal: the next tick retries.
    }
  };

  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}