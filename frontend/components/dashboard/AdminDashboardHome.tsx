"use client";

import { useEffect, useState } from "react";
import { getAnalyticsOverview, getProjectAnalytics, getWorkload } from "@/lib/api";
import { AdminOverview, OperatorSummaryRow, Project, ProjectAnalytics, User, Workload } from "@/lib/types";
import { formatCount, formatDuration } from "@/components/analytics/format";
import { KpiTile } from "./KpiTile";
import { DataCard, LightBadge } from "./DataCard";
import { computePreset, DateRangeValue } from "@/components/analytics/DateRangeFilter";
import {
  ChartBarIcon,
  ChatBubbleIcon,
  ClockIcon,
  HeadsetIcon,
  InboxIcon,
  ShieldCheckIcon,
  TrendUpIcon,
  UsersIcon,
} from "@/components/ui/icons";

const RANGE_PRESETS = [
  { key: "today", label: "Today" },
  { key: "last7", label: "Last 7 Days" },
  { key: "last30", label: "Last 30 Days" },
  { key: "this_month", label: "This Month" },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function AdminDashboardHome({
  token,
  currentUser,
  projects,
  selectedProjectId,
}: {
  token: string;
  currentUser: User;
  projects: Project[];
  /** The project selected in the header. KPIs/operator table below are scoped to it;
   * null means "no project selected" (shown as an explicit "All Projects" state). */
  selectedProjectId: number | null;
}) {
  const [range, setRange] = useState<DateRangeValue>(() => computePreset("last30"));
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [workload, setWorkload] = useState<Workload | null>(null);
  const [projectStats, setProjectStats] = useState<ProjectAnalytics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeProjects = projects.filter((p) => p.is_active);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      getAnalyticsOverview(token, { projectId: selectedProjectId, startDate: range.startDate, endDate: range.endDate }),
      getWorkload(token, selectedProjectId),
      Promise.all(
        activeProjects
          .slice(0, 8)
          .map((p) => getProjectAnalytics(token, p.id, { startDate: range.startDate, endDate: range.endDate })),
      ),
    ])
      .then(([ov, wl, projStats]) => {
        if (cancelled) return;
        setOverview(ov);
        setWorkload(wl);
        setProjectStats(projStats);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load dashboard");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selectedProjectId, range.startDate, range.endDate, projects.length]);

  const completionRate =
    overview && overview.timing.total_sessions > 0
      ? Math.round((overview.timing.completed / overview.timing.total_sessions) * 100)
      : null;

  const outcomes = overview
    ? [
        { label: "Completed", value: overview.timing.completed, color: "#16a34a" },
        { label: "Auto-Closed", value: overview.timing.auto_closed, color: "#ea8c1f" },
        { label: "Abandoned", value: overview.timing.abandoned, color: "#dc2626" },
      ]
    : [];
  const outcomeTotal = outcomes.reduce((s, o) => s + o.value, 0);

  const volumeSeries = overview?.volume_series ?? [];
  const volumeMax = Math.max(1, ...volumeSeries.map((v) => v.conversations_started));

  return (
    <div className="min-h-full bg-content-bg px-6 py-6">
      <div className="max-w-[1400px] mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-content-text">
              {greeting()}, {currentUser.is_super_admin ? "Super Admin" : currentUser.name}
            </h1>
            <p className="text-sm text-content-muted mt-0.5">
              Track performance, manage operations and monitor your support team.
              {selectedProjectId == null && (
                <span className="ml-1.5 font-medium text-content-text">(All Projects)</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1.5 rounded-xl border border-content-border bg-content-card p-1 shadow-content">
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setRange(computePreset(p.key))}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  range.key === p.key ? "bg-admin text-white" : "text-content-muted hover:bg-content-bg"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-badge-red-bg bg-badge-red-bg/60 px-4 py-3 text-sm text-badge-red-fg">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiTile icon={<InboxIcon />} color="blue" label="Total Chats" value={formatCount(overview?.conversations_started)} loading={loading} />
          <KpiTile icon={<ChatBubbleIcon />} color="green" label="Completed" value={formatCount(overview?.timing.completed)} loading={loading} />
          <KpiTile icon={<ClockIcon />} color="purple" label="Missed (SLA breach)" value={formatCount(overview?.timing.sla_breached)} loading={loading} />
          <KpiTile icon={<TrendUpIcon />} color="red" label="Abandoned" value={formatCount(overview?.timing.abandoned)} loading={loading} />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiTile icon={<ClockIcon />} color="indigo" label="Avg Response Time" value={formatDuration(overview?.timing.avg_first_response_seconds)} loading={loading} />
          <KpiTile icon={<ClockIcon />} color="teal" label="Avg Handling Time" value={formatDuration(overview?.timing.avg_handling_seconds)} loading={loading} />
          <KpiTile icon={<ShieldCheckIcon />} color="green" label="SLA Compliance" value={overview?.timing.sla_compliance_percent != null ? `${overview.timing.sla_compliance_percent}%` : "—"} loading={loading} />
          <KpiTile icon={<ChartBarIcon />} color="blue" label="Completion Rate" value={completionRate != null ? `${completionRate}%` : "—"} loading={loading} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <DataCard title="Operator Performance" className="lg:col-span-2" bodyClassName="p-0">
            {loading ? (
              <div className="p-5 text-sm text-content-muted">Loading…</div>
            ) : !overview || overview.operators.length === 0 ? (
              <div className="p-5 text-sm text-content-muted">No operator activity in this period.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-content-muted-2 border-b border-content-border">
                      <th className="py-2.5 pl-5 pr-3 font-medium">Operator</th>
                      <th className="py-2.5 px-3 font-medium text-right">Chats</th>
                      <th className="py-2.5 px-3 font-medium text-right">Completed</th>
                      <th className="py-2.5 px-3 font-medium text-right">Missed</th>
                      <th className="py-2.5 px-3 font-medium text-right">Avg Response</th>
                      <th className="py-2.5 px-3 font-medium text-right">SLA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-content-border">
                    {overview.operators.map((op: OperatorSummaryRow) => (
                      <tr key={op.operator_id}>
                        <td className="py-2.5 pl-5 pr-3 font-medium text-content-text whitespace-nowrap">{op.operator_name}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-content-muted">{formatCount(op.conversations_started)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-content-muted">{formatCount(op.timing.completed)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-content-muted">{formatCount(op.timing.missed)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-content-muted">{formatDuration(op.response_time.avg_seconds)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-content-muted">
                          {op.timing.sla_compliance_percent != null ? `${op.timing.sla_compliance_percent}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DataCard>

          <DataCard title="Chat Outcomes">
            {loading ? (
              <div className="text-sm text-content-muted">Loading…</div>
            ) : outcomeTotal === 0 ? (
              <div className="text-sm text-content-muted">No completed chats in this period.</div>
            ) : (
              <div className="flex items-center gap-6">
                <DonutMini segments={outcomes} total={outcomeTotal} />
                <div className="flex-1 space-y-2">
                  {outcomes.map((o) => (
                    <div key={o.label} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-content-muted">
                        <span className="h-2 w-2 rounded-sm" style={{ background: o.color }} />
                        {o.label}
                      </span>
                      <span className="font-medium text-content-text">{o.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </DataCard>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <DataCard title="Chat Volume" className="lg:col-span-2">
            {loading ? (
              <div className="text-sm text-content-muted">Loading…</div>
            ) : volumeSeries.length === 0 ? (
              <div className="text-sm text-content-muted">No chat activity in this period.</div>
            ) : (
              <div className="flex gap-1.5 h-40">
                {volumeSeries.map((v) => (
                  <div key={v.bucket} className="flex-1 h-full flex flex-col items-center justify-end gap-1 group relative">
                    <div
                      className="w-full rounded-t-md bg-admin/80 group-hover:bg-admin transition-colors"
                      style={{ height: `${Math.max(4, (v.conversations_started / volumeMax) * 100)}%` }}
                      title={`${new Date(v.bucket).toLocaleDateString()}: ${v.conversations_started} chats`}
                    />
                  </div>
                ))}
              </div>
            )}
          </DataCard>

          <DataCard title="Operator Workload">
            {loading || !workload ? (
              <div className="text-sm text-content-muted">Loading…</div>
            ) : workload.operators.length === 0 ? (
              <div className="text-sm text-content-muted">No operators assigned yet.</div>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <LightBadge color="green">{workload.online_count} Online</LightBadge>
                  <LightBadge color="gray">{workload.offline_count} Offline</LightBadge>
                </div>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {workload.operators.slice(0, 8).map((op) => (
                    <div key={op.operator_id} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-content-text">
                        <span className={`h-1.5 w-1.5 rounded-full ${op.is_online ? "bg-badge-green-fg" : "bg-slate-300"}`} />
                        {op.operator_name}
                      </span>
                      <span className="text-content-muted">{op.active_members} active</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </DataCard>
        </div>

        <DataCard title="Project Performance" action={<HeadsetIcon className="h-4 w-4 text-content-muted-2" />}>
          {loading ? (
            <div className="text-sm text-content-muted">Loading…</div>
          ) : projectStats.length === 0 ? (
            <div className="text-sm text-content-muted">No active projects yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-content-muted-2 border-b border-content-border">
                    <th className="py-2 pr-3 font-medium">Project</th>
                    <th className="py-2 px-3 font-medium text-right">Total Chats</th>
                    <th className="py-2 px-3 font-medium text-right">Completed</th>
                    <th className="py-2 px-3 font-medium text-right">SLA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-content-border">
                  {projectStats.map((p) => (
                    <tr key={p.project_id}>
                      <td className="py-2.5 pr-3 font-medium text-content-text flex items-center gap-2">
                        <UsersIcon className="h-3.5 w-3.5 text-content-muted-2" />
                        {p.project_name}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-content-muted">{formatCount(p.conversations_started)}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-content-muted">{formatCount(p.timing.completed)}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-content-muted">
                        {p.timing.sla_compliance_percent != null ? `${p.timing.sla_compliance_percent}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
      </div>
    </div>
  );
}

function DonutMini({ segments, total }: { segments: { label: string; value: number; color: string }[]; total: number }) {
  const size = 100;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#eef1f8" strokeWidth={stroke} />
      {segments
        .filter((s) => s.value > 0)
        .map((s) => {
          const frac = s.value / total;
          const dash = frac * circumference;
          const circle = (
            <circle
              key={s.label}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
            />
          );
          offset += dash;
          return circle;
        })}
      <text x={cx} y={cy} transform={`rotate(90 ${cx} ${cy})`} textAnchor="middle" dominantBaseline="middle" fontSize={18} fontWeight={700} fill="#1b2233">
        {total}
      </text>
    </svg>
  );
}
