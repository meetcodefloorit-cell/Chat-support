"use client";

import { useEffect, useState } from "react";
import { getMyOperatorAnalytics, getOperatorAnalytics } from "@/lib/api";
import { BreakdownCategory, OperatorAnalytics, Project } from "@/lib/types";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { KpiCard, KpiCardSkeleton } from "./KpiCard";
import { DateRangeFilter, DateRangeValue, computePreset } from "./DateRangeFilter";
import { VolumeChart } from "./VolumeChart";
import { ResponseTimeChart } from "./ResponseTimeChart";
import { OutcomeDonut } from "./OutcomeDonut";
import { ConversationRefList } from "./ConversationRefList";
import { formatCount, formatDuration } from "./format";
import { ChartBarIcon, ChatBubbleIcon, ClockIcon, FolderIcon, InboxIcon, ShieldCheckIcon, TrendUpIcon } from "@/components/ui/icons";
import { Tone } from "@/components/ui/Button";
import { AppSelect } from "@/components/ui/AppSelect";

/** Sentinel option value for "All Assigned Projects" — real project ids are always positive. */
const ALL_PROJECTS_VALUE = -1;

export function OperatorAnalyticsDashboard({
  token,
  operatorId,
  projects,
  tone = "operator",
}: {
  token: string;
  /** Omit to view the current user's own analytics (operator/me). */
  operatorId?: number;
  /** Assigned projects available for the project filter. Filter is hidden when there's only one. */
  projects: Project[];
  tone?: Tone;
}) {
  const [range, setRange] = useState<DateRangeValue>(() => computePreset("last30"));
  const [projectId, setProjectId] = useState<number | null>(null);
  const [data, setData] = useState<OperatorAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<BreakdownCategory | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const query = { projectId, startDate: range.startDate, endDate: range.endDate };
    const fetcher = operatorId != null ? getOperatorAnalytics(token, operatorId, query) : getMyOperatorAnalytics(token, query);
    fetcher
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setSelectedCategory(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load analytics");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, operatorId, projectId, range.startDate, range.endDate]);

  // When an admin is viewing a specific operator's detail, the project filter must reflect
  // THAT operator's own assigned projects -- not the admin's full authorized project list.
  // Once loaded, `data.presence` (sourced from that operator's active OperatorAssignments)
  // is the authoritative source; the `projects` prop is only a fallback for the initial
  // render/self-view case, where it's already scoped to the current operator by the caller.
  const scopedProjects =
    operatorId != null && data
      ? data.presence.map((p) => ({ id: p.project_id, name: p.project_name, is_active: true, logo_url: null, created_at: "" }) as Project)
      : projects;
  const activeProjects = scopedProjects.filter((p) => p.is_active);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {activeProjects.length > 1 && (
            <AppSelect
              aria-label="Filter by assigned project"
              tone={tone}
              size="sm"
              icon={<FolderIcon />}
              className="w-48"
              value={projectId ?? ALL_PROJECTS_VALUE}
              onChange={(v) => setProjectId(v === ALL_PROJECTS_VALUE ? null : v)}
              options={[
                { value: ALL_PROJECTS_VALUE, label: "All Assigned Projects" },
                ...activeProjects.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
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
          label="Total Chats Received"
          value={loading ? "" : formatCount(data?.conversations_started)}
          loading={loading}
          tooltip={`Conversations started with this operator during ${range.label.toLowerCase()}.`}
        />
        <KpiCard
          tone={tone}
          icon={<ChatBubbleIcon />}
          label="Active Chats"
          value={loading ? "" : formatCount(data?.conversations.active)}
          loading={loading}
          tooltip="Members currently actively assigned to this operator right now (not limited to the date range)."
        />
        <KpiCard
          tone={tone}
          icon={<TrendUpIcon />}
          label="Terminated (current)"
          value={loading ? "" : formatCount(data?.conversations.terminated)}
          loading={loading}
          tooltip="Members whose project membership is currently terminated (a real backend state — not date-filtered, since termination has no timestamp in this app)."
        />
        <KpiCard
          tone={tone}
          icon={<ChartBarIcon />}
          label="Removed (current)"
          value={loading ? "" : formatCount(data?.conversations.removed)}
          loading={loading}
          tooltip="Members currently removed from the project (real backend state, not date-filtered)."
        />
        <KpiCard
          tone={tone}
          icon={<ClockIcon />}
          label="Average Reply Time"
          value={loading ? "" : formatDuration(data?.response_time.avg_seconds)}
          loading={loading}
          tooltip="Average time between a member's message and this operator's next reply, for member messages sent in this period."
        />
        <KpiCard
          tone={tone}
          icon={<ClockIcon />}
          label="Fastest Reply"
          value={loading ? "" : formatDuration(data?.response_time.min_seconds)}
          loading={loading}
        />
        <KpiCard
          tone={tone}
          icon={<ClockIcon />}
          label="Slowest Reply"
          value={loading ? "" : formatDuration(data?.response_time.max_seconds)}
          loading={loading}
        />
        <KpiCard
          tone={tone}
          icon={<ChatBubbleIcon />}
          label="Messages Sent / Received"
          value={loading ? "" : `${formatCount(data?.messages.sent)} / ${formatCount(data?.messages.received)}`}
          loading={loading}
          tooltip="Operator messages sent vs. member messages received, in this period."
        />
      </div>
      {!loading && data && data.response_time.sample_size > 0 && (
        <p className="-mt-2 text-xs text-slate-500">Based on {data.response_time.sample_size} timed replies in this period.</p>
      )}

      {/* Presence */}
      {!loading && data && data.presence.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Current Availability</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-wrap gap-2">
            {data.presence.map((p) => (
              <Badge key={p.project_id} color={p.is_online ? "emerald" : "gray"} dot>
                {p.project_name}: {p.is_online ? "Online" : "Offline"}
              </Badge>
            ))}
          </CardBody>
        </Card>
      )}

      {/* SLA / timing (server-authoritative chat session data) */}
      <Card>
        <CardHeader>
          <CardTitle>Response &amp; Closing SLA</CardTitle>
        </CardHeader>
        <CardBody>
          {loading ? (
            <SkeletonCard />
          ) : data && data.timing.total_sessions === 0 ? (
            <p className="text-sm text-slate-500">No conversation activity yet.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KpiCard tone={tone} icon={<ShieldCheckIcon />} label="SLA Compliance" value={data?.timing.sla_compliance_percent != null ? `${data.timing.sla_compliance_percent}%` : "—"} tooltip="Share of chats where the operator's first reply arrived within the 1-minute SLA." />
              <KpiCard tone={tone} icon={<ClockIcon />} label="Missed (SLA breach)" value={formatCount(data?.timing.sla_breached)} tooltip="First operator response missed the 1-minute SLA." />
              <KpiCard tone={tone} icon={<TrendUpIcon />} label="Abandoned" value={formatCount(data?.timing.abandoned)} tooltip="Customer disconnected before the chat was completed." />
              <KpiCard tone={tone} icon={<ChartBarIcon />} label="Auto-Closed" value={formatCount(data?.timing.auto_closed)} tooltip="Chat reached the 3-minute maximum duration." />
              <KpiCard tone={tone} icon={<ClockIcon />} label="Avg First Response" value={formatDuration(data?.timing.avg_first_response_seconds)} tooltip="Authoritative server-measured time from the customer's message to the operator's first reply." />
              <KpiCard tone={tone} icon={<ClockIcon />} label="Avg Handling Time" value={formatDuration(data?.timing.avg_handling_seconds)} tooltip="Time from chat start to completion, for successfully completed chats." />
              <KpiCard tone={tone} icon={<ChatBubbleIcon />} label="Missing Thank You" value={formatCount(data?.timing.missing_thank_you_count)} tooltip="Chats closed/expired without the required closing thank-you message." />
              <KpiCard tone={tone} icon={<TrendUpIcon />} label="Operator Mistakes" value={formatCount(data?.timing.operator_mistake_count)} tooltip="SLA breaches plus missing-thank-you closures, combined." />
            </div>
          )}
        </CardBody>
      </Card>

      {/* Charts */}
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

      <Card>
        <CardHeader>
          <CardTitle>Conversation Outcomes (current status)</CardTitle>
        </CardHeader>
        <CardBody>
          {loading ? (
            <SkeletonCard />
          ) : (
            <div className="space-y-4">
              <OutcomeDonut breakdown={data?.conversations ?? { active: 0, reassigned: 0, terminated: 0, removed: 0 }} onSelect={setSelectedCategory} selected={selectedCategory} />
              {selectedCategory && data && (
                <div>
                  <p className="mb-2 text-xs font-medium text-slate-400">
                    {selectedCategory[0].toUpperCase() + selectedCategory.slice(1)} conversations
                  </p>
                  <ConversationRefList refs={data.breakdown_refs[selectedCategory] ?? []} categoryLabel={selectedCategory} />
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {!loading && data && data.conversations_started === 0 && data.conversations.active + data.conversations.reassigned + data.conversations.terminated + data.conversations.removed === 0 && (
        <p className="text-center text-sm text-slate-500">No conversation activity yet.</p>
      )}
    </div>
  );
}
