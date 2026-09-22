import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Layers, Plus } from "lucide-react";
import { API_BASE_URL } from "../../../lib/api";
import { Badge, Button, Card, EmptyState, Field, Input, Modal } from "../../../components/ui";

const typeColor: Record<string, string> = {
  PRELIMINARY: "bg-blue-100 text-blue-700",
  SEMI_FINAL: "bg-amber-100 text-amber-700",
  FINAL: "bg-emerald-100 text-emerald-700",
};

export function RoundsTab({ event }: { event: any }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const createSection = useMutation({
    mutationFn: async (body: { name: string; type: string; order: number }) => {
      const res = await fetch(`${API_BASE_URL}/events/${event.id}/sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Could not create round");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event", event.id] });
      setCreating(false);
    },
  });

  const sections = event.sections ?? [];

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Add Round
        </Button>
      </div>

      {sections.length === 0 ? (
        <Card>
          <EmptyState icon={<Layers className="h-8 w-8" />} title="No rounds yet" hint="Add rounds like Preliminary, Semi Final, Final." />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sections.map((s: any) => (
            <Card key={s.id} className="p-5">
              <div className="mb-3 flex items-start justify-between">
                <h3 className="font-semibold">{s.name}</h3>
                <Badge color={typeColor[s.type] as any}>{s.type}</Badge>
              </div>
              <p className="text-xs text-ink-400">Order: {s.order}</p>
              <p className="mt-1 text-sm text-ink-500">{s.startups?.length ?? 0} startups</p>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Add round"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" form="round-form" loading={createSection.isPending}>Create</Button>
          </>
        }
      >
        <RoundForm
          order={sections.length + 1}
          onSubmit={(body) => createSection.mutate(body)}
          error={createSection.error?.message}
        />
      </Modal>
    </div>
  );
}

function RoundForm({
  order,
  onSubmit,
  error,
}: {
  order: number;
  onSubmit: (body: { name: string; type: string; order: number }) => void;
  error?: string;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("PRELIMINARY");
  return (
    <form
      id="round-form"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, type, order });
      }}
    >
      <Field label="Round name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Preliminary Round" required />
      </Field>
      <Field label="Type">
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="PRELIMINARY">Preliminary</option>
          <option value="SEMI_FINAL">Semi Final</option>
          <option value="FINAL">Final</option>
        </select>
      </Field>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
    </form>
  );
}