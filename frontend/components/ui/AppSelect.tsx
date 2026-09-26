"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Tone } from "./Button";
import { ChevronDownIcon, CheckIcon, SpinnerIcon } from "./icons";

export interface AppSelectOption<T extends string | number> {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

const toneRing: Record<Tone, string> = {
  admin: "focus-visible:ring-admin/30 focus-visible:border-admin",
  operator: "focus-visible:ring-operator/30 focus-visible:border-operator",
  member: "focus-visible:ring-member/30 focus-visible:border-member",
  neutral: "focus-visible:ring-white/20 focus-visible:border-white/30",
  danger: "focus-visible:ring-danger/30 focus-visible:border-danger",
};

const toneSelectedBg: Record<Tone, string> = {
  admin: "bg-admin-light text-admin",
  operator: "bg-operator-light text-operator",
  member: "bg-member-light text-member",
  neutral: "bg-white/10 text-white",
  danger: "bg-danger-light text-danger",
};

/**
 * The one reusable dropdown/listbox for anywhere a native <select> is too limited (custom
 * per-option rendering, richer empty/loading/error states). For plain single-line option
 * lists, prefer the simpler <Select> in Input.tsx -- both share the same dark visual language.
 */
export function AppSelect<T extends string | number>({
  options,
  value,
  onChange,
  placeholder = "Select…",
  tone = "operator",
  size = "md",
  disabled,
  loading,
  error,
  emptyLabel = "No options available",
  icon,
  className,
  "aria-label": ariaLabel,
}: {
  options: AppSelectOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  placeholder?: string;
  tone?: Tone;
  size?: "sm" | "md";
  disabled?: boolean;
  loading?: boolean;
  error?: string | null;
  emptyLabel?: string;
  icon?: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const selected = options.find((o) => o.value === value) ?? null;
  const isDisabled = disabled || loading || (!loading && options.length === 0);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      const idx = options.findIndex((o) => o.value === value);
      setActiveIndex(idx >= 0 ? idx : 0);
    }
  }, [open, value, options]);

  const moveActive = (delta: number) => {
    setActiveIndex((prev) => {
      let next = prev;
      for (let i = 0; i < options.length; i++) {
        next = (next + delta + options.length) % options.length;
        if (!options[next]?.disabled) return next;
      }
      return prev;
    });
  };

  const commitActive = () => {
    const opt = options[activeIndex];
    if (opt && !opt.disabled) {
      onChange(opt.value);
      setOpen(false);
    }
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (isDisabled) return;
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      commitActive();
    }
  };

  const sizeClass = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2.5 text-sm";

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={isDisabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          "w-full flex items-center gap-2 rounded-lg border bg-white/[0.04] text-left outline-none transition-all cursor-pointer",
          sizeClass,
          error ? "border-danger/50" : "border-white/10",
          "focus-visible:ring-2",
          toneRing[tone],
          isDisabled && "opacity-50 cursor-not-allowed",
        )}
      >
        {icon && <span className="shrink-0 text-slate-400 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
        <span className={cn("flex-1 truncate", selected ? "text-white" : "text-slate-500")}>
          {loading ? "Loading…" : selected ? selected.label : options.length === 0 ? emptyLabel : placeholder}
        </span>
        {loading ? (
          <SpinnerIcon className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-500" />
        ) : (
          <ChevronDownIcon className={cn("h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform", open && "rotate-180")} />
        )}
      </button>

      {error && <p className="mt-1 text-xs text-danger">{error}</p>}

      {open && !isDisabled && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-30 mt-1.5 max-h-64 w-full min-w-[10rem] overflow-y-auto rounded-xl border border-white/10 bg-bg-navy p-1 shadow-soft-lg"
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-500">{emptyLabel}</li>
          ) : (
            options.map((opt, idx) => {
              const isSelected = opt.value === value;
              return (
                <li
                  key={String(opt.value)}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => {
                    if (opt.disabled) return;
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm cursor-pointer transition-colors",
                    opt.disabled && "opacity-40 cursor-not-allowed",
                    idx === activeIndex && !opt.disabled && "bg-white/[0.06]",
                    isSelected && toneSelectedBg[tone],
                  )}
                >
                  {opt.icon && <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4">{opt.icon}</span>}
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{opt.label}</span>
                    {opt.description && <span className="block truncate text-xs text-slate-500">{opt.description}</span>}
                  </span>
                  {isSelected && <CheckIcon className="h-4 w-4 shrink-0" />}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
