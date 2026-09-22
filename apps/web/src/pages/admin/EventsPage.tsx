import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { CalendarDays, Plus } from "lucide-react";
import { API_BASE_URL } from "../../lib/api";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Spinner } from "../../components/ui";

interface EventRow {
  id: string;
  title: string;
  slug: string;
  status: string;
  _count: { judges: number; startups: number; sections: number };
}

export function EventsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const events = useQuery({
    queryKey: ["events"],
    queryFn: () => fetch(`${API_BASE_URL}/events`, { credentials: "include" }).then((r) => r.json() as Promise<EventRow[]>),
  });

  const createEvent = useMutation({
    mutationFn: async (body: { title: string; slug: string; description?: string }) => {
      const res = await fetch(`${API_BASE_URL}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to create event");
      return res.json();
    },
    onSuccess: (ev) => {
      qc.invalidateQueries({ queryKey: ["events"] });
      setCreating(false);
      navigate(`/admin/events/${ev.id}`);
    },
  });

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Events</h1>
          <p className="text-sm text-ink-400">Manage pitching competitions</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New Event
        </Button>
      </div>

      {events.isLoading ? (
        <Spinner />
      ) : !events.data?.length ? (
        <Card>
          <EmptyState
            icon={<CalendarDays className="h-8 w-8" />}
            title="No events yet"
            hint="Create an event to get started."
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {events.data.map((ev) => (
            <Card key={ev.id} className="flex cursor-pointer flex-col p-5 transition hover:shadow-md" >
              <button onClick={() => navigate(`/admin/events/${ev.id}`)} className="text-left">
                <div className="mb-2 flex items-start justify-between">
                  <h3 className="font-semibold">{ev.title}</h3>
                  <Badge color={ev.status === "ACTIVE" ? "green" : ev.status === "COMPLETED" ? "blue" : "default"}>
                    {ev.status}
                  </Badge>
                </div>
                <p className="mb-4 break-all text-xs text-ink-400">{ev.slug}</p>
                <p className="text-xs text-ink-500">
                  {ev._count.judges} judges · {ev._count.startups} startups · {ev._count.sections} rounds
                </p>
              </button>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Create event"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="create-event"
              loading={createEvent.isPending}
            >
              Create
            </Button>
          </>
        }
      >
        <EventForm
          onSubmit={(body) => createEvent.mutate(body)}
          loading={createEvent.isPending}
          error={createEvent.error?.message}
        />
      </Modal>
    </div>
  );
}

function EventForm({
  onSubmit,
  loading,
  error,
}: {
  onSubmit: (body: { title: string; slug: string; description?: string }) => void;
  loading: boolean;
  error?: string;
}) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");

  const autoSlug = (v: string) =>
    v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

  return (
    <form
      id="create-event"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ title, slug: slug || autoSlug(title), description });
      }}
    >
      <Field label="Title">
        <Input value={title} onChange={(e) => { setTitle(e.target.value); if (!slug) setSlug(autoSlug(e.target.value)); }} placeholder="KE Startup Award 2026" required />
      </Field>
      <Field label="Slug" hint="Used for a stable public identifier.">
        <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="ke-startup-award-2026" required />
      </Field>
      <Field label="Description">
        <textarea
          className="input min-h-20"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description…"
        />
      </Field>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      {loading && <p className="text-xs text-ink-400">Creating event…</p>}
    </form>
  );
}