import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Lock, RefreshCw } from "lucide-react";
import { API_BASE_URL } from "../lib/api";
import { getDeviceId, getJudgeSession } from "../lib/judge";

import { createCameraPolicy, type CameraConcern, type CameraSecurityConfig, type CameraWorkerMessage, type DetectorKind } from "../lib/camera-detection";
export type { CameraSecurityConfig } from "../lib/camera-detection";

const TICK_MS = 200;

interface DetectorRunner {
  worker: Worker;
  kind: DetectorKind;
  ready: boolean;
  received: boolean;
  busy: boolean;
  lastSent: number;
}

interface Props {
  config: CameraSecurityConfig;
  enabled: boolean;
}

function cameraError(err: unknown): string {
  if (err instanceof Error) {
    switch (err.name) {
      case "NotAllowedError":
        return "Camera permission was denied. Allow camera access in your browser settings, then retry.";
      case "NotFoundError":
        return "No camera was found. Connect a camera, then retry.";
      case "NotReadableError":
      case "AbortError":
        return "The camera could not be opened. Close other apps using it, then retry.";
      default:
        return err.message;
    }
  }
  return "Camera unavailable. Please retry.";
}

async function report(type: string, meta: Record<string, unknown> = {}) {
  try {
    const session = getJudgeSession();
    await fetch(`${API_BASE_URL}/security/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-Id": session?.deviceId ?? getDeviceId(),
      },
      credentials: "include",
      body: JSON.stringify({ type, ...meta }),
    });
  } catch {
    /* offline */
  }
}

export function CameraSecurity({ config, enabled }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"idle" | "requesting" | "loading" | "running" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [faceCount, setFaceCount] = useState(-1);
  const [concerns, setConcerns] = useState<CameraConcern[]>([]);
  const [attempt, setAttempt] = useState(0);

  const cameraNeeded = config.faceDetection || config.multiplePersonDetection || config.phoneDetection;

  useEffect(() => {
    if (!enabled || !cameraNeeded) return;

    // Each attempt owns its resources, including when React remounts in development.
    let stopped = false;
    let stream: MediaStream | null = null;
    const runners: DetectorRunner[] = [];
    const policy = createCameraPolicy(config);
    let timer: number | undefined;
    let watchdog: number | undefined;
    const video = videoRef.current;

    function cleanup() {
      stopped = true;
      window.clearTimeout(watchdog);
      window.clearInterval(timer);
      runners.forEach(({ worker }) => worker.terminate());
      stream?.getTracks().forEach((track) => track.stop());
      if (video && video.srcObject === stream) video.srcObject = null;
      document.body.classList.remove("camera-suspend", "camera-locked");
    }

    function fail(message: string) {
      if (stopped) return;
      cleanup();
      setConcerns([]);
      setStatus("error");
      setErrorMsg(message);
    }

    function watch(message: string, duration: number) {
      window.clearTimeout(watchdog);
      watchdog = window.setTimeout(() => fail(message), duration);
    }

    async function sendFrame(runner: DetectorRunner) {
      if (stopped || !runner.ready || !video || video.readyState < 2) return;
      if (runner.busy) {
        if (performance.now() - runner.lastSent > 10_000) fail("Camera detection stopped responding. Please retry.");
        return;
      }
      const interval = runner.kind === "phone" ? 800 : TICK_MS;
      if (performance.now() - runner.lastSent < interval) return;
      runner.busy = true;
      runner.lastSent = performance.now();
      try {
        const bitmap = await createImageBitmap(video);
        if (stopped) {
          bitmap.close();
          return;
        }
        try {
          runner.worker.postMessage({ type: "frame", bitmap }, [bitmap]);
        } catch (err) {
          bitmap.close();
          throw err;
        }
      } catch (err) {
        fail(`Could not read camera frames. ${cameraError(err)}`);
      }
    }

    async function start() {
      setStatus("requesting");
      setErrorMsg(null);
      setFaceCount(-1);
      setConcerns([]);

      if (!navigator.mediaDevices?.getUserMedia) {
        fail("Camera access requires HTTPS or localhost and a supported browser.");
        return;
      }
      watch("Camera permission is still pending. Allow access in your browser, then retry.", 60_000);

      try {
        const acquired = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: "user" },
          audio: false,
        });
        if (stopped) {
          acquired.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = acquired;
        if (!video) throw new Error("Camera preview is unavailable. Please retry.");
        watch("The camera did not provide video. Close other apps using it, then retry.", 15_000);
        video.srcObject = stream;
        await video.play();
        if (stopped) return;

        setStatus("loading");
        watch("Camera detection took too long to load. Check your connection, then retry.", 30_000);
        const kinds: DetectorKind[] = [];
        if (config.faceDetection || config.multiplePersonDetection) kinds.push("face");
        if (config.phoneDetection) kinds.push("phone");
        for (const kind of kinds) {
          const worker = new Worker(new URL("../workers/camera.worker.ts", import.meta.url), { type: "module" });
          const runner: DetectorRunner = { worker, kind, ready: false, received: false, busy: false, lastSent: -Infinity };
          runners.push(runner);
          worker.onmessage = (event: MessageEvent<CameraWorkerMessage>) => {
            if (stopped) return;
            const message = event.data;
            if (message.type === "ready") {
              runner.ready = true;
            } else if (message.type === "result" && message.kind === kind) {
              runner.busy = false;
              runner.received = true;
              if (runners.every((r) => r.received)) {
                window.clearTimeout(watchdog);
                setStatus("running");
              }
              if (message.kind === "face") setFaceCount(message.faces);
              const update = policy.update(message, performance.now());
              setConcerns((previous) => previous.join() === update.concerns.join() ? previous : update.concerns);
              for (const { type, ...metadata } of update.events) void report(type, metadata);
              const restricted = update.concerns.length > 0;
              document.body.classList.toggle("camera-suspend", restricted && config.detectionAction === "BLUR");
              document.body.classList.toggle("camera-locked", restricted && config.detectionAction === "LOCK");
            } else if (message.type === "error") {
              fail(`${kind === "phone" ? "Phone" : "Face"} detection could not start. ${message.message}`);
            }
          };
          worker.onerror = (event) => {
            event.preventDefault();
            fail(`${kind === "phone" ? "Phone" : "Face"} detection could not load. Please retry.`);
          };
          worker.onmessageerror = () => fail("Camera detection returned an unreadable response. Please retry.");
          worker.postMessage({ type: "init", kind });
        }
        timer = window.setInterval(() => {
          if (runners.every((runner) => runner.ready)) runners.forEach((runner) => void sendFrame(runner));
        }, TICK_MS);
      } catch (err) {
        fail(cameraError(err));
      }
    }

    void start();
    return cleanup;
  }, [enabled, cameraNeeded, config.faceDetection, config.multiplePersonDetection, config.phoneDetection, config.detectionAction, attempt]);

  if (!enabled || !cameraNeeded) return null;

  const showWarning = concerns.length > 0 && config.detectionAction !== "LOG";
  const locked = showWarning && config.detectionAction === "LOCK";

  return (
    <>
      {locked && (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-ink-950/95 p-6 text-center text-white" role="alert">
          <Lock className="h-10 w-10 text-amber-400" />
          <p className="text-lg font-semibold">Presentation locked</p>
          <p className="text-xs text-white/50">Viewing resumes once the camera check clears.</p>
        </div>
      )}
      <div className="fixed bottom-4 right-4 z-50 flex w-56 max-w-[calc(100vw-2rem)] items-center gap-3 rounded-xl border border-ink-200 bg-white/95 p-3 shadow-lg backdrop-blur" role="status" aria-live="polite">
        <video ref={videoRef} playsInline muted className="hidden" />

        {(status === "idle" || status === "requesting" || status === "loading") && (
          <div className="flex w-full items-center gap-2 text-sm text-ink-500">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent-500" />
            {status === "loading" ? "Loading camera detection…" : "Waiting for camera…"}
          </div>
        )}

        {status === "running" && (
          <>
            <Camera className={`h-5 w-5 ${showWarning ? "text-amber-500" : "text-emerald-500"}`} />
            <div className="flex-1">
              {(config.faceDetection || config.multiplePersonDetection) && (
                <p className="text-xs font-semibold text-ink-700">
                  {faceCount === 1 ? "1 face" : faceCount === 0 ? "No face" : `${faceCount} faces`}
                </p>
              )}
              {config.phoneDetection && <p className="text-xs font-semibold text-ink-700">Phone check active</p>}
            </div>
          </>
        )}

        {status === "error" && (
          <div className="space-y-2">
            <p className="text-xs text-amber-700">Camera off — {errorMsg}</p>
            <button type="button" onClick={() => setAttempt((value) => value + 1)} className="flex items-center gap-1 text-xs font-semibold text-accent-700 hover:underline">
              <RefreshCw className="h-3 w-3" /> Retry camera
            </button>
          </div>
        )}
      </div>
    </>
  );
}
