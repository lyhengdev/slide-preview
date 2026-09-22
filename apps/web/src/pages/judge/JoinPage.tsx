import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Camera, ShieldCheck, Video } from "lucide-react";
import { API_BASE_URL } from "../../lib/api";
import { getDeviceId, markJudgeDevice, setJudgeSession } from "../../lib/judge";
import { Button, Card, Field, Input, Spinner } from "../../components/ui";

interface ResolvedState {
  event: { id: string; title: string };
  startup: { id: string; name: string } | null;
  pitchSessionId: string;
  cameraNeeded: boolean;
  security: {
    faceDetection: boolean;
    multiplePersonDetection: boolean;
    phoneDetection: boolean;
    requireFullscreen: boolean;
  };
}

export function JoinPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";

  const [state, setState] = useState<ResolvedState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [judgeCode, setJudgeCode] = useState("");
  const [pin, setPin] = useState("");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("Missing join token. Scan the QR code shown by the admin.");
      setLoading(false);
      return;
    }
    fetch(`${API_BASE_URL}/join/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token, deviceId: getDeviceId() }),
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Could not resolve join code");
        setState(body);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setJoining(true);
    try {
      const res = await fetch(`${API_BASE_URL}/join/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, deviceId: getDeviceId(), judgeCode, pin }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Login failed");

      setJudgeSession({
        token: body.token,
        sessionId: body.judge.sessionId,
        judgeCode: body.judge.judgeCode,
        judgeName: body.judge.name,
        eventId: body.judge.eventId,
        deviceId: body.judge.deviceId,
      });
      markJudgeDevice();
      navigate("/viewer", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setJoining(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Validating secure link…" />
      </div>
    );
  }

  if (error && !state) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md p-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-500">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="mb-2 text-lg font-semibold">Access denied</h1>
          <p className="text-sm text-ink-500">{error}</p>
          <Button className="mt-5 w-full" onClick={() => navigate("/")}>
            Back home
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950/5 p-4">
      <div className="w-full max-w-md space-y-4">
        <Card className="p-6">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-accent-600 text-white">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h1 className="text-xl font-bold">{state?.event.title}</h1>
            <p className="mt-1 text-sm text-ink-400">
              {state?.startup ? `Presenting: ${state.startup.name}` : "Secure session join"}
            </p>
          </div>

          {state?.cameraNeeded && (
            <div className="mb-5 rounded-xl border border-accent-100 bg-accent-50 p-4">
              <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-accent-700">
                <Camera className="h-4 w-4" /> Secure Viewing Mode
              </p>
              <ul className="space-y-1 text-xs text-accent-700/80">
                {state.security.faceDetection && <li>• Camera checks judge presence while viewing.</li>}
                {state.security.multiplePersonDetection && <li>• Camera checks for multiple people in view.</li>}
                {state.security.phoneDetection && <li>• Camera checks for visible phones while viewing.</li>}
                <li>• Processing is local on your device.</li>
                <li>• Images and video are not recorded or uploaded.</li>
              </ul>
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Judge code">
              <Input
                value={judgeCode}
                onChange={(e) => setJudgeCode(e.target.value.toUpperCase())}
                placeholder="J001"
                autoCapitalize="characters"
                required
              />
            </Field>
            <Field label="PIN">
              <Input
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="••••"
                required
              />
            </Field>

            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

            <Button type="submit" loading={joining} className="w-full">
              <Video className="h-4 w-4" /> Enter secure session
            </Button>
          </form>
        </Card>

        <p className="text-center text-xs text-ink-400">
          Session is device-bound. You cannot open this on a second device.
        </p>
      </div>
    </div>
  );
}