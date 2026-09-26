"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";
import { SpinnerIcon } from "./icons";

export type Tone = "admin" | "operator" | "member" | "neutral" | "danger";
export type Variant = "solid" | "outline" | "ghost" | "subtle";
export type Size = "sm" | "md" | "lg";

const toneSolid: Record<Tone, string> = {
  admin:
    "bg-gradient-to-r from-admin to-admin-dark text-white shadow-glow-admin hover:brightness-110 focus-visible:ring-admin/50",
  operator:
    "bg-gradient-to-r from-operator to-operator-dark text-white shadow-glow-operator hover:brightness-110 focus-visible:ring-operator/50",
  member:
    "bg-gradient-to-r from-member to-member-dark text-white shadow-glow-member hover:brightness-110 focus-visible:ring-member/50",
  neutral: "bg-white/10 hover:bg-white/15 text-white border border-white/10 focus-visible:ring-white/30",
  danger: "bg-gradient-to-r from-danger to-danger-dark text-white hover:brightness-110 focus-visible:ring-danger/50",
};

const toneOutline: Record<Tone, string> = {
  admin: "border border-admin/40 text-admin hover:bg-admin-light focus-visible:ring-admin/30",
  operator:
    "border border-operator/40 text-operator hover:bg-operator-light focus-visible:ring-operator/30",
  member: "border border-member/40 text-member hover:bg-member-light focus-visible:ring-member/30",
  neutral: "border border-white/15 text-slate-200 hover:bg-white/5 focus-visible:ring-white/20",
  danger: "border border-danger/40 text-danger hover:bg-danger-light focus-visible:ring-danger/30",
};

const toneGhost: Record<Tone, string> = {
  admin: "text-admin hover:bg-admin-light focus-visible:ring-admin/30",
  operator: "text-operator hover:bg-operator-light focus-visible:ring-operator/30",
  member: "text-member hover:bg-member-light focus-visible:ring-member/30",
  neutral: "text-slate-300 hover:bg-white/5 hover:text-white focus-visible:ring-white/20",
  danger: "text-danger hover:bg-danger-light focus-visible:ring-danger/30",
};

const toneSubtle: Record<Tone, string> = {
  admin: "bg-admin-light text-admin hover:bg-admin/15 focus-visible:ring-admin/30",
  operator: "bg-operator-light text-operator hover:bg-operator/15 focus-visible:ring-operator/30",
  member: "bg-member-light text-member hover:bg-member/15 focus-visible:ring-member/30",
  neutral: "bg-white/5 text-slate-200 hover:bg-white/10 focus-visible:ring-white/20",
  danger: "bg-danger-light text-danger hover:bg-danger/15 focus-visible:ring-danger/30",
};

const variantMap: Record<Variant, Record<Tone, string>> = {
  solid: toneSolid,
  outline: toneOutline,
  ghost: toneGhost,
  subtle: toneSubtle,
};

const sizeClasses: Record<Size, string> = {
  sm: "text-xs px-2.5 py-1.5 gap-1.5 rounded-lg",
  md: "text-sm px-3.5 py-2 gap-2 rounded-lg",
  lg: "text-sm px-5 py-2.5 gap-2 rounded-xl",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    tone = "neutral",
    variant = "solid",
    size = "md",
    loading = false,
    disabled,
    leftIcon,
    rightIcon,
    fullWidth,
    className,
    children,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center font-medium transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-2",
        "disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap",
        sizeClasses[size],
        variantMap[variant][tone],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {loading ? (
        <SpinnerIcon className="h-4 w-4 animate-spin" />
      ) : (
        leftIcon && <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4">{leftIcon}</span>
      )}
      {children}
      {!loading && rightIcon && <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4">{rightIcon}</span>}
    </button>
  );
});

export function IconButton({
  tone = "neutral",
  variant = "ghost",
  size = "md",
  className,
  "aria-label": ariaLabel,
  children,
  ...props
}: ButtonProps & { "aria-label": string }) {
  const padding = size === "sm" ? "p-1.5" : size === "lg" ? "p-2.5" : "p-2";
  return (
    <button
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center justify-center rounded-lg transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-2",
        "disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer",
        "[&>svg]:h-5 [&>svg]:w-5",
        padding,
        variantMap[variant][tone],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
