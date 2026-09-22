import { prisma } from "@ke/database";

const DEFAULT_INTERVAL_MS = 5 * 60_000;

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
  };

  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}