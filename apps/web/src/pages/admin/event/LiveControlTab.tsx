import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import {
  Play,
  Square,
  RefreshCw,
  Users,
  ShieldAlert,
  Radio,
} from "lucide-react";
import { API_BASE_URL } from "../../../lib/api";
import { Badge, Button, Card, EmptyState, StatusDot } from "../../../components/ui";
import { connectAdminSocket, getAdminSocket, disconnectAdminSocket } from "../../../lib/socket";
import { useAuth } from "../../../lib/auth";

interface SocketJudge {
  sessionId: string;
  judgeId: string;
  judgeCode: string;
  judgeName?: string;
  online: boolean;
}

export function LiveControlTab({ event }: { event: any }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [active, setActive] = useState<{ session: any; qr: string | null; qrUrl: string | null } | null>(null);
  const [judges, setJudges] = useState<SocketJudge[]>([]);
  const [connected, setConnected] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  const [overrideMode, setOverrideMode] = useState<"LOG" | "WARN" | "BLUR" | "LOCK" | null>(null);
  const [overridePending, setOverridePending] = useState(false);
  const alertsRef = useRef<HTMLDivElement>(null);

  const readyStartups = (event.startups ?? []).filter(
    (s: any) => (s.decks ?? []).some((d: any) => d.status === "READY")
  );

  const socketConnected = connected;

  useEffect(() => {
    if (!user) return;
    const socket = connectAdminSocket();
    socket.on("connect", () => {
      setConnected(true);
      socket.emit("admin:join", { eventId: event.id });
    });
    socket.on("disconnect", () => setConnected(false));

    socket.on("judge:connection-list", (list: SocketJudge[]) => setJudges(list));
    socket.on("judge:online", (j: any) =>
      setJudges((prev) => {
        const idx = prev.findIndex((p) => p.sessionId === j.sessionId);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = { ...copy[idx]!, online: true, judgeCode: j.judgeCode };
          return copy;
        }
        return [...prev, { sessionId: j.sessionId, judgeId: j.judgeId, judgeCode: j.judgeCode, online: true }];
      })
    );
    socket.on("judge:offline", (j: any) =>
      setJudges((prev) => prev.map((p) => (p.sessionId === j.sessionId ? { ...p, online: false } : p)))
    );
    socket.on("security:event", () => setAlertCount((c) => c + 1));
    socket.on("pitch:started", () => refresh());

    return () => {
      disconnectAdminSocket();
    };
  }, [event.id, user]);

  async function refresh() {
    try {
      const res = await fetch(`${API_BASE_URL}/events/${event.id}/pitches/active`, { credentials: "include" });
      const data = await res.json();
      setActive((prev) =>
        data.session
          ? { session: data.session, qr: prev?.qr ?? null, qrUrl: prev?.qrUrl ?? null }
          : null
      );
    } catch {
      /* ignore */
    }
    qc.invalidateQueries({ queryKey: ["event", event.id] });
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
  }, [event.id]);

  async function beginPitch(startupId: string, pitchSectionId?: string) {
    const res = await fetch(`${API_BASE_URL}/events/${event.id}/pitches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ startupId, pitchSectionId }),
    });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error ?? "Could not start pitch");
    }
    const data = await res.json();
    setActive({ session: data.session, qr: data.qr, qrUrl: data.qrUrl });
    getAdminSocket()?.emit("pitch:activate", { pitchSessionId: data.session.id });
  }

  async function endPitch() {
    if (!active?.session) return;
    await fetch(`${API_BASE_URL}/pitches/${active.session.id}/end`, {
      method: "POST",
      credentials: "include",
    });
    setActive(null);
    refresh();
  }

  async function refreshToken() {
    if (!active?.session) return;
    const res = await fetch(`${API_BASE_URL}/pitches/${active.session.id}/refresh-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ pitchSessionId: active.session.id }),
    });
    const data = await res.json();
    setActive({ ...active, qr: data.qr, qrUrl: data.qrUrl });
  }

  async function applyOverride(mode: "LOG" | "WARN" | "BLUR" | "LOCK" | null) {
    if (!active?.session) return;
    setOverridePending(true);
    try {
      const res = await fetch(`${API_BASE_URL}/pitches/${active.session.id}/security-override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ detectionAction: mode }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Override failed");
      }
      setOverrideMode(mode);
    } catch {
      /* keep previous mode shown; error is visible via button state */
    } finally {
      setOverridePending(false);
    }
  }

  return (
    <div className="space-y-6">
      {!socketConnected && (
        <Card className="flex items-center gap-3 border-amber-200 bg-amber-50 p-4 text-amber-700">
          <Radio className="h-5 w-5" />
          <p className="text-sm">
            Realtime channel connecting… Judge status updates need this connection.
          </p>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Active presentation */}
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <Play className="h-4 w-4 text-accent-600" />
              Live Presentation
            </h2>
            {active && (
              <Badge color="green" pulse>
                ACTIVE
              </Badge>
            )}
          </div>

          {!active ? (
            <div className="space-y-4">
              <p className="text-sm text-ink-500">Start a pitch session to make a deck live for judges.</p>
              {readyStartups.length === 0 ? (
                <EmptyState
                  icon={<Play className="h-8 w-8" />}
                  title="No ready decks"
                  hint="Upload and process a deck in the Startups tab first."
                />
              ) : (
                <div className="space-y-2">
                  {readyStartups.map((s: any) => (
                    <div key={s.id} className="flex items-center justify-between rounded-lg border border-ink-200 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">{s.name}</p>
                        <p className="text-xs text-ink-400">
                          {s.decks.find((d: any) => d.status === "READY")?.originalName}
                        </p>
                      </div>
                      <Button onClick={() => beginPitch(s.id, s.pitchSectionId ?? undefined)}>
                        <Play className="h-4 w-4" /> Start
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between rounded-lg bg-ink-50 px-4 py-3">
                <div>
                  <p className="font-medium">{active.session.startup?.name ?? "Presentation"}</p>
                  <p className="text-xs text-ink-400">
                    {active.session.deck?.slideCount ?? "?"} slides
                  </p>
                </div>
                <Button variant="danger" onClick={endPitch}>
                  <Square className="h-4 w-4" /> End
                </Button>
              </div>

              <p className="text-sm text-ink-500">
                Judges can view all slides and navigate at their own pace.
              </p>

              <div className="rounded-lg border border-ink-200 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-amber-500" />
                  <p className="text-sm font-medium">Camera enforcement</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["LOG", "WARN", "BLUR", "LOCK"] as const).map((mode) => (
                    <Button
                      key={mode}
                      variant={overrideMode === mode ? "primary" : "secondary"}
                      disabled={overridePending}
                      className="!px-3 !py-1 text-xs"
                      onClick={() => applyOverride(mode)}
                    >
                      {mode}
                    </Button>
                  ))}
                  <Button
                    variant="secondary"
                    disabled={overridePending}
                    className="!px-3 !py-1 text-xs"
                    onClick={() => applyOverride(null)}
                  >
                    Reset
                    </Button>
                </div>
                <p className="mt-2 text-xs text-ink-400">
                  Relax camera rules for one pitch (e.g. presenter walks in front of camera). Resets to LOG when the pitch ends.
                </p>
              </div>

              <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-ink-300 p-5">
                {active.qr ? (
                  <>
                    <QRCodeSVG value={active.qrUrl ?? active.qr} size={200} />
                    <p className="text-xs text-ink-400">
                      Judges scan to join. Token expires in 15 minutes.
                    </p>
                    <Button variant="secondary" onClick={refreshToken}>
                      <RefreshCw className="h-4 w-4" /> Refresh QR
                    </Button>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-ink-400">
                    <QRCodeSVG value="" size={200} className="hidden" />
                    <p className="text-sm">QR code expires when session starts.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>

        {/* Judge connections */}
        <Card className="p-5">
          <h2 className="mb-4 flex items-center justify-between font-semibold">
            <span className="flex items-center gap-2">
              <Users className="h-4 w-4 text-accent-600" /> Judge Connections
            </span>
            {judges.length > 0 && <Badge color="blue">{judges.filter((j) => j.online).length} online</Badge>}
          </h2>
          {judges.length === 0 ? (
            <EmptyState icon={<Users className="h-8 w-8" />} title="No judges connected" hint="Judges appear here once they join." />
          ) : (
            <div className="space-y-2">
              {judges.map((j) => (
                <div key={j.sessionId} className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2">
                  <div className="flex items-center gap-3">
                    <StatusDot online={j.online} />
                    <div>
                      <p className="text-sm font-medium">{j.judgeCode}</p>
                      <p className="text-xs text-ink-400">{j.judgeName ?? j.judgeId}</p>
                    </div>
                  </div>
                  <span className={`badge ${j.online ? "bg-emerald-100 text-emerald-700" : "bg-ink-100 text-ink-400"}`}>
                    {j.online ? "Online" : "Offline"}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 border-t border-ink-100 pt-4">
            <h3 className="mb-3 flex items-center gap-2 font-medium">
              <ShieldAlert className="h-4 w-4 text-amber-500" /> Security Alerts
            </h3>
            {alertCount === 0 ? (
              <p className="text-sm text-ink-400">No alerts this session.</p>
            ) : (
              <div ref={alertsRef} className="max-h-40 overflow-y-auto text-sm">
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-700">
                  {alertCount} new security event{alertCount > 1 ? "s" : ""} streamed live. Full history in the Audit tab.
                </p>
                <Button variant="ghost" className="mt-2 text-xs" onClick={() => setAlertCount(0)}>
                  Dismiss
                </Button>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}