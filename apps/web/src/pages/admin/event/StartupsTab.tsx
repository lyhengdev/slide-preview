import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp, RefreshCw, Rocket, Trash2, Upload } from "lucide-react";
import { API_BASE_URL } from "../../../lib/api";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Spinner } from "../../../components/ui";

const deckStatusColor: Record<string, string> = {
  UPLOADED: "bg-ink-100 text-ink-600",
  PROCESSING: "bg-amber-100 text-amber-700",
  READY: "bg-emerald-100 text-emerald-700",
  FAILED: "bg-red-100 text-red-700",
};

async function adminFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, credentials: "include" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res;
}

export function StartupsTab({ event }: { event: any }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [uploadFor, setUploadFor] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});

  const startups: any[] = event.startups ?? [];
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["event", event.id] });

  const reprocessDeck = useMutation({
    mutationFn: ({ deckId, startupId }: { deckId: string; startupId: string }) =>
      adminFetch(`/decks/${deckId}/reprocess`, { method: "POST" }).then(() => startupId),
    onSuccess: (startupId) => {
      invalidate();
      setUploadErrors((e) => ({ ...e, [startupId]: "" }));
    },
    onError: (err: Error, vars) => setUploadErrors((e) => ({ ...e, [vars.startupId]: err.message })),
  });

  const deleteDeck = useMutation({
    mutationFn: ({ deckId, startupId }: { deckId: string; startupId: string }) =>
      adminFetch(`/decks/${deckId}`, { method: "DELETE" }).then(() => startupId),
    onSuccess: invalidate,
    onError: (err: Error, vars) => setUploadErrors((e) => ({ ...e, [vars.startupId]: err.message })),
  });

  const createStartup = useMutation({
    mutationFn: async (body: { name: string; description?: string; pitchSectionId?: string }) => {
      const res = await fetch(`${API_BASE_URL}/events/${event.id}/startups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Could not create startup");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event", event.id] });
      setCreating(false);
    },
  });

  const uploadDeck = useMutation({
    mutationFn: async ({ startupId, file }: { startupId: string; file: File }) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_BASE_URL}/events/${event.id}/startups/${startupId}/decks`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error ?? "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event", event.id] });
      setUploadFor(null);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Rocket className="h-4 w-4" /> Add Startup
        </Button>
      </div>

      {startups.length === 0 ? (
        <Card>
          <EmptyState icon={<Rocket className="h-8 w-8" />} title="No startups yet" hint="Add startups and upload their decks." />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {startups.map((s: any) => {
            const decks: any[] = s.decks ?? [];
            return (
              <Card key={s.id} className="p-5">
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">{s.name}</h3>
                    <p className="text-xs text-ink-400">{s.pitchSectionId ? "Assigned to a round" : "Unassigned"}</p>
                  </div>
                  <Button variant="secondary" onClick={() => setUploadFor(s.id)}>
                    <Upload className="h-4 w-4" /> Upload Deck
                  </Button>
                </div>

                {decks.length === 0 ? (
                  <p className="text-sm text-ink-400">No decks uploaded.</p>
                ) : (
                  <div className="space-y-2">
                    {decks.map((d: any) => (
                      <div key={d.id} className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2">
                        <div className="flex items-center gap-2 overflow-hidden">
                          <FileUp className="h-4 w-4 shrink-0 text-ink-400" />
                          <p className="truncate text-sm">{d.originalName}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {d.status === "PROCESSING" && <Spinner />}
                          <Badge color={deckStatusColor[d.status] as any}>{d.status}</Badge>
                          <button
                            className="text-ink-300 transition hover:text-accent-600"
                            title="Reprocess deck"
                            disabled={reprocessDeck.isPending}
                            onClick={() => reprocessDeck.mutate({ deckId: d.id, startupId: s.id })}
                          >
                            <RefreshCw className={`h-4 w-4 ${reprocessDeck.isPending ? "animate-spin" : ""}`} />
                          </button>
                          <button
                            className="text-ink-300 transition hover:text-red-500"
                            title="Delete deck"
                            disabled={deleteDeck.isPending}
                            onClick={() => deleteDeck.mutate({ deckId: d.id, startupId: s.id })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                    {decks.some((d) => d.status === "FAILED") && (
                      <p className="text-xs text-red-500">
                        {decks.find((d) => d.status === "FAILED")?.error ?? "Processing failed"}
                      </p>
                    )}
                    {uploadErrors[s.id] && <p className="text-xs text-red-500">{uploadErrors[s.id]}</p>}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {uploadFor && (
        <DeckUploadModal
          startup={startups.find((s) => s.id === uploadFor)}
          onClose={() => setUploadFor(null)}
          uploading={uploadDeck.isPending}
          error={uploadErrors[uploadFor] ?? uploadDeck.error?.message}
          onFile={(file) => uploadDeck.mutate({ startupId: uploadFor, file })}
        />
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Add startup"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" form="startup-form" loading={createStartup.isPending}>Create</Button>
          </>
        }
      >
        <StartupForm
          sections={event.sections ?? []}
          onSubmit={(body) => createStartup.mutate(body)}
          error={createStartup.error?.message}
        />
      </Modal>
    </div>
  );
}

function StartupForm({
  sections,
  onSubmit,
  error,
}: {
  sections: any[];
  onSubmit: (body: { name: string; description?: string; pitchSectionId?: string }) => void;
  error?: string;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sectionId, setSectionId] = useState("");
  return (
    <form
      id="startup-form"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, description: description || undefined, pitchSectionId: sectionId || undefined });
      }}
    >
      <Field label="Startup name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Startup XYZ" required />
      </Field>
      <Field label="Round (optional)">
        <select className="input" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
          <option value="">Unassigned</option>
          {sections.map((s: any) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Description">
        <textarea className="input min-h-20" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
    </form>
  );
}

function DeckUploadModal({
  startup,
  onClose,
  uploading,
  error,
  onFile,
}: {
  startup: any;
  onClose: () => void;
  uploading: boolean;
  error?: string;
  onFile: (file: File) => void;
}) {
  const [selected, setSelected] = useState<File | null>(null);
  return (
    <Modal
      open={!!startup}
      onClose={onClose}
      title={`Upload deck for ${startup?.name ?? ""}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => selected && onFile(selected)} disabled={!selected} loading={uploading}>
            Upload
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-500">
          Supported: <b>PPTX</b> and <b>PDF</b>. Slides are processed in the background — never shared in original form with judges.
        </p>
        <Field label="Deck file">
          <input
            type="file"
            accept=".pdf,.pptx,.ppt"
            className="block w-full text-sm text-ink-500 file:mr-3 file:rounded-lg file:border-0 file:bg-accent-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-accent-700"
            onChange={(e) => setSelected(e.target.files?.[0] ?? null)}
          />
        </Field>
        {selected && (
          <p className="text-xs text-ink-400">
            {selected.name} · {(selected.size / 1024 / 1024).toFixed(1)} MB
          </p>
        )}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        {uploading && <p className="text-sm text-ink-400">Uploading… Your deck will process in the background.</p>}
      </div>
    </Modal>
  );
}