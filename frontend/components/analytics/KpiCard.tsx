"use client";

import { ReactNode, useState } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tone } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

const toneAccent: Record<Tone, string> = {
  operator: "text-operator bg-operator-light",
  admin: "text-admin bg-admin-light",
  member: "text-member bg-member-light",
  neutral: "text-slate-300 bg-white/10",
  danger: "text-danger bg-danger-light",
};

export function KpiCard({
  icon,
  label,
  value,
  tooltip,
  trend,
  loading,
  tone = "operator",
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  tooltip?: string;
  trend?: { direction: "up" | "down" | "flat"; label: string } | null;
  loading?: boolean;
  tone?: Tone;
  onClick?: () => void;
}) {
  const [showTip, setShowTip] = useState(false);

  return (
    <div
      className={cn(
        "relative rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-4 shadow-soft transition-colors duration-200",
        onClick && "cursor-pointer hover:border-white/20 hover:bg-white/[0.06]",
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      <div className="flex items-start justify-between">
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl [&>svg]:h-4.5 [&>svg]:w-4.5", toneAccent[tone])}>
          {icon}
        </div>
        {tooltip && (
          <div className="relative">
            <button
              type="button"
              aria-label={`About ${label}`}
              onClick={(e) => {
                e.stopPropagation();
                setShowTip((v) => !v);
              }}
              onMouseEnter={() => setShowTip(true)}
              onMouseLeave={() => setShowTip(false)}
              className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold text-slate-500 hover:text-slate-300 cursor-help"
            >
              i
            </button>
            {showTip && (
              <div className="absolute right-0 top-6 z-20 w-52 rounded-lg border border-white/10 bg-bg-navy p-2.5 text-xs text-slate-300 shadow-soft-lg">
                {tooltip}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-3">
        <p className="text-xs font-medium text-slate-400">{label}</p>
        {loading ? (
          <Skeleton className="mt-2 h-7 w-16" />
        ) : (
          <p className="mt-1 text-2xl font-semibold text-white tabular-nums">{value}</p>
        )}
        {!loading && trend && (
          <p
            className={cn(
              "mt-1 text-xs font-medium",
              trend.direction === "up" ? "text-emerald-400" : trend.direction === "down" ? "text-red-400" : "text-slate-500",
            )}
          >
            {trend.label}
          </p>
        )}
      </div>
    </div>
  );
}

export function KpiCardSkeleton() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <Skeleton className="h-9 w-9 rounded-xl" />
      <Skeleton className="mt-4 h-3 w-20" />
      <Skeleton className="mt-2 h-7 w-16" />
    </div>
  );
}
