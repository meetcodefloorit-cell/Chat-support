"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CheckIcon, CloseIcon, AlertTriangleIcon, SpinnerIcon } from "./icons";
import { IconButton } from "./Button";

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface ToastItem {
  id: string;
  message: ReactNode;
  variant?: ToastVariant;
  onDismiss?: () => void;
}

const variantStyles: Record<ToastVariant, { wrap: string; icon: ReactNode }> = {
  success: {
    wrap: "bg-bg-navy-elevated/95 backdrop-blur-xl border-emerald-400/20 text-emerald-200",
    icon: <CheckIcon className="h-4 w-4 text-emerald-400" />,
  },
  error: {
    wrap: "bg-bg-navy-elevated/95 backdrop-blur-xl border-red-400/20 text-red-200",
    icon: <AlertTriangleIcon className="h-4 w-4 text-red-400" />,
  },
  warning: {
    wrap: "bg-bg-navy-elevated/95 backdrop-blur-xl border-amber-400/20 text-amber-200",
    icon: <SpinnerIcon className="h-4 w-4 text-amber-400 animate-spin" />,
  },
  info: {
    wrap: "bg-bg-navy-elevated/95 backdrop-blur-xl border-white/10 text-slate-200",
    icon: <SpinnerIcon className="h-4 w-4 text-slate-400 animate-spin" />,
  },
};

/**
 * Presentational, stateless toast stack — pages pass in a list built from their own existing
 * `notice`/`error`/`wsReconnecting`/etc. state, so call sites never need to change; only how
 * these are rendered changes (from a single fixed banner to a proper stacked toast list).
 */
export function ToastStack({ toasts }: { toasts: (ToastItem | null | false | undefined)[] }) {
  const items = toasts.filter((t): t is ToastItem => Boolean(t));
  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed top-4 right-4 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
      {items.map((toast) => {
        const variant = toast.variant ?? "info";
        const style = variantStyles[variant];
        return (
          <div
            key={toast.id}
            role="status"
            className={cn(
              "pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-soft-lg animate-toast-in",
              style.wrap,
            )}
          >
            <span className="mt-0.5 shrink-0">{style.icon}</span>
            <p className="flex-1 text-sm leading-snug">{toast.message}</p>
            {toast.onDismiss && (
              <IconButton
                aria-label="Dismiss"
                size="sm"
                onClick={toast.onDismiss}
                className="-m-1"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </IconButton>
            )}
          </div>
        );
      })}
    </div>
  );
}
