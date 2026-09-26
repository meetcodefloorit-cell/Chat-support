"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from "@/lib/api";
import { cn } from "@/lib/cn";
import { BellIcon, CloseIcon, SpinnerIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";

function safeDate(iso: string): Date | null {
  try {
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

function formatRelative(iso: string): string {
  const d = safeDate(iso);
  if (!d) return iso;
  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSec < 10) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString();
}

function kindLabel(kind: string): string {
  const k = kind.toLowerCase();
  if (k === "new_message") return "Message";
  if (k === "admin_broadcast") return "Announcement";
  if (k === "assignment") return "Assignment";
  if (k === "removal") return "Removed";
  return "Notification";
}

export function NotificationBell(props: {
  token: string;
  projectId: number;
  className?: string;
  onNotificationClick?: (referenceId: number | null) => void;
  /** Parent increments on each realtime message event to refresh unread count without waiting for poll. */
  wsMessageKey?: number;
}) {
  const { token, projectId, className, onNotificationClick, wsMessageKey } = props;

  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const badge = useMemo(() => (unread > 99 ? "99+" : String(unread)), [unread]);

  async function refreshCount() {
    const res = await getUnreadNotificationCount(token, projectId);
    if (!mounted.current) return;
    setUnread(res.count || 0);
  }

  async function loadList() {
    setLoading(true);
    setError(null);
    try {
      const list = await getNotifications(token, projectId, { limit: 30, offset: 0 });
      if (!mounted.current) return;
      setItems(list);
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : "Failed to load notifications");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }

  async function openPanel() {
    setOpen((v) => !v);
  }

  async function markAllRead() {
    try {
      await markNotificationsRead(token, projectId);
      const now = new Date().toISOString();
      setItems((prev) => (prev ? prev.map((n) => ({ ...n, read_at: now })) : null));
      setUnread(0);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mark read");
    }
  }

  async function markOneRead(id: number) {
    try {
      await markNotificationRead(token, projectId, id);
      const now = new Date().toISOString();
      setItems((prev) =>
        prev ? prev.map((n) => (n.id === id ? { ...n, read_at: now } : n)) : null,
      );
      setUnread((u) => Math.max(0, u - 1));
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mark read");
    }
  }

  useEffect(() => {
    if (!token || !projectId) return;
    refreshCount().catch(() => {});
    const t = setInterval(() => refreshCount().catch(() => {}), 30000);
    return () => clearInterval(t);
  }, [token, projectId]);

  useEffect(() => {
    if (wsMessageKey === undefined || wsMessageKey === 0) return;
    refreshCount().catch(() => {});
  }, [wsMessageKey, token, projectId]);

  useEffect(() => {
    if (!open) return;
    refreshCount().catch(() => {});
    loadList().catch(() => {});
  }, [open, token, projectId]);

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => openPanel().catch(() => {})}
        className="relative inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        aria-label="Notifications"
      >
        <BellIcon className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-[18px] text-white">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-50 mt-2 w-[min(400px,92vw)] max-w-[92vw] overflow-hidden rounded-xl border border-white/10 bg-bg-navy-elevated/95 backdrop-blur-xl shadow-soft-lg animate-scale-in">
            <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3.5 py-2.5">
              <div className="text-sm font-semibold text-white">Notifications</div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => markAllRead().catch(() => {})}
                  className="rounded-md px-2 py-1 text-xs font-medium text-slate-400 hover:bg-white/10 hover:text-white cursor-pointer"
                >
                  Mark all read
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1 text-slate-500 hover:bg-white/10 hover:text-slate-200 cursor-pointer"
                  aria-label="Close notifications"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="max-h-[420px] overflow-auto">
              {loading && (
                <div className="flex items-center gap-2 px-3.5 py-6 text-sm text-slate-500">
                  <SpinnerIcon className="h-4 w-4 animate-spin" /> Loading…
                </div>
              )}
              {!loading && error && (
                <div className="px-3.5 py-4 text-sm text-danger">{error}</div>
              )}
              {!loading && !error && (!items || items.length === 0) && (
                <EmptyState
                  compact
                  icon={<BellIcon />}
                  title="No notifications yet"
                  description="You'll see new messages and updates here."
                />
              )}
              {!loading &&
                !error &&
                items?.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      if (!n.read_at) {
                        markOneRead(n.id).catch(() => {});
                      }
                      if (onNotificationClick) {
                        onNotificationClick(n.reference_id);
                        setOpen(false);
                      }
                    }}
                    className="w-full text-left border-b border-white/5 px-3.5 py-3 transition-colors hover:bg-white/5 cursor-pointer last:border-b-0"
                    title={n.read_at ? "Read" : "Mark as read"}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-start gap-2">
                          {!n.read_at && (
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-operator" />
                          )}
                          <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-left text-sm font-medium text-white">
                            {n.title || "Notification"}
                          </div>
                        </div>
                        <div className="mt-1 flex items-center gap-2 pl-3.5 text-xs text-slate-500">
                          <Badge color="gray" className="px-1.5 py-0.5 text-[10px]">
                            {kindLabel(n.kind)}
                          </Badge>
                          <span className="truncate">{formatRelative(n.created_at)}</span>
                        </div>
                      </div>
                      <div className="shrink-0 text-[11px] text-slate-500">
                        {safeDate(n.created_at)?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) || ""}
                      </div>
                    </div>
                  </button>
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
