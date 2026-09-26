"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/Skeleton";

export type BadgeColor = "blue" | "indigo" | "purple" | "teal" | "green" | "orange" | "red";

const badgeClass: Record<BadgeColor, string> = {
  blue: "bg-badge-blue-bg text-badge-blue-fg",
  indigo: "bg-badge-indigo-bg text-badge-indigo-fg",
  purple: "bg-badge-purple-bg text-badge-purple-fg",
  teal: "bg-badge-teal-bg text-badge-teal-fg",
  green: "bg-badge-green-bg text-badge-green-fg",
  orange: "bg-badge-orange-bg text-badge-orange-fg",
  red: "bg-badge-red-bg text-badge-red-fg",
};

/** KPI stat tile for light dashboard content areas — colorful icon badge, value, label,
 * optional trend pill. Matches the reference dashboard mockups. */
export function KpiTile({
  icon,
  color,
  label,
  value,
  trend,
  loading,
  className,
}: {
  icon: ReactNode;
  color: BadgeColor;
  label: string;
  value: ReactNode;
  trend?: { direction: "up" | "down"; label: string } | null;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-content-border bg-content-card p-4 shadow-content transition-shadow hover:shadow-content-lg",
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl [&>svg]:h-5 [&>svg]:w-5", badgeClass[color])}>
          {icon}
        </div>
        {!loading && trend && (
          <span className={cn("text-xs font-semibold", trend.direction === "up" ? "text-badge-green-fg" : "text-badge-red-fg")}>
            {trend.direction === "up" ? "+" : ""}
            {trend.label}
          </span>
        )}
      </div>
      <div className="mt-3">
        {loading ? (
          <Skeleton className="h-7 w-16 bg-content-border" />
        ) : (
          <p className="text-2xl font-semibold tabular-nums text-content-text">{value}</p>
        )}
        <p className="mt-0.5 text-xs font-medium text-content-muted">{label}</p>
      </div>
    </div>
  );
}
