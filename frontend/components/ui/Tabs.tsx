import { cn } from "@/lib/cn";
import { Tone } from "./Button";

export interface TabItem {
  key: string;
  label: string;
  count?: number;
}

const toneActive: Record<Tone, string> = {
  admin: "bg-admin text-white",
  operator: "bg-operator text-white",
  member: "bg-member text-white",
  neutral: "bg-white/15 text-white",
  danger: "bg-danger text-white",
};

/** Compact segmented-control style tab switcher (used for e.g. Active/Terminated, Inbox/Help). */
export function Tabs({
  items,
  value,
  onChange,
  tone = "operator",
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (key: string) => void;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn("inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1", className)}
    >
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(item.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
              active ? toneActive[tone] : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
            )}
          >
            {item.label}
            {item.count != null && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] font-semibold",
                  active ? "bg-white/20" : "bg-white/10 text-slate-400",
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
