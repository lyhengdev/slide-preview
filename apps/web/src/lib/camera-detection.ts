export interface CameraSecurityConfig {
  faceDetection: boolean;
  multiplePersonDetection: boolean;
  phoneDetection: boolean;
  detectionAction: "LOG" | "WARN" | "BLUR" | "LOCK";
}

export type DetectorKind = "face" | "phone";
export type CameraResult =
  | { type: "result"; kind: "face"; faces: number; confidence: number }
  | { type: "result"; kind: "phone"; phones: number; confidence: number };
export type CameraWorkerMessage =
  | CameraResult
  | { type: "ready" }
  | { type: "error"; message: string };

export const PHONE_SCORE_THRESHOLD = 0.45;
const PHONE_CONFIRM_MS = 1200;
const PHONE_CLEAR_MS = 2000;
const FACE_GRACE_MS = 0;
const MAX_SAMPLE_GAP_MS = 4000;

export type CameraConcern = "missing-face" | "multiple-people" | "phone";
export interface CameraEvent {
  type: "FACE_MISSING" | "FACE_RESTORED" | "MULTIPLE_PERSONS" | "POSSIBLE_PHONE_DETECTED";
  confidence?: number;
  metadata?: Record<string, string | number>;
}

function condition(confirmMs: number, clearMs = 0) {
  let since: number | null = null;
  let clearSince: number | null = null;
  let lastSample: number | null = null;
  let samples = 0;
  let active = false;
  return {
    get active() { return active; },
    update(present: boolean, now: number): "started" | "cleared" | null {
      // A paused/backgrounded camera must supply fresh consecutive evidence.
      if (lastSample !== null && now - lastSample > MAX_SAMPLE_GAP_MS) {
        since = clearSince = null;
        samples = 0;
      }
      lastSample = now;
      if (present) {
        clearSince = null;
        since ??= now;
        samples++;
        if (!active && samples >= 1 && now - since >= confirmMs) {
          active = true;
          return "started";
        }
      } else {
        since = null;
        samples = 0;
        clearSince ??= now;
        if (active && now - clearSince >= clearMs) {
          active = false;
          return "cleared";
        }
      }
      return null;
    },
  };
}

export function createCameraPolicy(config: CameraSecurityConfig) {
  const missing = condition(FACE_GRACE_MS);
  const multiple = condition(FACE_GRACE_MS);
  const phone = condition(PHONE_CONFIRM_MS, PHONE_CLEAR_MS);

  return {
    update(result: CameraResult, now: number) {
      const events: CameraEvent[] = [];
      if (result.kind === "face") {
        if (config.faceDetection) {
          const change = missing.update(result.faces === 0, now);
          if (change === "started") events.push({ type: "FACE_MISSING" });
          if (change === "cleared") events.push({ type: "FACE_RESTORED" });
        }
        if (config.multiplePersonDetection && multiple.update(result.faces > 1, now) === "started") {
          events.push({ type: "MULTIPLE_PERSONS", confidence: result.confidence });
        }
      } else if (config.phoneDetection) {
        const visible = result.phones > 0 && result.confidence >= PHONE_SCORE_THRESHOLD;
        if (phone.update(visible, now) === "started") {
          events.push({
            type: "POSSIBLE_PHONE_DETECTED",
            confidence: result.confidence,
            metadata: { detector: "efficientdet-lite2-int8", category: "cell phone", count: result.phones, confirmationMs: PHONE_CONFIRM_MS },
          });
        }
      }
      const concerns: CameraConcern[] = [];
      if (missing.active) concerns.push("missing-face");
      if (multiple.active) concerns.push("multiple-people");
      if (phone.active) concerns.push("phone");
      return { events, concerns };
    },
  };
}
