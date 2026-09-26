"use client";

import { useEffect, useState } from "react";
import { getAnalyticsOverview, getWorkload } from "@/lib/api";
import { AdminOverview, Project, Workload } from "@/lib/types";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "./KpiCard";
import { DateRangeFilter, DateRangeValue, computePreset } from "./DateRangeFilter";
import { VolumeChart } from "./VolumeChart";
import { OperatorTable } from "./OperatorTable";
import { OperatorComparisonChart } from "./OperatorComparisonChart";
import { WorkloadPanel } from "./WorkloadPanel";
import { OperatorAnalyticsDashboard } from "./OperatorAnalyticsDashboard";
import { formatCount, formatDuration } from "./format";
import { ChartBarIcon, ChatBubbleIcon, ClockIcon, FolderIcon, InboxIcon, ShieldCheckIcon, TrendUpIcon } from "@/components/ui/icons";
import { AppSelect } from "@/components/ui/AppSelect";

/** Sentinel option value for "All Authorized Projects" — real project ids are always positive. */
const ALL_PROJECTS_VALUE = -1;

export function AdminAnalyticsOverview({ token, projects }: { token: string; projects: Project[] }) {
  const [range, setRange] = useState<DateRangeValue>(() => computePreset("last30"));
  const [projectId, setProjectId] = useState<number | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [workload, setWorkload] = useState<Workload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailOperatorId, setDetailOperatorId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      getAnalyticsOverview(token, { projectId, startDate: range.startDate, endDate: range.endDate }),
      getWorkload(token, projectId),
    ])
      .then(([ov, wl]) => {
        if (!cancelled) {
          setOverview(ov);
          setWorkload(wl);
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
  }, [token, projectId, range.startDate, range.endDate]);

  const activeProjects = projects.filter((p) => p.is_active);
  const detailOperator = overview?.operators.find((o) => o.operator_id === detailOperatorId) ?? null;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Analytics"
        description="Real chat, response-time and workload data across your operators and projects."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AppSelect
              aria-label="Filter by project"
              tone="admin"
              size="sm"
              icon={<FolderIcon />}
              className="w-48"
              value={projectId ?? ALL_PROJECTS_VALUE}
              onChange={(v) => setProjectId(v === ALL_PROJECTS_VALUE ? null : v)}
              options={[
                { value: ALL_PROJECTS_VALUE, label: "All Authorized Projects" },
                ...activeProjects.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
            <DateRangeFilter value={range} onChange={setRange} tone="admin" />
          </div>
        }
      />

      {error && (
        <Card className="border-danger/30 bg-danger-light">
          <CardBody className="text-sm text-red-300">{error}</CardBody>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          tone="admin"
          icon={<InboxIcon />}
          label="Total Chats"
          value={loading ? "" : formatCount(overview?.conversations_started)}
          loading={loading}
          tooltip={`Conversations started across the selected scope during ${range.label.toLowerCase()}.`}
        />
        <KpiCard
          tone="admin"
          icon={<ChatBubbleIcon />}
          label="Active Chats"
          value={loading ? "" : formatCount(overview?.conversations.active)}
          loading={loading}
          tooltip="Members currently actively assigned to an operator right now."
        />
        <KpiCard
          tone="admin"
          icon={<ChartBarIcon />}
          label="Terminated (current)"
          value={loading ? "" : formatCount(overview?.conversations.terminated)}
          loading={loading}
        />
        <KpiCard
          tone="admin"
          icon={<ClockIcon />}
          label="Average Reply Time"
          value={loading ? "" : formatDuration(overview?.response_time.avg_seconds)}
          loading={loading}
          tooltip="Average time between a member's message and an operator's next reply, in this period."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Response &amp; Closing SLA</CardTitle>
        </CardHeader>
        <CardBody>
          {loading ? (
            <SkeletonCard />
          ) : overview && overview.timing.total_sessions === 0 ? (
            <p className="text-sm text-slate-500">No timed chat sessions in this period.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KpiCard tone="admin" icon={<ShieldCheckIcon />} label="SLA Compliance" value={overview?.timing.sla_compliance_percent != null ? `${overview.timing.sla_compliance_percent}%` : "—"} tooltip="Share of first operator replies sent within the 1-minute SLA, across this scope." />
              <KpiCard tone="admin" icon={<ClockIcon />} label="Missed (SLA breach)" value={formatCount(overview?.timing.sla_breached)} />
              <KpiCard tone="admin" icon={<TrendUpIcon />} label="Abandoned" value={formatCount(overview?.timing.abandoned)} />
              <KpiCard tone="admin" icon={<ChartBarIcon />} label="Auto-Closed" value={formatCount(overview?.timing.auto_closed)} />
              <KpiCard tone="admin" icon={<ChatBubbleIcon />} label="Missing Thank You" value={formatCount(overview?.timing.missing_thank_you_count)} />
              <KpiCard tone="admin" icon={<TrendUpIcon />} label="Total Operator Mistakes" value={formatCount(overview?.timing.operator_mistake_count)} />
              <KpiCard tone="admin" icon={<ClockIcon />} label="Avg First Response" value={formatDuration(overview?.timing.avg_first_response_seconds)} />
              <KpiCard tone="admin" icon={<ClockIcon />} label="Avg Handling Time" value={formatDuration(overview?.timing.avg_handling_seconds)} />
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Chat Volume</CardTitle>
        </CardHeader>
        <CardBody>{loading ? <SkeletonCard /> : <VolumeChart points={overview?.volume_series ?? []} granularity={overview?.range.granularity ?? "day"} />}</CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Operator Performance</CardTitle>
        </CardHeader>
        <CardBody>{loading ? <SkeletonCard /> : <OperatorTable operators={overview?.operators ?? []} onViewDetails={setDetailOperatorId} />}</CardBody>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Operator Performance Comparison</CardTitle>
          </CardHeader>
          <CardBody>{loading ? <SkeletonCard /> : <OperatorComparisonChart operators={overview?.operators ?? []} />}</CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Operator Workload</CardTitle>
          </CardHeader>
          <CardBody>{loading ? <SkeletonCard /> : <WorkloadPanel workload={workload} />}</CardBody>
        </Card>
      </div>

      <Modal open={detailOperatorId != null} onClose={() => setDetailOperatorId(null)} size="xl" title={detailOperator ? `${detailOperator.operator_name} — Analytics` : "Operator Analytics"}>
        {detailOperatorId != null && <OperatorAnalyticsDashboard token={token} operatorId={detailOperatorId} projects={projects} tone="admin" />}
      </Modal>
    </div>
  );
}
