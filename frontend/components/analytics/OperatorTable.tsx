"use client";

import { OperatorSummaryRow } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCount, formatDuration } from "./format";
import { HeadsetIcon } from "@/components/ui/icons";

export function OperatorTable({
  operators,
  onViewDetails,
}: {
  operators: OperatorSummaryRow[];
  onViewDetails: (operatorId: number) => void;
}) {
  if (operators.length === 0) {
    return <EmptyState icon={<HeadsetIcon />} title="No operators found" description="No operators are assigned within this scope." compact />;
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-white/10">
              <th className="py-2 pr-3 font-medium">Operator</th>
              <th className="py-2 px-3 font-medium text-right">Chats</th>
              <th className="py-2 px-3 font-medium text-right">Completed</th>
              <th className="py-2 px-3 font-medium text-right">Missed</th>
              <th className="py-2 px-3 font-medium text-right">Abandoned</th>
              <th className="py-2 px-3 font-medium text-right">Auto Closed</th>
              <th className="py-2 px-3 font-medium text-right">Missing Thank You</th>
              <th className="py-2 px-3 font-medium text-right">Mistakes</th>
              <th className="py-2 px-3 font-medium text-right">Avg Reply</th>
              <th className="py-2 px-3 font-medium text-right">SLA</th>
              <th className="py-2 pl-3 font-medium text-right">Status</th>
              <th className="py-2 pl-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {operators.map((op) => (
              <tr key={op.operator_id} className="hover:bg-white/[0.02]">
                <td className="py-2.5 pr-3 text-white font-medium whitespace-nowrap">{op.operator_name}</td>
                <td className="py-2.5 px-3 text-right tabular-nums text-slate-300">{formatCount(op.conversations_started)}</td>
                <td className="py-2.5 px-3 text-right tabular-nums text-slate-300">{formatCount(op.timing.completed)}</td>
                <td className="py-2.5 px-3 text-right tabular-nums text-slate-300">{formatCount(op.timing.missed)}</td>
                <td className="py-2.5 px-3 text-right tabular-nums text-slate-300">{formatCount(op.timing.abandoned)}</td>
                <td className="py-2.5 px-3 text-right tabular-nums text-slate-300">{formatCount(op.timing.auto_closed)}</td>
                <td className="py-2.5 px-3 text-right tabular-nums text-slate-300">{formatCount(op.timing.missing_thank_you_count)}</td>
                <td className="py-2.5 px-3 text-right tabular-nums font-medium text-white">{formatCount(op.timing.operator_mistake_count)}</td>
                <td className="py-2.5 px-3 text-right tabular-nums text-slate-300">{formatDuration(op.timing.avg_first_response_seconds)}</td>
                <td className="py-2.5 px-3 text-right tabular-nums text-slate-300">{op.timing.sla_compliance_percent != null ? `${op.timing.sla_compliance_percent}%` : "—"}</td>
                <td className="py-2.5 pl-3 text-right">
                  <Badge color={op.is_online ? "emerald" : "gray"} dot>
                    {op.is_online ? "Online" : "Offline"}
                  </Badge>
                </td>
                <td className="py-2.5 pl-3 text-right">
                  <Button size="sm" variant="ghost" tone="admin" onClick={() => onViewDetails(op.operator_id)}>
                    View Details
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {operators.map((op) => (
          <div key={op.operator_id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-white text-sm">{op.operator_name}</span>
              <Badge color={op.is_online ? "emerald" : "gray"} dot>
                {op.is_online ? "Online" : "Offline"}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-slate-400 mb-3">
              <span>Chats: <span className="text-white">{formatCount(op.conversations_started)}</span></span>
              <span>Completed: <span className="text-white">{formatCount(op.timing.completed)}</span></span>
              <span>Missed: <span className="text-white">{formatCount(op.timing.missed)}</span></span>
              <span>Abandoned: <span className="text-white">{formatCount(op.timing.abandoned)}</span></span>
              <span>Auto closed: <span className="text-white">{formatCount(op.timing.auto_closed)}</span></span>
              <span>Missing TY: <span className="text-white">{formatCount(op.timing.missing_thank_you_count)}</span></span>
              <span>Mistakes: <span className="text-white">{formatCount(op.timing.operator_mistake_count)}</span></span>
              <span>SLA: <span className="text-white">{op.timing.sla_compliance_percent != null ? `${op.timing.sla_compliance_percent}%` : "—"}</span></span>
            </div>
            <Button size="sm" variant="outline" tone="admin" fullWidth onClick={() => onViewDetails(op.operator_id)}>
              View Details
            </Button>
          </div>
        ))}
      </div>
    </>
  );
}
