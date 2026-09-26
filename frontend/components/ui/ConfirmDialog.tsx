"use client";

import { createContext, useCallback, useContext, useRef, useState, ReactNode } from "react";
import { Modal } from "./Modal";
import { Button, Tone } from "./Button";

export interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: Tone;
}

type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Renders one global confirmation dialog and exposes `confirm()` via context, replacing
 * window.confirm() with a styled modal while preserving the same "await the user's choice
 * before continuing" control flow at every call site.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    const normalized = typeof opts === "string" ? { message: opts } : opts;
    setOptions(normalized);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = (result: boolean) => {
    setOptions(null);
    resolverRef.current?.(result);
    resolverRef.current = null;
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal open={options !== null} onClose={() => settle(false)} title={options?.title ?? "Please confirm"} size="sm">
        <p className="text-sm text-slate-300">{options?.message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" tone="neutral" onClick={() => settle(false)}>
            {options?.cancelText ?? "Cancel"}
          </Button>
          <Button tone={options?.tone ?? "danger"} onClick={() => settle(true)}>
            {options?.confirmText ?? "Confirm"}
          </Button>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm() must be used within a <ConfirmProvider>");
  return ctx;
}
