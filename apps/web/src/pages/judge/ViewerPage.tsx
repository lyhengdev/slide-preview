import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Lock,
  WifiOff,
  AlertTriangle,
  Maximize2,
  ChevronRight,
  ChevronLeft,
  ShieldCheck,
  LogOut,
  ShieldAlert,
  RefreshCw,
} from "lucide-react";
import { connectJudgeSocket, disconnectJudgeSocket } from "../../lib/socket";
import {
  clearJudgeSession,
  getJudgeSession,
  judgeFetch,
  judgeJson,
  markJudgeDevice,
  reportSecurityEvent,
  slideUrl,
  type JudgeSession,
} from "../../lib/judge";
import { Button, Card } from "../../components/ui";
import { WatermarkOverlay, type WatermarkInfo } from "../../components/WatermarkOverlay";
import { CameraSecurity, type CameraSecurityConfig } from "../../components/CameraSecurity";
import { SlideStage } from "../../components/SlideStage";
import { pickTier, preloadSlides, clearSlideCache, type SlideTier } from "../../lib/slide-cache";
import { useSingleJudgeTab } from "../../hooks/useSingleJudgeTab";
import {
  fullscreenSupported,
  isFullscreen,
  onFullscreenChange,
  requestFullscreen,
} from "../../lib/fullscreen";
import { iosVideoFullscreenSupported, presentSlideInIOSPlayer } from "../../lib/ios-fullscreen";
import "../../camera.css";

type DetectionAction = "LOG" | "WARN" | "BLUR" | "LOCK";

interface ViewerState {
  ok: boolean;
  sessionActive: boolean;
  deckActive: boolean;
  pitchSessionId: string | null;
  startupId: string | null;
  startupName: string | null;
  sectionName: string | null;
  currentSlide: number;
  slideCount: number;
  allowJudgeNavigation: boolean;
  tiers: string[];
  deviceToken?: string;
  judge: { code: string; name: string };
  event: { id: string; title: string } | null;
  security: {
    watermark: boolean;
    watermarkText: string;
    hideOnTabSwitch: boolean;
    blockScreenshots: boolean;
    requireFullscreen: boolean;
    faceDetection: boolean;
    multiplePersonDetection: boolean;
    phoneDetection: boolean;
    detectionAction: DetectionAction;
    allowJudgeNavigation: boolean;
  };
}

