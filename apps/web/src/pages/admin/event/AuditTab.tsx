import { useQuery } from "@tanstack/react-query";
import { History, ScrollText } from "lucide-react";
import { API_BASE_URL } from "../../../lib/api";
import { Card, EmptyState, Spinner } from "../../../components/ui";
import { SECURITY_EVENT_LABELS } from "@ke/types";

export function AuditTab({ event }: { event: any }) {
  const securityEvents = useQuery({
    queryKey: ["security-events", event.id],
    queryFn: () =>
      fetch(`${API_BASE_URL}/events/${event.id}/security-events`, { credentials: "include" }).then((r) => r.json()),
    refetchInterval: 10_000,
  });

  const auditLogs = useQuery({
    queryKey: ["audit-logs", event.id],
    queryFn: () =>
      fetch(`${API_BASE_URL}/events/${event.id}/audit`, { credentials: "include" }).then((r) => r.json()),
    refetchInterval: 15_000,
  });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="mb-4 flex items-center gap-2 font-semibold">
          <ScrollText className="h-4 w-4 text-accent-600" />
          Security Events
        </h2>
        {securityEvents.isLoading ? (
          <Spinner />
        ) : !securityEvents.data?.length ? (
          <EmptyState icon={<ScrollText className="h-8 w-8" />} title="No security events" hint="Face, tab, and device events appear here." />
        ) : (
          <div className="thin-scroll max-h-96 space-y-2 overflow-y-auto">
            {securityEvents.data.map((e: any) => (
              <div key={e.id} className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">
                    {SECURITY_EVENT_LABELS[e.type] ?? e.type}
                    {e.confidence ? <span className="text-ink-400"> · {(e.confidence * 100).toFixed(0)}%</span> : null}
                  </p>
                  <p className="text-xs text-ink-400">
                    {e.judge ? `${e.judge.judgeCode} (${e.judge.name})` : "system"}
                  </p>
                </div>
                <time className="shrink-0 text-xs text-ink-400">
                  {new Date(e.createdAt).toLocaleTimeString()}
                </time>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 flex items-center gap-2 font-semibold">
          <History className="h-4 w-4 text-accent-600" />
          Audit Log
        </h2>
        {auditLogs.isLoading ? (
          <Spinner />
        ) : !auditLogs.data?.length ? (
          <EmptyState icon={<History className="h-8 w-8" />} title="No audit entries" hint="Admin actions are logged here." />
        ) : (
          <div className="thin-scroll max-h-96 space-y-2 overflow-y-auto">
            {auditLogs.data.map((l: any) => (
              <div key={l.id} className="flex items-start justify-between gap-2 rounded-lg border border-ink-100 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{l.action}</p>
                  <p className="truncate text-xs text-ink-400">
                    {l.admin?.name ?? l.adminId ?? "system"}
                    {l.metadata ? ` · ${JSON.stringify(l.metadata)}` : ""}
                  </p>
                </div>
                <time className="shrink-0 text-xs text-ink-400">
                  {new Date(l.createdAt).toLocaleString()}
                </time>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}