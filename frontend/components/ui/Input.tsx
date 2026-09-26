import { InputHTMLAttributes, LabelHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";
import { Tone } from "./Button";

const toneFocus: Record<Tone, string> = {
  admin: "focus:border-admin focus:ring-admin/20",
  operator: "focus:border-operator focus:ring-operator/20",
  member: "focus:border-member focus:ring-member/20",
  neutral: "focus:border-white/30 focus:ring-white/10",
  danger: "focus:border-danger focus:ring-danger/20",
};

const fieldBase =
  "w-full rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white " +
  "placeholder-slate-500 outline-none transition-all focus:ring-2 focus:bg-white/[0.06] " +
  "disabled:bg-white/[0.02] disabled:text-slate-500";

const selectFieldBase =
  "w-full rounded-lg border border-white/10 bg-bg-navy px-3.5 py-2.5 text-sm text-white " +
  "outline-none transition-all focus:ring-2 disabled:bg-white/[0.02] disabled:text-slate-500";

export interface FieldElProps {
  tone?: Tone;
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & FieldElProps
>(function Input({ className, tone = "operator", ...props }, ref) {
  return <input ref={ref} className={cn(fieldBase, toneFocus[tone], className)} {...props} />;
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & FieldElProps
>(function Textarea({ className, tone = "operator", ...props }, ref) {
  return (
    <textarea ref={ref} className={cn(fieldBase, toneFocus[tone], "resize-none", className)} {...props} />
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & FieldElProps
>(function Select({ className, tone = "operator", children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(selectFieldBase, toneFocus[tone], "cursor-pointer pr-8 [color-scheme:dark]", className)}
      {...props}
    >
      {children}
    </select>
  );
});

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium text-slate-300", className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