export function ViewerPage() {
  const navigate = useNavigate();
  const [session] = useState<JudgeSession | null>(() => getJudgeSession());
  const [state, setState] = useState<ViewerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnected, setDisconnected] = useState(false);
  const stateRequestRef = useRef(0);
  const [hiddenByTab, setHiddenByTab] = useState(false);
  const [screenshotBlocked, setScreenshotBlocked] = useState(false);
  const [fullscreenWarning, setFullscreenWarning] = useState(false);
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const [override, setOverride] = useState<DetectionAction | null>(null);
  const [activeTier, setActiveTier] = useState<SlideTier>("standard");
  const hiddenRef = useRef(false);
  const { conflict: crossTabConflict, takeOver } = useSingleJudgeTab(
    Boolean(session) && Boolean(state?.deckActive),
    session ? { deviceId: session.deviceId, sessionId: session.sessionId } : null
  );

  useEffect(() => {
    if (crossTabConflict) void reportSecurityEvent("MULTI_TAB_OPEN");
  }, [crossTabConflict]);

  const lockForTermination = useCallback((reason: string) => {
    ++stateRequestRef.current;
    void clearSlideCache();
    clearJudgeSession();
    setEndedReason(reason);
    setState((current) =>
      current ? { ...current, ok: false, sessionActive: false, deckActive: false, currentSlide: 0 } : current
    );
  }, []);

  const loadState = useCallback(async () => {
    if (!session) return;
    const request = ++stateRequestRef.current;
    try {
      const body = await judgeJson<ViewerState>("/viewer/state");
      if (request !== stateRequestRef.current) return;
      if (!body.ok) {
        // Session revoked, device binding rejected, or the account disabled is
        // terminal: hide the deck now instead of keeping yesterday's slide up.
        lockForTermination("Your session is no longer valid.");
        setLoading(false);
        return;
      }
      setState((previous) => ({
        ...body,
        // Independent browsing keeps the judge's position; presenter-sync always
        // snaps to the slide the admin is showing.
        currentSlide:
          body.ok && body.deckActive && body.slideCount > 0
            ? body.allowJudgeNavigation
              ? previous?.deckActive && previous.pitchSessionId === body.pitchSessionId
                ? Math.min(Math.max(previous.currentSlide, 1), body.slideCount)
                : 1
              : Math.min(Math.max(body.currentSlide, 1), body.slideCount)
            : 0,
      }));
      setLoading(false);
    } catch (err) {
      if (request !== stateRequestRef.current) return;
      const status =
        err && typeof err === "object" && "status" in err ? (err as { status: number }).status : undefined;
      if (status === 401 || status === 403) {
        // 401 = expired session; 403 = account disabled/revoked. Either way the
        // judge must be locked out — not left staring at the previous slide,
        // and not treated as a transient network blip.
        lockForTermination("Your session is no longer valid.");
      } else {
        setDisconnected(true);
      }
      setLoading(false);
    }
  }, [session, lockForTermination]);

  useEffect(() => {
    if (!session) {
      setLoading(false);
      return;
    }
    void loadState();
    const interval = setInterval(() => void loadState(), 12_000);
    return () => clearInterval(interval);
  }, [session, loadState]);

  useEffect(() => {
    if (!session) return;
    const socket = connectJudgeSocket({
      token: session.token,
      sessionId: session.sessionId,
      judgeCode: session.judgeCode,
      deviceId: session.deviceId,
    });

    socket.on("connect", () => {
      setDisconnected(false);
      const pitchSessionId = state?.pitchSessionId;
      if (pitchSessionId) socket.emit("pitch:join", { pitchSessionId });
      void loadState();
    });
    socket.on("disconnect", () => setDisconnected(true));
    socket.on("connect_error", () => setDisconnected(true));

    const lockPresentation = () => {
      ++stateRequestRef.current;
      // The one-pitch camera override is server-side, but the client also keeps
      // its own copy; forget it here or it would keep overriding the *next*
      // pitch's (fresh) server setting until the admin pushes a new one.
      setOverride(null);
      setState((current) => (current ? { ...current, deckActive: false, currentSlide: 0 } : current));
      // Drop the watermarked slides pinned in Cache Storage now that the pitch
      // is over; the deck must not linger on the device after the session ends.
      void clearSlideCache();
    };

    socket.on("pitch:locked", lockPresentation);
    socket.on("pitch:ended", lockPresentation);
    socket.on("pitch:started", () => {
      lockPresentation();
      void loadState();
    });

    // Presenter-sync: only follow the shared slide when navigation is disabled.
    socket.on("slide:change", (payload: { slide?: number }) => {
      const slide = Number(payload?.slide ?? 0);
      if (!slide) return;
      setState((current) =>
        current && !current.allowJudgeNavigation && current.deckActive
          ? { ...current, currentSlide: Math.min(Math.max(slide, 1), Math.max(current.slideCount, 1)) }
          : current
      );
    });

    // Event-day escape hatch from the admin console.
    socket.on("security:override", (payload: { detectionAction: DetectionAction | null }) => {
      setOverride(payload?.detectionAction ?? null);
    });

    socket.on("judge:terminated", () => {
      lockForTermination("An admin ended your session on this device.");
    });

    return () => {
      disconnectJudgeSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.sessionId, state?.pitchSessionId, loadState, lockForTermination]);

  // Tab switch protection: hide locally and record the event for the audit trail.
  useEffect(() => {
    if (!state?.security?.hideOnTabSwitch) return;
    const onChange = () => {
      const hidden = document.hidden;
      setHiddenByTab(hidden);
      if (hidden === hiddenRef.current) return;
      hiddenRef.current = hidden;
      void reportSecurityEvent(hidden ? "TAB_HIDDEN" : "TAB_VISIBLE");
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, [state?.security?.hideOnTabSwitch]);

  // Screenshot / capture protection: browsers cannot stop OS-level capture, but
  // they can obscure the content whenever the window loses focus (which is
  // exactly when a screenshot is taken) and record the attempt.
  useEffect(() => {
    if (!state?.security?.blockScreenshots && !(state?.security?.requireFullscreen && !fullscreenSupported()))
      return;
    const onBlur = () => {
      setScreenshotBlocked(true);
      void reportSecurityEvent("SCREENSHOT_BLOCKED");
    };
    const onFocus = () => {
      setScreenshotBlocked(false);
      void reportSecurityEvent("SCREENSHOT_UNBLOCKED");
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    const onVisibility = () => {
      const hidden = document.hidden;
      setScreenshotBlocked(hidden);
      void reportSecurityEvent(hidden ? "SCREENSHOT_BLOCKED" : "SCREENSHOT_UNBLOCKED");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [state?.security?.blockScreenshots]);

  // Fullscreen requirement
  useEffect(() => {
    if (!state?.security?.requireFullscreen) return;
    // iPhone Safari can't be driven into element fullscreen. Stop the admin
    // from chasing a locker screen that can never satisfy — record it once and
    // rely on the forced local anti-capture instead.
    if (!fullscreenSupported()) {
      void reportSecurityEvent("FULLSCREEN_UNSUPPORTED");
      return;
    }
    const onChange = () => {
      const exited = !isFullscreen();
      setFullscreenWarning(exited);
      if (exited) void reportSecurityEvent("FULLSCREEN_EXIT");
    };
    const unsubscribe = onFullscreenChange(onChange);
    setFullscreenWarning(!isFullscreen());
    return unsubscribe;
  }, [state?.security?.requireFullscreen]);

  // Resolution-ladder preloader: first pull every slide at the tiny preview tier
  // (whole deck ready in seconds), then sharpen the whole deck at the tier that
  // matches the judge's connection. Each download is pinned into Cache Storage
  // and measured, so `pickTier()` keeps adapting to the real network.
  useEffect(() => {
    if (!state?.deckActive || !state.pitchSessionId || state.slideCount <= 0) return;
    const { pitchSessionId, slideCount, deviceToken } = state;
    const controller = new AbortController();
    const displayTier = pickTier();
    setActiveTier(displayTier);
    const urlsFor = (tier: SlideTier) =>
      Array.from({ length: slideCount }, (_, i) => i + 1).map((number) =>
        slideUrl({ number, pitchSessionId, deviceToken, tier })
      );
    void preloadSlides(urlsFor("preview"), { signal: controller.signal, gapMs: 150 }).then(() => {
      if (controller.signal.aborted) return;
      return preloadSlides(urlsFor(displayTier), { signal: controller.signal, gapMs: 300 });
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.deckActive, state?.pitchSessionId, state?.slideCount, state?.deviceToken]);

  function navigateSlide(slide: number) {
    if (!state?.allowJudgeNavigation) return;
    setState((s) =>
      s?.deckActive && s.slideCount > 0
        ? { ...s, currentSlide: Math.min(Math.max(slide, 1), s.slideCount) }
        : s
    );
  }

  async function leaveSession() {
    await judgeFetch("/join/logout", { method: "POST" }).catch(() => undefined);
    clearJudgeSession();
    markJudgeDevice();
    disconnectJudgeSocket();
    // The deck stays in Cache Storage for an hour via Cache-Control; purge it on
    // logout so the next judge using this browser cannot find the old slides.
    void clearSlideCache();
    navigate("/join", { replace: true });
  }

  const slideSrc =
    state?.deckActive && state.pitchSessionId && state.currentSlide > 0
      ? slideUrl({
          number: state.currentSlide,
          pitchSessionId: state.pitchSessionId,
          deviceToken: state.deviceToken,
          tier: activeTier,
        })
      : null;
  const previewSrc =
    slideSrc && state?.pitchSessionId && activeTier !== "preview"
      ? slideUrl({
          number: state.currentSlide,
          pitchSessionId: state.pitchSessionId,
          deviceToken: state.deviceToken,
          tier: "preview",
        })
      : undefined;

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-ink-950 text-white">
        <ShieldCheck className="h-10 w-10 text-emerald-400" />
        <p className="text-sm text-white/70">Connecting to secure session…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950 p-4 text-white">
        <Card className="w-full max-w-sm bg-ink-900 p-6 text-center">
          <Lock className="mx-auto mb-3 h-8 w-8 text-white/40" />
          <h1 className="mb-2 font-semibold">Session required</h1>
          <p className="text-sm text-white/60">Please scan the admin QR code to join.</p>
        </Card>
      </div>
    );
  }

  const effectiveAction: DetectionAction = override ?? state?.security?.detectionAction ?? "LOG";
  const cameraConfig: CameraSecurityConfig = state?.security
    ? {
        faceDetection: state.security.faceDetection,
        multiplePersonDetection: state.security.multiplePersonDetection,
        phoneDetection: state.security.phoneDetection,
        detectionAction: effectiveAction,
      }
    : {
        faceDetection: false,
        multiplePersonDetection: false,
        phoneDetection: false,
        detectionAction: "LOG",
      };

  const fullscreenLockable = fullscreenSupported();
  const iosFullscreen = iosVideoFullscreenSupported();
  const captureForced = Boolean(state?.security?.requireFullscreen && !fullscreenLockable);
  const fullscreenEnforceable = Boolean(state?.security?.requireFullscreen && fullscreenLockable);
  const canShow =
    state?.ok &&
    state.sessionActive &&
    state.deckActive &&
    !hiddenByTab &&
    !screenshotBlocked &&
    !crossTabConflict &&
    // When the event requires fullscreen, content must stay hidden until the
    // judge re-enters it; otherwise the gate below is never reachable.
    (fullscreenEnforceable ? !fullscreenWarning : true);
  const canNavigate = state?.allowJudgeNavigation ?? true;

  const watermarkInfo: WatermarkInfo = {
    judgeCode: state?.judge?.code ?? session.judgeCode,
    eventTitle: state?.event?.title ?? "SECURE",
    sessionId: state?.pitchSessionId ?? "",
  };

  const goFullscreen = () => {
    if (!state?.deckActive || !state.pitchSessionId || state.currentSlide <= 0) return;
    // iPhone: open the slide inside the native fullscreen video player. iOS
    // shields fullscreen video from screen capture, hides the browser chrome,
    // and the slide is re-composited with a per-judge watermark.
    if (iosFullscreen) {
      const tier = activeTier === "preview" ? "full" : activeTier;
      const src = slideUrl({
        number: state.currentSlide,
        pitchSessionId: state.pitchSessionId,
        deviceToken: state.deviceToken,
        tier,
      });
      void presentSlideInIOSPlayer({
        src,
        watermarkText: `${watermarkInfo.judgeCode} · ${watermarkInfo.eventTitle}`,
      });
      return;
    }
    void requestFullscreen().then((entered) => {
      if (!entered) setFullscreenWarning(true);
    });
  };

  return (
    <div className="flex min-h-screen flex-col bg-ink-950 text-white">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          <span className="text-sm">
            {state?.event?.title ?? "Secure Session"}
            {state?.sectionName ? ` · ${state.sectionName}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-4">
          {disconnected && (
            <span className="flex items-center gap-1.5 text-xs text-amber-400">
              <WifiOff className="h-3.5 w-3.5" /> Reconnecting…
            </span>
          )}
          {state?.deckActive && (fullscreenEnforceable ? !isFullscreen() : iosFullscreen) && (
            <Button
              variant="secondary"
              className="!py-1 text-xs"
              onClick={goFullscreen}
            >
              <Maximize2 className="h-3 w-3" /> Fullscreen
            </Button>
          )}
          <span className="text-xs text-white/50">{state?.judge?.code ?? session.judgeCode}</span>
          <button
            onClick={leaveSession}
            className="flex items-center gap-1 text-xs text-white/50 transition hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" /> Leave
          </button>
        </div>
      </div>

      {override && (
        <div className="flex items-center justify-center gap-2 bg-amber-500/15 px-4 py-2 text-xs text-amber-200">
          <ShieldAlert className="h-3.5 w-3.5" />
          Camera security was relaxed by the admin ({override} mode).
        </div>
      )}

      {captureForced && (
        <div className="flex items-center justify-center gap-2 bg-accent-500/15 px-4 py-2 text-xs text-accent-200">
          <ShieldAlert className="h-3.5 w-3.5" />
          This device can't enter fullscreen — tap <b>Fullscreen</b> to open the slide in a
          protected player; watermark and auto-hide stay active.
        </div>
      )}

      <main className="relative flex flex-1 flex-col">
        <WatermarkOverlay info={watermarkInfo} />
        {state?.sessionActive && <CameraSecurity config={cameraConfig} enabled />}


        {endedReason && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <ShieldAlert className="h-10 w-10 text-amber-400" />
            <h2 className="font-semibold">Session ended</h2>
            <p className="max-w-sm text-sm text-white/60">{endedReason}</p>
            <Button variant="primary" onClick={leaveSession}>
              Back to join
            </Button>
          </div>
        )}

        {!endedReason && hiddenByTab && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <AlertTriangle className="h-10 w-10 text-white/30" />
            <p className="text-sm text-white/60">Content hidden while this tab is not visible.</p>
            <p className="text-xs text-white/40">This switch has been recorded.</p>
          </div>
        )}

        {!endedReason && !hiddenByTab && screenshotBlocked && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <ShieldAlert className="h-10 w-10 text-amber-400" />
            <p className="text-sm text-white/60">Screen capture protection active</p>
            <p className="text-xs text-white/40">Content is hidden while the window is not focused.</p>
          </div>
        )}

        {!endedReason && !hiddenByTab && !screenshotBlocked && !canShow && !crossTabConflict && (
          <SessionLocked
            state={state}
            fullscreenWarning={fullscreenWarning}
            onEnterFullscreen={() => {
              void requestFullscreen();
            }}
          />
        )}

        {!endedReason && !hiddenByTab && !screenshotBlocked && crossTabConflict && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <AlertTriangle className="h-10 w-10 text-amber-400" />
            <h2 className="font-semibold">Deck is open in another tab</h2>
            <p className="max-w-sm text-sm text-white/60">
              Content is hidden here to keep the deck single-device. You can claim this tab instead —
              the other tab will be hidden.
            </p>
            <Button variant="primary" onClick={takeOver}>
              <RefreshCw className="h-4 w-4" /> Use this tab
            </Button>
          </div>
        )}

        {!endedReason && !hiddenByTab && canShow && slideSrc && (
          <div className="flex flex-1 flex-col p-4">
            <div className="slide-canvas relative flex flex-1 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/40">
              <SlideStage
                src={slideSrc}
                previewSrc={previewSrc}
                alt={`Slide ${state.currentSlide} of ${state.slideCount}`}
              />
            </div>

            {canNavigate && state.slideCount > 1 && (
              <div className="mt-4 flex items-center justify-center gap-4">
                <Button
                  variant="secondary"
                  disabled={state.currentSlide <= 1}
                  onClick={() => navigateSlide(state.currentSlide - 1)}
                >
                  <ChevronLeft className="h-4 w-4" /> Prev
                </Button>
                <span className="text-sm text-white/50">
                  {state.currentSlide} / {state.slideCount}
                </span>
                <Button
                  variant="secondary"
                  disabled={state.currentSlide >= state.slideCount}
                  onClick={() => navigateSlide(state.currentSlide + 1)}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
            {!canNavigate && (
              <p className="mt-4 text-center text-xs text-white/40">
                Slide navigation is controlled by the presenter.
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function SessionLocked(props: {
  state: ViewerState | null;
  fullscreenWarning: boolean;
  onEnterFullscreen: () => void;
}) {
  const { state, fullscreenWarning, onEnterFullscreen } = props;

  if (!state || !state.ok || !state.sessionActive) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <Lock className="h-10 w-10 text-white/30" />
        <h2 className="font-semibold">Waiting for the presenter</h2>
        <p className="max-w-sm text-sm text-white/60">
          You are checked in{state?.judge ? ` as ${state.judge.name}` : ""}. The screen will unlock
          when the admin starts the pitch.
        </p>
      </div>
    );
  }

  if (fullscreenWarning) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <AlertTriangle className="h-10 w-10 text-amber-400" />
        <h2 className="font-semibold">Fullscreen required</h2>
        <p className="max-w-sm text-sm text-white/60">
          Return to fullscreen to continue viewing. This exit has been recorded.
        </p>
        {!fullscreenSupported() && (
          <p className="max-w-sm text-xs text-amber-300/80">
            Your browser can't be forced into fullscreen (e.g. iPhone Safari). Ask the organiser to
            relax the fullscreen requirement, or open this link on a desktop/iPad browser.
          </p>
        )}
        <Button variant="primary" onClick={onEnterFullscreen}>
          <Maximize2 className="h-4 w-4" /> Enter fullscreen
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <Lock className="h-10 w-10 text-white/30" />
      <h2 className="font-semibold">No active presentation</h2>
      <p className="max-w-sm text-sm text-white/60">
        The admin has not started a deck{state.startupName ? ` for ${state.startupName}` : ""} yet.
      </p>
    </div>
  );
}


