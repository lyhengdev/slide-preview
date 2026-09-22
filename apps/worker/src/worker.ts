import "dotenv/config";
import { Worker } from "bullmq";
import { loadEnv, workerEnvSchema } from "@ke/config";
import { prisma } from "@ke/database";
import { processDeck, persistSlides, failDeck } from "./deckProcessor.js";

const env = loadEnv(workerEnvSchema);

const connectionFromUrl = (url: string) => {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
};

const worker = new Worker<{ deckId: string; startupId: string; storageId: string; originalName: string; mime: string }>(
  "deck-processing",
  async (job) => {
    const { deckId, startupId, storageId, originalName, mime } = job.data;
    console.log(`[worker] processing deck ${deckId} (${originalName})`);

    await prisma.deck.update({
      where: { id: deckId },
      data: { status: "PROCESSING", error: null },
    });

    try {
      const result = await processDeck({
        deckId,
        startupId,
        storageId,
        originalName,
        mime,
        env,
      });
      await persistSlides({ deckId, slides: result.slides, env });
      console.log(`[worker] deck ${deckId} ready with ${result.slides.length} slides`);
    } catch (err) {
      console.error(`[worker] deck ${deckId} failed`, err);
      await failDeck(deckId, err);
      throw err;
    }
  },
  {
    connection: connectionFromUrl(env.REDIS_URL),
    concurrency: 1,
  }
);

worker.on("ready", () => console.log("[worker] connected to queue"));
worker.on("failed", (job, err) => {
  console.error(`[worker] job ${job?.id} failed after retries`, err.message);
});

process.on("SIGINT", async () => {
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
});

console.log("[worker] deck processing worker started");