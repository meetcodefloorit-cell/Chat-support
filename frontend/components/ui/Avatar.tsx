import { cn } from "@/lib/cn";
import { Tone } from "./Button";

const toneBg: Record<Tone, string> = {
  admin: "bg-admin-light text-admin ring-1 ring-admin/20",
  operator: "bg-operator-light text-operator ring-1 ring-operator/20",
  member: "bg-member-light text-member ring-1 ring-member/20",
  neutral: "bg-white/10 text-slate-300 ring-1 ring-white/10",
  danger: "bg-danger-light text-danger ring-1 ring-danger/20",
};

const sizeClasses = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
};

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  tone = "neutral",
  size = "md",
  className,
}: {
  name: string;
  tone?: Tone;
  size?: keyof typeof sizeClasses;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        toneBg[tone],
        sizeClasses[size],
        className,
      )}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
