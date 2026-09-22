import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Smartphone, Users } from "lucide-react";
import { API_BASE_URL } from "../../../lib/api";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Spinner } from "../../../components/ui";

async function adminFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, credentials: "include" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res;
}

export function JudgesTab({ event }: { event: any }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [newPin, setNewPin] = useState<string | null>(null);
  const [sessionsFor, setSessionsFor] = useState<string | null>(null);

  const judges: any[] = event.judges ?? [];
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["event", event.id] });

  const releaseSession = useMutation({
    mutationFn: (judgeId: string) => adminFetch(`/judges/${judgeId}/sessions/release`, { method: "POST" }),
    onSuccess: invalidate,
  });

  const createJudge = useMutation({
    mutationFn: async (body: { name: string; email?: string; pin?: string }) => {
      const res = await fetch(`${API_BASE_URL}/events/${event.id}/judges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json();
        throw new Error(b.error ?? "Could not create judge");
      }
      return res.json();
    },
    onSuccess: (j) => {
      qc.invalidateQueries({ queryKey: ["event", event.id] });
      setNewPin(`${j.judgeCode} · PIN: ${j.generatedPin}`);
      setCreating(false);
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await fetch(`${API_BASE_URL}/judges/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ active: !active }),
      });
      if (!res.ok) throw new Error("Update failed");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["event", event.id] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Add Judge
        </Button>
      </div>

      {newPin && (
        <Card className="border-emerald-200 bg-emerald-50 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
            <KeyRound className="h-4 w-4" />
            Judge created — {newPin}
          </p>
          <button onClick={() => setNewPin(null)} className="text-xs text-emerald-600 underline">
            Dismiss
          </button>
        </Card>
      )}

      {judges.length === 0 ? (
        <Card>
          <EmptyState icon={<Users className="h-8 w-8" />} title="No judges yet" hint="Create judge accounts to let them join via QR." />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {judges.map((j: any) => (
            <Card key={j.id} className="p-5">
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <p className="font-semibold">{j.judgeCode}</p>
                  <p className="text-sm text-ink-600">{j.name}</p>
                </div>
                <Badge color={j.active ? "green" : "red"}>{j.active ? "Active" : "Disabled"}</Badge>
              </div>
              <p className="text-xs text-ink-400 break-all">{j.email ?? "no email"}</p>
              <RoundAssignments judge={j} sections={event.sections ?? []} onChange={invalidate} />
              <div className="mt-3">
                <Button
                  variant="ghost"
                  className="!px-2 !py-1 text-xs"
                  onClick={() => toggleActive.mutate({ id: j.id, active: j.active })}
                >
                  {j.active ? "Disable" : "Enable"}
                </Button>
                <Button
                  variant="ghost"
                  className="!px-2 !py-1 text-xs"
                  onClick={() => setSessionsFor(sessionsFor === j.id ? null : j.id)}
                >
                  <Smartphone className="h-3 w-3" /> Sessions
                </Button>
                <Button
                  variant="ghost"
                  className="!px-2 !py-1 text-xs"
                  disabled={releaseSession.isPending}
                  onClick={() => {
                    if (confirm(`Release all active sessions for ${j.judgeCode}? They will need to rejoin.`)) {
                      releaseSession.mutate(j.id);
                    }
                  }}
                >
                  Allow device change
                </Button>
              </div>

              {sessionsFor === j.id && (
                <JudgeSessionsPanel judgeId={j.id} judgeCode={j.judgeCode} />
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Add judge"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" form="judge-form" loading={createJudge.isPending}>Create</Button>
          </>
        }
      >
        <JudgeForm
          onSubmit={(body) => createJudge.mutate(body)}
          error={createJudge.error?.message}
        />
      </Modal>
    </div>
  );
}

function RoundAssignments({
  judge,
  sections,
  onChange,
}: {
  judge: any;
  sections: any[];
  onChange: () => void;
}) {
  const [pick, setPick] = useState("");
  const assignedIds = new Set((judge.assignments ?? []).map((a: any) => a.pitchSectionId));

  const assign = useMutation({
    mutationFn: async (pitchSectionId: string) => {
      const res = await fetch(`${API_BASE_URL}/judges/${judge.id}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pitchSectionId }),
      });
      if (!res.ok) throw new Error("Could not assign round");
      setPick("");
    },
    onSuccess: onChange,
  });

  const remove = useMutation({
    mutationFn: (pitchSectionId: string) =>
      adminFetch(`/judges/${judge.id}/assignments/${pitchSectionId}`, { method: "DELETE" }),
    onSuccess: onChange,
  });

  if (sections.length === 0) return null;
  const assignable = sections.filter((s: any) => !assignedIds.has(s.id));

  return (
    <div className="mt-3 border-t border-ink-100 pt-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Rounds</p>
      <div className="flex flex-wrap gap-1.5">
        {(judge.assignments ?? []).map((a: any) => (
          <span
            key={a.pitchSectionId}
            className="inline-flex items-center gap-1 rounded-full bg-accent-100 px-2 py-0.5 text-xs font-medium text-accent-700"
          >
            {a.pitchSection?.name ?? "Round"}
            <button
              className="text-accent-500 hover:text-accent-700"
              disabled={remove.isPending}
              onClick={() => remove.mutate(a.pitchSectionId)}
              title="Remove"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {assignable.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Assign a round…</option>
            {assignable.map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            className="!px-3 !py-1 text-xs"
            disabled={!pick || assign.isPending}
            onClick={() => pick && assign.mutate(pick)}
          >
            Add
          </Button>
        </div>
      )}
      {(assign.error || remove.error) && (
        <p className="mt-1 text-xs text-red-500">
          {(assign.error ?? remove.error) instanceof Error ? (assign.error ?? remove.error)?.message : "Round update failed"}
        </p>
      )}
    </div>
  );
}

function JudgeForm({
  onSubmit,
  error,
}: {
  onSubmit: (body: { name: string; email?: string; pin?: string }) => void;
  error?: string;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  return (
    <form
      id="judge-form"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, email: email || undefined, pin: pin || undefined });
      }}
    >
      <Field label="Judge name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alice Judge" required />
      </Field>
      <Field label="Email (optional)">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="alice@ke.local" />
      </Field>
      <Field label="PIN (optional)" hint="Leave empty to auto-generate a 4-digit PIN.">
        <Input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" />
      </Field>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
    </form>
  );
}

interface JudgeSessionRow {
  id: string;
  deviceId: string;
  status: string;
  lastSeenAt: Date | string | null;
  createdAt: Date | string | null;
}

function JudgeSessionsPanel({ judgeId, judgeCode }: { judgeId: string; judgeCode: string }) {
  const qc = useQueryClient();
  const sessions = useQuery({
    queryKey: ["judge-sessions", judgeId],
    queryFn: () => fetch(`${API_BASE_URL}/judges/${judgeId}/sessions`, { credentials: "include" }).then((r) => r.json()),
    refetchInterval: 10_000,
  });

  const terminate = useMutation({
    mutationFn: (sessionId: string) =>
      adminFetch(`/judges/${judgeId}/sessions/${sessionId}/terminate`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["judge-sessions", judgeId] }),
  });

  const rows: JudgeSessionRow[] = Array.isArray(sessions.data) ? sessions.data : [];

  return (
    <div className="mt-3 rounded-lg border border-ink-100 bg-ink-50 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
        Recent sessions · {judgeCode}
      </p>
      {sessions.isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-400">No sessions recorded.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-ink-700">
                  {String(s.deviceId).slice(0, 12)}…
                </p>
                <p className="text-[11px] text-ink-400">
                  {s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : "never seen"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  color={s.status === "ACTIVE" ? "green" : s.status === "TERMINATED" ? "red" : "default"}
                >
                  {s.status}
                </Badge>
                {s.status === "ACTIVE" && (
                  <Button
                    variant="ghost"
                    className="!px-2 !py-1 text-xs"
                    disabled={terminate.isPending}
                    onClick={() => terminate.mutate(s.id)}
                  >
                    Terminate
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {terminate.error instanceof Error && (
        <p className="mt-1 text-xs text-red-500">{terminate.error.message}</p>
      )}
    </div>
  );
}