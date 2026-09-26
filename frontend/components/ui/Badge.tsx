import { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type BadgeColor = "gray" | "emerald" | "red" | "amber" | "blue" | "violet";

const colorClasses: Record<BadgeColor, string> = {
  gray: "bg-white/10 text-slate-300",
  emerald: "bg-emerald-400/10 text-emerald-300",
  red: "bg-red-400/10 text-red-300",
  amber: "bg-amber-400/10 text-amber-300",
  blue: "bg-blue-400/10 text-blue-300",
  violet: "bg-violet-400/10 text-violet-300",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  color?: BadgeColor;
  dot?: boolean;
}

export function Badge({ color = "gray", dot, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        colorClasses[color],
        className,
      )}
      {...props}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dotColor(color))} />}
      {children}
    </span>
  );
}

function dotColor(color: BadgeColor): string {
  switch (color) {
    case "emerald":
      return "bg-emerald-400";
    case "red":
      return "bg-red-400";
    case "amber":
      return "bg-amber-400";
    case "blue":
      return "bg-blue-400";
    case "violet":
      return "bg-violet-400";
    default:
      return "bg-slate-400";
  }
}

export type MembershipStatus =
  | "active"
  | "removed"
  | "terminated"
  | "deleted"
  | "online"
  | "offline"
  | "inactive"
  | "completed"
  | "abandoned"
  | "expired"
  | "auto_closed";

const statusMap: Record<MembershipStatus, { label: string; color: BadgeColor }> = {
  active: { label: "Active", color: "emerald" },
  online: { label: "Online", color: "emerald" },
  inactive: { label: "Inactive", color: "gray" },
  offline: { label: "Offline", color: "gray" },
  removed: { label: "Removed", color: "red" },
  terminated: { label: "Terminated", color: "red" },
  deleted: { label: "Deleted", color: "red" },
  completed: { label: "Completed", color: "emerald" },
  abandoned: { label: "Abandoned", color: "red" },
  expired: { label: "Expired", color: "amber" },
  auto_closed: { label: "Expired", color: "amber" },
};

/** Shared status pill for membership/presence-style states used across admin panels. */
export function StatusBadge({
  status,
  className,
}: {
  status: MembershipStatus | string;
  className?: string;
}) {
  const normalized = status.toLowerCase() as MembershipStatus;
  const entry = statusMap[normalized] ?? { label: status, color: "gray" as BadgeColor };
  return (
    <Badge color={entry.color} dot className={className}>
      {entry.label}
    </Badge>
  );
}
