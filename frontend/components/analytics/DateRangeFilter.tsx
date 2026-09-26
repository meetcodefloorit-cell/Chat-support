"use client";

import { useState } from "react";
import { Tone } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

export interface DateRangeValue {
  key: string;
  label: string;
  startDate: string; // ISO
  endDate: string; // ISO
}

function startOfDay(d: Date): Date {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}
function endOfDay(d: Date): Date {
  const n = new Date(d);
  n.setHours(23, 59, 59, 999);
  return n;
}
function startOfWeek(d: Date): Date {
  const n = startOfDay(d);
  const day = n.getDay();
  n.setDate(n.getDate() - day);
  return n;
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

export function computePreset(key: string): DateRangeValue {
  const now = new Date();
  switch (key) {
    case "today":
      return { key, label: "Today", startDate: startOfDay(now).toISOString(), endDate: endOfDay(now).toISOString() };
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { key, label: "Yesterday", startDate: startOfDay(y).toISOString(), endDate: endOfDay(y).toISOString() };
    }
    case "last7": {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      return { key, label: "Last 7 Days", startDate: startOfDay(start).toISOString(), endDate: endOfDay(now).toISOString() };
    }
    case "last30": {
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      return { key, label: "Last 30 Days", startDate: startOfDay(start).toISOString(), endDate: endOfDay(now).toISOString() };
    }
    case "this_week":
      return { key, label: "This Week", startDate: startOfWeek(now).toISOString(), endDate: endOfDay(now).toISOString() };
    case "this_month":
      return { key, label: "This Month", startDate: startOfMonth(now).toISOString(), endDate: endOfDay(now).toISOString() };
    default:
      return computePreset("last30");
  }
}

const PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7", label: "Last 7 Days" },
  { key: "last30", label: "Last 30 Days" },
  { key: "this_week", label: "This Week" },
  { key: "this_month", label: "This Month" },
];

const toneActive: Record<Tone, string> = {
  admin: "bg-admin text-white",
  operator: "bg-operator text-white",
  member: "bg-member text-white",
  neutral: "bg-white/15 text-white",
  danger: "bg-danger text-white",
};

export function DateRangeFilter({
  value,
  onChange,
  tone = "operator",
}: {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  tone?: Tone;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => {
            setCustomOpen(false);
            onChange(computePreset(p.key));
          }}
          className={cn(
            "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer",
            value.key === p.key ? toneActive[tone] : "text-slate-400 bg-white/[0.03] border border-white/10 hover:bg-white/5 hover:text-slate-200",
          )}
        >
          {p.label}
        </button>
      ))}
      <div className="relative">
        <button
          type="button"
          onClick={() => setCustomOpen((v) => !v)}
          className={cn(
            "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer",
            value.key === "custom" ? toneActive[tone] : "text-slate-400 bg-white/[0.03] border border-white/10 hover:bg-white/5 hover:text-slate-200",
          )}
        >
          Custom Range
        </button>
        {customOpen && (
          <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-white/10 bg-bg-navy p-3 shadow-soft-lg space-y-2">
            <label className="block text-xs text-slate-400">
              Start
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-sm text-white outline-none focus:border-white/30"
              />
            </label>
            <label className="block text-xs text-slate-400">
              End
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-sm text-white outline-none focus:border-white/30"
              />
            </label>
            <button
              type="button"
              disabled={!customStart || !customEnd}
              onClick={() => {
                const start = startOfDay(new Date(customStart));
                const end = endOfDay(new Date(customEnd));
                onChange({ key: "custom", label: "Custom Range", startDate: start.toISOString(), endDate: end.toISOString() });
                setCustomOpen(false);
              }}
              className={cn(
                "w-full rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                !customStart || !customEnd ? "bg-white/5 text-slate-500 cursor-not-allowed" : cn(toneActive[tone], "cursor-pointer"),
              )}
            >
              Apply
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
