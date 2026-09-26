"use client";

import { ReactNode, useEffect } from "react";
import { cn } from "@/lib/cn";
import { CloseIcon } from "./icons";
import { IconButton } from "./Button";

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
};

export function Modal({
  open,
  onClose,
  title,
  size = "md",
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  size?: keyof typeof sizeClasses;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-bg-deep/70 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={cn(
          "relative w-full rounded-2xl border border-white/10 bg-bg-navy-elevated/95 backdrop-blur-xl shadow-soft-lg animate-scale-in",
          sizeClasses[size],
        )}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <h2 className="text-base font-semibold text-white">{title}</h2>
            <IconButton aria-label="Close" onClick={onClose} size="sm">
              <CloseIcon />
            </IconButton>
          </div>
        )}
        <div className="px-5 py-4 max-h-[80vh] overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-white/10">{footer}</div>}
      </div>
    </div>
  );
}
