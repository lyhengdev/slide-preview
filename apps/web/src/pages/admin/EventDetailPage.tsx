import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { API_BASE_URL } from "../../lib/api";
import { Badge, Card, Spinner } from "../../components/ui";
import { LiveControlTab } from "./event/LiveControlTab";
import { RoundsTab } from "./event/RoundsTab";
import { JudgesTab } from "./event/JudgesTab";
import { StartupsTab } from "./event/StartupsTab";
import { SecurityTab } from "./event/SecurityTab";
import { AuditTab } from "./event/AuditTab";

const tabs = [
  { id: "live", label: "Live Control" },
  { id: "rounds", label: "Rounds" },
  { id: "judges", label: "Judges" },
  { id: "startups", label: "Startups & Decks" },
  { id: "security", label: "Security" },
  { id: "audit", label: "Audit" },
] as const;

type TabId = (typeof tabs)[number]["id"];

export function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<TabId>("live");

  const { data: event, isLoading, error } = useQuery({
    queryKey: ["event", id],
    queryFn: () => fetch(`${API_BASE_URL}/events/${id}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!id,
  });

  if (isLoading) return <Spinner label="Loading event…" />;
  if (error || !event) {
    return <div className="p-8 text-red-600">Could not load event</div>;
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{event.title}</h1>
          <Badge color={event.status === "ACTIVE" ? "green" : event.status === "COMPLETED" ? "blue" : "default"}>
            {event.status}
          </Badge>
        </div>
        <p className="text-sm text-ink-400">{event.slug}</p>
      </div>

      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-ink-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === t.id
                ? "border-accent-600 text-accent-700"
                : "border-transparent text-ink-500 hover:text-ink-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "live" && <LiveControlTab event={event} />}
      {tab === "rounds" && <RoundsTab event={event} />}
      {tab === "judges" && <JudgesTab event={event} />}
      {tab === "startups" && <StartupsTab event={event} />}
      {tab === "security" && <SecurityTab event={event} />}
      {tab === "audit" && <AuditTab event={event} />}
    </div>
  );
}