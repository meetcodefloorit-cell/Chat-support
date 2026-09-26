"use client";

import { useState } from "react";
import { OperatorSummaryRow } from "@/lib/types";
import { formatCount, formatDuration } from "./format";
import { EmptyState } from "@/components/ui/EmptyState";
import { ChartBarIcon } from "@/components/ui/icons";
import { AppSelect } from "@/components/ui/AppSelect";

export type ComparisonMetric =
  | "conversations_started"
  | "conversations_active"
  | "messages_sent"
  | "messages_received"
  | "avg_response_seconds";

const METRIC_META: Record<ComparisonMetric, { label: string; format: (row: OperatorSummaryRow) => string; value: (row: OperatorSummaryRow) => number }> = {
  conversations_started: {
    label: "Chats Handled",
    format: (r) => formatCount(r.conversations_started),
    value: (r) => r.conversations_started,
  },
  conversations_active: {
    label: "Active Chats (current)",
    format: (r) => formatCount(r.conversations.active),
    value: (r) => r.conversations.active,
  },
  messages_sent: {
    label: "Messages Sent",
    format: (r) => formatCount(r.messages.sent),
    value: (r) => r.messages.sent,
  },
  messages_received: {
    label: "Messages Received",
    format: (r) => formatCount(r.messages.received),
    value: (r) => r.messages.received,
  },
  avg_response_seconds: {
    label: "Average Reply Time",
    format: (r) => formatDuration(r.response_time.avg_seconds),
    value: (r) => r.response_time.avg_seconds ?? 0,
  },
};

export function OperatorComparisonChart({ operators }: { operators: OperatorSummaryRow[] }) {
  const [metric, setMetric] = useState<ComparisonMetric>("conversations_started");

  if (operators.length === 0) {
    return <EmptyState icon={<ChartBarIcon />} title="No operators to compare" compact />;
  }

  const meta = METRIC_META[metric];
  const rows = [...operators].sort((a, b) => meta.value(b) - meta.value(a));
  const maxVal = Math.max(1, ...rows.map((r) => meta.value(r)));

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <label className="text-xs text-slate-400">Metric:</label>
        <AppSelect
          aria-label="Comparison metric"
          tone="admin"
          size="sm"
          className="w-56"
          value={metric}
          onChange={setMetric}
          options={(Object.keys(METRIC_META) as ComparisonMetric[]).map((k) => ({
            value: k,
            label: METRIC_META[k].label,
          }))}
        />
      </div>
      <div className="space-y-2.5">
        {rows.map((r) => {
          const val = meta.value(r);
          const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
          return (
            <div key={r.operator_id} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-xs text-slate-300">{r.operator_name}</span>
              <div className="flex-1 h-6 rounded-md bg-white/[0.04] overflow-hidden">
                <div className="h-full rounded-md bg-gradient-to-r from-admin to-admin-dark transition-all" style={{ width: `${pct}%` }} />
              </div>
              <span className="w-16 shrink-0 text-right text-xs font-medium text-white tabular-nums">{meta.format(r)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
