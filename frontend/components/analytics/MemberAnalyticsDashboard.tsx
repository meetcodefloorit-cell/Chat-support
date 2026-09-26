"use client";

import { useEffect, useState } from "react";
import { getMemberAnalytics } from "@/lib/api";
import { MemberAnalytics } from "@/lib/types";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";
import { KpiCard } from "./KpiCard";
import { DateRangeFilter, DateRangeValue, computePreset } from "./DateRangeFilter";
import { VolumeChart } from "./VolumeChart";
import { ResponseTimeChart } from "./ResponseTimeChart";
import { formatCount, formatDateTime, formatDuration } from "./format";
import {
  ChartBarIcon,
  ChatBubbleIcon,
  ClockIcon,
  HeadsetIcon,
  InboxIcon,
  ShieldCheckIcon,
  TrendUpIcon,
} from "@/components/ui/icons";
import { Tone } from "@/components/ui/Button";

export function MemberAnalyticsDashboard({
  token,
  memberId,
  projectId,
  tone = "admin",
}: {
  token: string;
  memberId: number;
  /** Pin analytics to one project; omit to let the backend resolve the member's own project. */
  projectId?: number | null;
  tone?: Tone;
}) {
  const [range, setRange] = useState<DateRangeValue>(() => computePreset("last30"));
  const [data, setData] = useState<MemberAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getMemberAnalytics(token, memberId, { projectId, startDate: range.startDate, endDate: range.endDate })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load customer analytics");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, memberId, projectId, range.startDate, range.endDate]);

  return (
    <div className="space-y-5">
      {/* Profile facts -- not date-filtered */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          {loading ? (
            <Skeleton className="h-5 w-40" />
          ) : (
            <>
              <StatusBadge status={data?.account_status ?? "unknown"} />
              {data?.project_name && <span>Project: <span className="text-slate-200">{data.project_name}</span></span>}
              {data?.assigned_operator_name && (
                <span>
                  · Operator: <span className="text-slate-200">{data.assigned_operator_name}</span>
                </span>
              )}
              <span>· First chat: <span className="text-slate-200">{formatDateTime(data?.first_chat_at)}</span></span>
              <span>· Last chat: <span className="text-slate-200">{formatDateTime(data?.last_chat_at)}</span></span>
            </>
          )}
        </div>
        <DateRangeFilter value={range} onChange={setRange} tone={tone} />
      </div>

      {error && (
        <Card className="border-danger/30 bg-danger-light">
          <CardBody className="text-sm text-red-300">{error}</CardBody>
        </Card>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <KpiCard
          tone={tone}
          icon={<InboxIcon />}
          label="Total Chats"
          value={loading ? "" : formatCount(data?.timing.total_sessions)}
          loading={loading}
          tooltip={`Chat sessions started with this customer during ${range.label.toLowerCase()}.`}
        />
        <KpiCard
          tone={tone}
          icon={<ChatBubbleIcon />}
          label="Active Chats"
          value={loading ? "" : formatCount(data?.active_chats_now)}
          loading={loading}
          tooltip="Chats currently in progress with this customer right now (not limited to the date range)."
        />
        <KpiCard
          tone={tone}
          icon={<ShieldCheckIcon />}
          label="Completed Chats"
          value={loading ? "" : formatCount(data?.timing.completed)}
          loading={loading}
        />
        <KpiCard
          tone={tone}
          icon={<TrendUpIcon />}
          label="Abandoned Chats"
          value={loading ? "" : formatCount(data?.timing.abandoned)}
          loading={loading}
          tooltip="This customer disconnected before the chat was completed."
        />
        <KpiCard
          tone={tone}
          icon={<ChartBarIcon />}
          label="Expired Chats"
          value={loading ? "" : formatCount(data?.timing.auto_closed)}
          loading={loading}
          tooltip="Chat reached the 3-minute maximum duration without being closed (auto-closed / expired)."
        />
        <KpiCard
          tone={tone}
          icon={<HeadsetIcon />}
          label="Total Messages"
          value={loading ? "" : formatCount((data?.messages.sent ?? 0) + (data?.messages.received ?? 0))}
          loading={loading}
          tooltip="Operator + customer messages exchanged in this period."
        />
        <KpiCard
          tone={tone}
          icon={<ClockIcon />}
          label="Average Response Time"
          value={loading ? "" : formatDuration(data?.response_time.avg_seconds)}
          loading={loading}
          tooltip="Average time between this customer's message and the operator's next reply."
        />
        <KpiCard
          tone={tone}
          icon={<ClockIcon />}
          label="Average Waiting Time"
          value={loading ? "" : formatDuration(data?.timing.avg_first_response_seconds)}
          loading={loading}
          tooltip="Server-measured time from the start of a chat to the operator's first reply (1-minute SLA metric)."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Chat Duration &amp; SLA</CardTitle>
        </CardHeader>
        <CardBody>
          {loading ? (
            <SkeletonCard />
          ) : data && data.timing.total_sessions === 0 ? (
            <p className="text-sm text-slate-500">No chat activity in this period.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <KpiCard tone={tone} icon={<ClockIcon />} label="Average Chat Duration" value={formatDuration(data?.timing.avg_handling_seconds)} tooltip="Time from chat start to completion, for successfully completed chats." />
              <KpiCard tone={tone} icon={<ShieldCheckIcon />} label="SLA Compliance" value={data?.timing.sla_compliance_percent != null ? `${data.timing.sla_compliance_percent}%` : "—"} tooltip="Share of this customer's chats where the operator replied within the 1-minute SLA." />
              <KpiCard tone={tone} icon={<TrendUpIcon />} label="Missed (SLA breach)" value={formatCount(data?.timing.sla_breached)} />
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Chat Volume</CardTitle>
          </CardHeader>
          <CardBody>{loading ? <SkeletonCard /> : <VolumeChart points={data?.volume_series ?? []} granularity={data?.range.granularity ?? "day"} />}</CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Response Time Trend</CardTitle>
          </CardHeader>
          <CardBody>
            {loading ? <SkeletonCard /> : <ResponseTimeChart points={data?.response_time_series ?? []} granularity={data?.range.granularity ?? "day"} />}
          </CardBody>
        </Card>
      </div>

      {!loading && data && data.timing.total_sessions === 0 && data.messages.sent + data.messages.received === 0 && (
        <p className="text-center text-sm text-slate-500">No chat activity for this customer yet.</p>
      )}
    </div>
  );
}
