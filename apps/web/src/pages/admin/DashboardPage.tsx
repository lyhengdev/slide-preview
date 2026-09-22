import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarDays, Presentation, UserCheck, ShieldAlert, Plus } from "lucide-react";
import { API_BASE_URL } from "../../lib/api";
import { Card, Spinner, EmptyState } from "../../components/ui";

interface EventRow {
  id: string;
  title: string;
  slug: string;
  status: string;
  startDate: string | null;
  _count: { judges: number; startups: number; sections: number };
}

export function DashboardPage() {
  const events = useQuery({
    queryKey: ["events"],
    queryFn: () => fetch(`${API_BASE_URL}/events`, { credentials: "include" }).then((r) => r.json() as Promise<EventRow[]>),
  });

  const stats = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => fetch(`${API_BASE_URL}/admin/stats`, { credentials: "include" }).then((r) => r.json()),
  });

  if (events.isLoading) return <Spinner label="Loading dashboard…" />;

  const statCards = [
    { label: "Events", value: stats.data?.events ?? events.data?.length ?? 0, icon: CalendarDays },
    { label: "Active pitches", value: stats.data?.activePitches ?? 0, icon: Presentation },
    { label: "Judges online (30m)", value: stats.data?.activeJudgeSessions ?? 0, icon: UserCheck },
    { label: "Security events (24h)", value: stats.data?.securityEvents24h ?? 0, icon: ShieldAlert },
  ];

  const statusColor: Record<string, string> = {
    DRAFT: "bg-ink-100 text-ink-600",
    ACTIVE: "bg-emerald-100 text-emerald-700",
    COMPLETED: "bg-blue-100 text-blue-700",
    ARCHIVED: "bg-slate-200 text-slate-700",
  };

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-ink-400">Overview of your pitching events</p>
        </div>
        <Link to="/admin/events" className="btn-primary">
          <Plus className="h-4 w-4" /> New Event
        </Link>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statCards.map((s) => (
          <Card key={s.label} className="p-5">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-ink-100 text-ink-600">
              <s.icon className="h-4 w-4" />
            </div>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs text-ink-400">{s.label}</p>
          </Card>
        ))}
      </div>

      <Card>
        <div className="border-b border-ink-100 px-5 py-4">
          <h2 className="font-semibold">Events</h2>
        </div>
        {!events.data?.length ? (
          <EmptyState
            icon={<CalendarDays className="h-8 w-8" />}
            title="No events yet"
            hint="Create your first event to start managing pitch rounds."
          />
        ) : (
          <div className="divide-y divide-ink-100">
            {events.data.map((ev) => (
              <Link key={ev.id} to={`/admin/events/${ev.id}`} className="flex items-center justify-between px-5 py-4 hover:bg-ink-50">
                <div>
                  <p className="font-medium">{ev.title}</p>
                  <p className="text-xs text-ink-400">
                    {ev._count.judges} judges · {ev._count.startups} startups · {ev._count.sections} rounds
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`badge ${statusColor[ev.status] ?? ""}`}>{ev.status}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}