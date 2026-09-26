"use client";

import { useEffect, useState } from "react";
import { getMyOperatorAnalytics } from "@/lib/api";
import { OperatorAnalytics, User } from "@/lib/types";
import { formatCount, formatDuration } from "@/components/analytics/format";
import { KpiTile } from "./KpiTile";
import { DataCard, LightBadge } from "./DataCard";
import { computePreset, DateRangeValue } from "@/components/analytics/DateRangeFilter";
import { ChartBarIcon, ChatBubbleIcon, ClockIcon, InboxIcon, ShieldCheckIcon, TrendUpIcon } from "@/components/ui/icons";

const RANGE_PRESETS = [
  { key: "today", label: "Today" },
  { key: "last7", label: "Last 7 Days" },
  { key: "last30", label: "Last 30 Days" },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function OperatorDashboardHome({
  token,
  currentUser,
  projectId,
}: {
  token: string;
  currentUser: User;
  projectId: number | null;
}) {
  const [range, setRange] = useState<DateRangeValue>(() => computePreset("today"));
  const [data, setData] = useState<OperatorAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getMyOperatorAnalytics(token, { projectId, startDate: range.startDate, endDate: range.endDate })
      .then((res) => {
        if (!cancelled) setData(res);
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
  }, [token, projectId, range.startDate, range.endDate]);

  const isOnline = data?.presence.find((p) => p.project_id === projectId)?.is_online ?? false;

  return (
    <div className="min-h-full bg-content-bg px-6 py-6">
      <div className="max-w-[1200px] mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-content-text">
              {greeting()}, {currentUser.name}
            </h1>
            <p className="text-sm text-content-muted mt-0.5 flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-badge-green-fg" : "bg-slate-300"}`} />
              {isOnline ? "Online" : "Offline"} · Here&apos;s how you&apos;re doing today.
            </p>
          </div>
          <div className="flex items-center gap-1.5 rounded-xl border border-content-border bg-content-card p-1 shadow-content">
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setRange(computePreset(p.key))}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  range.key === p.key ? "bg-operator text-white" : "text-content-muted hover:bg-content-bg"
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
          <KpiTile icon={<InboxIcon />} color="blue" label="Chats Received" value={formatCount(data?.conversations_started)} loading={loading} />
          <KpiTile icon={<ChatBubbleIcon />} color="indigo" label="Active Chats" value={formatCount(data?.conversations.active)} loading={loading} />
          <KpiTile icon={<TrendUpIcon />} color="green" label="Completed" value={formatCount(data?.timing.completed)} loading={loading} />
          <KpiTile icon={<ClockIcon />} color="orange" label="Missed" value={formatCount(data?.timing.missed)} loading={loading} />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiTile icon={<TrendUpIcon />} color="red" label="Abandoned" value={formatCount(data?.timing.abandoned)} loading={loading} />
          <KpiTile icon={<ClockIcon />} color="purple" label="Avg Response" value={formatDuration(data?.timing.avg_first_response_seconds)} loading={loading} />
          <KpiTile icon={<ClockIcon />} color="teal" label="Avg Handling" value={formatDuration(data?.timing.avg_handling_seconds)} loading={loading} />
          <KpiTile icon={<ShieldCheckIcon />} color="green" label="SLA Compliance" value={data?.timing.sla_compliance_percent != null ? `${data.timing.sla_compliance_percent}%` : "—"} loading={loading} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <DataCard title="Today's Performance">
            {loading ? (
              <div className="text-sm text-content-muted">Loading…</div>
            ) : (
              <div className="space-y-3 text-sm">
                <Row label="Chats Received" value={formatCount(data?.conversations_started)} />
                <Row label="Completed" value={formatCount(data?.timing.completed)} />
                <Row label="Missed" value={formatCount(data?.timing.missed)} />
                <Row label="Abandoned" value={formatCount(data?.timing.abandoned)} />
                <Row label="Auto-Closed" value={formatCount(data?.timing.auto_closed)} />
                <Row label="Missing Thank You" value={formatCount(data?.timing.missing_thank_you_count)} />
                <Row label="Operator Mistakes" value={formatCount(data?.timing.operator_mistake_count)} />
              </div>
            )}
          </DataCard>

          <DataCard title="Conversation Status">
            {loading || !data ? (
              <div className="text-sm text-content-muted">Loading…</div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <LightBadge color="green">Active</LightBadge>
                  <span className="text-sm font-medium text-content-text">{data.conversations.active}</span>
                </div>
                <div className="flex items-center justify-between">
                  <LightBadge color="blue">Reassigned</LightBadge>
                  <span className="text-sm font-medium text-content-text">{data.conversations.reassigned}</span>
                </div>
                <div className="flex items-center justify-between">
                  <LightBadge color="red">Terminated</LightBadge>
                  <span className="text-sm font-medium text-content-text">{data.conversations.terminated}</span>
                </div>
                <div className="flex items-center justify-between">
                  <LightBadge color="gray">Removed</LightBadge>
                  <span className="text-sm font-medium text-content-text">{data.conversations.removed}</span>
                </div>
              </div>
            )}
          </DataCard>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNodeLike }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-content-muted">{label}</span>
      <span className="font-medium text-content-text tabular-nums">{value}</span>
    </div>
  );
}

type ReactNodeLike = string | number;
