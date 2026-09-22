import { Queue } from "bullmq";
import { z } from "zod";

const connectionFromUrl = (url: string) => {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
  };
};

export interface DeckJobData {
  deckId: string;
  startupId: string;
  storageId: string;
  originalName: string;
  mime: string;
}

export const deckQueueSchema = z.object({
  jobId: z.string(),
  data: z.object({
    deckId: z.string(),
    startupId: z.string(),
    storageId: z.string(),
    originalName: z.string(),
    mime: z.string(),
  }),
});

let deckQueue: Queue<DeckJobData> | undefined;

export function initQueue(redisUrl: string): Queue<DeckJobData> {
  deckQueue = new Queue<DeckJobData>("deck-processing", {
    connection: { ...connectionFromUrl(redisUrl), maxRetriesPerRequest: null },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  });
  return deckQueue;
}

export function getQueue(): Queue<DeckJobData> {
  if (!deckQueue) throw new Error("Queue not initialized");
  return deckQueue;
}

export async function enqueueDeckProcessing(data: DeckJobData): Promise<void> {
  await getQueue().add("process-deck", data, { jobId: `deck-${data.deckId}` });
}