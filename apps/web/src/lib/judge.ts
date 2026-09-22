import { API_BASE_URL } from "./api";
import type { SlideTier } from "./slide-cache";

export interface JudgeSession {
  token: string;
  sessionId: string;
  judgeCode: string;
  judgeName: string;
  eventId: string;
  deviceId: string;
}

const SESSION_KEY = "ke_judge_session";
const DEVICE_KEY = "ke_device_id";
const JUDGE_DEVICE_KEY = "ke_judge_device";

/** Stable per-browser identifier; the API binds each judge session to it. */
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `${(crypto.getRandomValues(new Uint32Array(2))[0] ?? 0).toString(16)}-${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function getJudgeSession(): JudgeSession | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as JudgeSession;
  } catch {
    return null;
  }
}

export function setJudgeSession(session: JudgeSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

/**
 * Marks this browser as having been used for judging. The admin area is then
 * hidden from judge devices: visiting /admin redirects to /join instead of the
 * admin login page. Persists so it survives reloads/leaving.
 */
export function markJudgeDevice(): void {
  try {
    localStorage.setItem(JUDGE_DEVICE_KEY, "1");
  } catch {
    /* storage unavailable: non-blocking */
  }
}

export function isJudgeDevice(): boolean {
  try {
    return localStorage.getItem(JUDGE_DEVICE_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearJudgeSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

/** Raised when the API rejects the session or the device binding. */
export class JudgeAuthError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Every judge API call must present the device id: the API rejects requests that
 * cannot prove they come from the bound device.
 */
export async function judgeFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const session = getJudgeSession();
  const headers = new Headers(init.headers);
  headers.set("X-Device-Id", session?.deviceId ?? getDeviceId());
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${API_BASE_URL}${path}`, { ...init, headers, credentials: "include" });
}

export async function judgeJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await judgeFetch(path, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new JudgeAuthError(res.status, body.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/** Fire-and-forget security telemetry; never blocks the viewer UI. */
export async function reportSecurityEvent(
  type: string,
  meta: Record<string, unknown> = {}
): Promise<void> {
  try {
    await judgeFetch("/security/events", {
      method: "POST",
      body: JSON.stringify({ type, ...meta }),
    });
  } catch {
    // Offline or session ended: telemetry is best effort.
  }
}

export function slideUrl(opts: {
  number: number;
  pitchSessionId: string;
  deviceToken?: string | null;
  tier?: SlideTier;
}): string {
  const params = new URLSearchParams({ pitchSessionId: opts.pitchSessionId });
  if (opts.deviceToken) params.set("dt", opts.deviceToken);
  if (opts.tier) params.set("tier", opts.tier);
  return `${API_BASE_URL}/viewer/slides/${opts.number}?${params.toString()}`;
}