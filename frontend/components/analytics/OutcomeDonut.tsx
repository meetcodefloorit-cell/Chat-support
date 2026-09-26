"use client";

import { BreakdownCategory, ConversationBreakdown } from "@/lib/types";
import { EmptyState } from "@/components/ui/EmptyState";
import { ChartBarIcon } from "@/components/ui/icons";

const CATEGORY_META: Record<BreakdownCategory, { label: string; color: string; description: string }> = {
  active: { label: "Active", color: "#2dd4bf", description: "Member is currently assigned to this operator" },
  reassigned: { label: "Reassigned", color: "#818cf8", description: "Member is still active but was moved to another operator" },
  terminated: { label: "Terminated", color: "#f87171", description: "Member's project membership was terminated" },
  removed: { label: "Removed", color: "#94a3b8", description: "Member was removed from the project" },
};

export function OutcomeDonut({
  breakdown,
  onSelect,
  selected,
}: {
  breakdown: ConversationBreakdown;
  onSelect?: (category: BreakdownCategory) => void;
  selected?: BreakdownCategory | null;
}) {
  const entries = (Object.keys(CATEGORY_META) as BreakdownCategory[]).map((key) => ({
    key,
    value: breakdown[key],
    ...CATEGORY_META[key],
  }));
  const total = entries.reduce((sum, e) => sum + e.value, 0);

  if (total === 0) {
    return <EmptyState icon={<ChartBarIcon />} title="No conversations yet" description="No member conversations found for this operator." compact />;
  }

  const size = 160;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const arcs = entries
    .filter((e) => e.value > 0)
    .map((e) => {
      const fraction = e.value / total;
      const dash = fraction * circumference;
      const arc = { ...e, dash, offset };
      offset += dash;
      return arc;
    });

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
        {arcs.map((a) => (
          <circle
            key={a.key}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={a.color}
            strokeWidth={stroke}
            strokeDasharray={`${a.dash} ${circumference - a.dash}`}
            strokeDashoffset={-a.offset}
            opacity={selected == null || selected === a.key ? 1 : 0.3}
            className={onSelect ? "cursor-pointer transition-opacity" : undefined}
            onClick={onSelect ? () => onSelect(a.key) : undefined}
          />
        ))}
        <text x={cx} y={cy} transform={`rotate(90 ${cx} ${cy})`} textAnchor="middle" dominantBaseline="middle" fontSize={22} fontWeight={600} fill="white">
          {total}
        </text>
      </svg>
      <div className="flex-1 space-y-2 w-full">
        {entries.map((e) => (
          <button
            key={e.key}
            type="button"
            onClick={onSelect ? () => onSelect(e.key) : undefined}
            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
              onSelect ? "cursor-pointer hover:bg-white/5" : ""
            } ${selected === e.key ? "bg-white/5" : ""}`}
            disabled={!onSelect}
          >
            <span className="flex items-center gap-2 text-slate-300">
              <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: e.color }} />
              {e.label}
            </span>
            <span className="font-medium text-white tabular-nums">{e.value}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export { CATEGORY_META };
