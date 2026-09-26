"use client";

import { useEffect, useState } from "react";
import { getOperatorPresenceAnalytics, getOperatorPresenceHistory } from "@/lib/api";
import { PresenceAnalytics, PresenceHistoryEvent } from "@/lib/types";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonCard, SkeletonRow } from "@/components/ui/Skeleton";
import { KpiCard } from "./KpiCard";
import { DateRangeFilter, DateRangeValue, computePreset } from "./DateRangeFilter";
import { formatCount, formatDuration } from "./format";
import { ChartBarIcon, ClockIcon, HistoryIcon, ZapIcon } from "@/components/ui/icons";
import { Tone } from "@/components/ui/Button";

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function OperatorPresenceHistoryPanel({
  token,
  operatorId,
  operatorName,
  projectId,
  tone = "admin",
}: {
  token: string;
  operatorId: number;
  operatorName: string;
  /** Pin history to one project; omit to see every project this operator has been assigned to. */
  projectId?: number | null;
  tone?: Tone;
}) {
  const [range, setRange] = useState<DateRangeValue>(() => computePreset("last7"));
  const [analytics, setAnalytics] = useState<PresenceAnalytics | null>(null);
  const [events, setEvents] = useState<PresenceHistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const query = { projectId, startDate: range.startDate, endDate: range.endDate };
    Promise.all([getOperatorPresenceAnalytics(token, operatorId, query), getOperatorPresenceHistory(token, operatorId, query)])
      .then(([a, h]) => {
        if (!cancelled) {
          setAnalytics(a);
          setEvents(h);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load presence history");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, operatorId, projectId, range.startDate, range.endDate]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusBadge status={loading ? "offline" : analytics?.is_online ? "online" : "offline"} />
        <DateRangeFilter value={range} onChange={setRange} tone={tone} />
      </div>

      {error && (
        <Card className="border-danger/30 bg-danger-light">
          <CardBody className="text-sm text-red-300">{error}</CardBody>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <KpiCard
          tone={tone}
          icon={<ZapIcon />}
          label="Total Online Duration"
          value={loading ? "" : formatDuration(analytics?.total_online_seconds)}
          loading={loading}
          tooltip={`Total time spent online during ${range.label.toLowerCase()}, from server-timestamped connect/disconnect events.`}
        />
        <KpiCard
          tone={tone}
          icon={<ClockIcon />}
          label="Total Offline Duration"
          value={loading ? "" : formatDuration(analytics?.total_offline_seconds)}
          loading={loading}
        />
        <KpiCard
          tone={tone}
          icon={<ChartBarIcon />}
          label="Number of Sessions"
          value={loading ? "" : formatCount(analytics?.session_count)}
          loading={loading}
          tooltip="How many separate online sessions started in this period."
        />
        <KpiCard tone={tone} icon={<HistoryIcon />} label="First Login" value={loading ? "" : formatDateLabel(analytics?.first_login_at ?? "") + " " + formatTimeLabel(analytics?.first_login_at ?? "")} loading={loading} />
        <KpiCard tone={tone} icon={<HistoryIcon />} label="Last Logout" value={loading ? "" : formatDateLabel(analytics?.last_logout_at ?? "") + " " + formatTimeLabel(analytics?.last_logout_at ?? "")} loading={loading} />
        <KpiCard
          tone={tone}
          icon={<ZapIcon />}
          label="Active Session Duration"
          value={loading ? "" : formatDuration(analytics?.active_session_seconds)}
          loading={loading}
          tooltip="How long the current online session has been running (only set while online)."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activity / Presence History</CardTitle>
        </CardHeader>
        <div className="divide-y divide-white/5">
          {loading ? (
            <div className="p-4 space-y-3">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : events.length === 0 ? (
            <EmptyState compact icon={<HistoryIcon />} title="No presence history in this period" description="Online/offline events are recorded from real login activity going forward." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Operator</th>
                    <th className="px-4 py-2 font-medium">Event</th>
                    <th className="px-4 py-2 font-medium">Time</th>
                    <th className="px-4 py-2 font-medium">Duration</th>
                    <th className="px-4 py-2 font-medium">Project</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {events.map((e) => (
                    <tr key={e.id} className="text-slate-200">
                      <td className="px-4 py-2.5 whitespace-nowrap">{formatDateLabel(e.occurred_at)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-400">{operatorName}</td>
                      <td className="px-4 py-2.5">
                        <StatusBadge status={e.event_type === "online" ? "online" : "offline"} />
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{formatTimeLabel(e.occurred_at)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {e.event_type === "online" ? (
                          <>
                            {formatDuration(e.duration_seconds)}
                            {e.is_ongoing && <span className="ml-1 text-xs text-emerald-400">(ongoing)</span>}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-400">{e.project_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
