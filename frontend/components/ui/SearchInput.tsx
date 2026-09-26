import { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { SearchIcon } from "./icons";
import { Tone } from "./Button";

const toneFocus: Record<Tone, string> = {
  admin: "focus:border-admin focus:ring-admin/20",
  operator: "focus:border-operator focus:ring-operator/20",
  member: "focus:border-member focus:ring-member/20",
  neutral: "focus:border-white/30 focus:ring-white/10",
  danger: "focus:border-danger focus:ring-danger/20",
};

export function SearchInput({
  tone = "operator",
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { tone?: Tone }) {
  return (
    <div className={cn("relative", className)}>
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
      <input
        className={cn(
          "w-full rounded-lg border border-white/10 bg-white/[0.04] py-2.5 pl-9 pr-3.5 text-sm text-white",
          "placeholder-slate-500 outline-none transition-all focus:ring-2 focus:bg-white/[0.06]",
          toneFocus[tone],
        )}
        {...props}
      />
    </div>
  );
}
