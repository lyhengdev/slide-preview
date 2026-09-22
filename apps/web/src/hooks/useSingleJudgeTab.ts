import { useCallback, useEffect, useRef, useState } from "react";

const CHANNEL_NAME = "ke-judge-single-tab";
const LOCK_NAME = "ke:judge-session";
const ACQUIRE_RETRIES = 3;
const ACQUIRE_RETRY_MS = 450;
const CONFLICT_TIMEOUT_MS = 2000;
const BEACON_MS = 5000;

type ChannelMessage = {
  type: "judge-active";
  deviceId: string;
  sessionId: string;
  bornAt: number;
};

export interface SessionIdentity {
  deviceId: string;
  sessionId: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Enforces a single active viewer per judge session across tabs (and windows).
 *
 * Every tab broadcasts a beacon carrying its session identity and a monotonic
 * "born after" timestamp on the BroadcastChannel. When a tab hears from one
 * that started later it immediately yields, so the newest tab always wins and
 * the older one hides its content. Acquisition is also tried through the Web
 * Locks API (`ifAvailable`) to close the gap before beacons cross, and the
 * winning tab holds its lock so the browser treats it as taken. A tab that
 * lost can call `takeOver()` to claim the viewer from this tab.
 *
 * Fallback: platforms without Web Locks still get correct behaviour from the
 * BroadcastChannel alone.
 */
export function useSingleJudgeTab(
  enabled: boolean,
  session: SessionIdentity | null
): { conflict: boolean; takeOver: () => void } {
  const [conflict, setConflictState] = useState(false);
  const conflictRef = useRef(false);
  const bornAtRef = useRef(Date.now());
  const releaseRef = useRef<(() => void) | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const sessionRef = useRef<SessionIdentity | null>(session);
  const enabledRef = useRef(enabled);
  sessionRef.current = session;
  enabledRef.current = enabled;

  const setConflict = (value: boolean) => {
    conflictRef.current = value;
    setConflictState(value);
  };

  const channel = useCallback((): BroadcastChannel => {
    if (!channelRef.current) channelRef.current = new BroadcastChannel(CHANNEL_NAME);
    return channelRef.current;
  }, []);

  const releaseLock = useCallback(() => {
    releaseRef.current?.();
    releaseRef.current = null;
  }, []);

  const announce = useCallback((bornAt: number) => {
    const identity = sessionRef.current;
    if (!identity) return;
    try {
      channel().postMessage({
        type: "judge-active",
        deviceId: identity.deviceId,
        sessionId: identity.sessionId,
        bornAt,
      } satisfies ChannelMessage);
    } catch {
      // Channel construction can fail in exotic environments; the Web Lock
      // still protects us there.
    }
  }, [channel]);

  const acquire = useCallback(async (): Promise<boolean> => {
    if (typeof navigator === "undefined" || !navigator.locks) return true;
    let outcome: boolean | null = null;
    const mark = (value: boolean) => {
      if (outcome === null) outcome = value;
    };
    const running = navigator.locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
      if (!lock) {
        mark(false);
        return;
      }
      mark(true);
      // Returning a promise that never resolves keeps the lock held for this
      // tab's lifetime; `releaseLock()` resolves it to let a newer tab in.
      return new Promise<void>((resolveRelease) => {
        releaseRef.current = resolveRelease;
      });
    });
    // If we acquired the lock the outer promise never settles, so time out and
    // trust the outcome flag rather than waiting forever.
    await Promise.race([running, sleep(CONFLICT_TIMEOUT_MS)]);
    return outcome ?? false;
  }, []);

  useEffect(() => {
    if (!enabled || !session) return;

    bornAtRef.current = Date.now();
    setConflict(false);

    const onMessage = (event: MessageEvent<ChannelMessage>) => {
      const message = event.data;
      if (!message || message.type !== "judge-active") return;
      if (message.sessionId !== session.sessionId) return;
      if (message.bornAt > bornAtRef.current) {
        releaseLock();
        setConflict(true);
      }
    };
    channel().addEventListener("message", onMessage);

    void (async () => {
      for (let attempt = 0; attempt < ACQUIRE_RETRIES && !conflictRef.current; attempt++) {
        const acquired = await acquire();
        if (conflictRef.current) return;
        if (acquired) {
          announce(bornAtRef.current);
          break;
        }
        if (attempt === ACQUIRE_RETRIES - 1) setConflict(true);
        await sleep(ACQUIRE_RETRY_MS);
      }
    })();

    const interval = window.setInterval(() => {
      if (!conflictRef.current) announce(bornAtRef.current);
    }, BEACON_MS);

    return () => {
      channel().removeEventListener("message", onMessage);
      window.clearInterval(interval);
      releaseLock();
    };
  }, [enabled, session?.deviceId, session?.sessionId, acquire, announce, channel, releaseLock]);

  const takeOver = useCallback(() => {
    if (!enabledRef.current || !sessionRef.current) return;
    const now = Date.now();
    bornAtRef.current = now;
    setConflict(false);
    // Announce the newer identity FIRST: the other tab's broadcast handler sees
    // a newer bornAt and releases its lock + hides. Announcing only *after*
    // acquiring deadlocks — the lock is held by the tab we are taking over from,
    // so we can never win it before it lets go.
    announce(now);
    void (async () => {
      for (let attempt = 0; attempt < ACQUIRE_RETRIES; attempt++) {
        const acquired = await acquire();
        if (acquired) return;
        // The old tab releases asynchronously; keep nudging with a fresh bornAt
        // so any straggler yields immediately, then grab the freed lock.
        announce(Date.now());
        if (attempt < ACQUIRE_RETRIES - 1) await sleep(ACQUIRE_RETRY_MS);
      }
      setConflict(true);
    })();
  }, [acquire, announce]);

  return { conflict, takeOver };
}