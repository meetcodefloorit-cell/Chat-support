"use client";

import { Workload } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { HeadsetIcon } from "@/components/ui/icons";

export function WorkloadPanel({ workload }: { workload: Workload | null }) {
  if (!workload || workload.operators.length === 0) {
    return <EmptyState icon={<HeadsetIcon />} title="No operators assigned yet" compact />;
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-4 text-sm">
        <Badge color="emerald" dot>
          {workload.online_count} Online
        </Badge>
        <Badge color="gray" dot>
          {workload.offline_count} Offline
        </Badge>
      </div>
      <div className="divide-y divide-white/5 rounded-xl border border-white/10">
        {workload.operators.map((op) => (
          <div key={op.operator_id} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`h-2 w-2 shrink-0 rounded-full ${op.is_online ? "bg-emerald-400" : "bg-slate-600"}`} />
              <span className="truncate text-sm text-white">{op.operator_name}</span>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-xs text-slate-400">
              <span>{op.active_members} active</span>
              <span>{op.assigned_project_count} project{op.assigned_project_count === 1 ? "" : "s"}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
