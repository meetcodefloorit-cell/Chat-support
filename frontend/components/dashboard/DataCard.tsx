"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function DataCard({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-content-border bg-content-card shadow-content", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between px-5 py-4 border-b border-content-border">
          {typeof title === "string" ? <h3 className="text-sm font-semibold text-content-text">{title}</h3> : title}
          {action}
        </div>
      )}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </div>
  );
}

export function LightBadge({
  color,
  children,
}: {
  color: "blue" | "green" | "red" | "orange" | "purple" | "gray";
  children: ReactNode;
}) {
  const map: Record<string, string> = {
    blue: "bg-badge-blue-bg text-badge-blue-fg",
    green: "bg-badge-green-bg text-badge-green-fg",
    red: "bg-badge-red-bg text-badge-red-fg",
    orange: "bg-badge-orange-bg text-badge-orange-fg",
    purple: "bg-badge-purple-bg text-badge-purple-fg",
    gray: "bg-slate-100 text-slate-500",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium", map[color])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
