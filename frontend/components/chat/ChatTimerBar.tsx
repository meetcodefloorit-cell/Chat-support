"use client";

import { useEffect, useState } from "react";
import { ChatSessionState } from "@/lib/types";
import { ClockIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

function formatMMSS(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** Ticks locally between server syncs by comparing against the server-provided absolute
 * deadline timestamp -- never an independently-running local countdown. The backend is the
 * only thing that ever decides expiry; this is purely a display convenience. */
function useCountdown(deadlineIso: string | null, active: boolean): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !deadlineIso) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active, deadlineIso]);
  if (!deadlineIso) return null;
  return Math.max(0, Math.round((new Date(deadlineIso).getTime() - now) / 1000));
}

export function ChatTimerBar({
  session,
  onCloseChat,
  closing,
}: {
  session: ChatSessionState | null;
  onCloseChat?: () => void;
  closing?: boolean;
}) {
  const isActive = session?.status === "active";
  const chatRemaining = useCountdown(session?.expires_at ?? null, isActive);
  const awaitingFirstResponse = isActive && session?.first_response_at == null;
  const responseRemaining = useCountdown(
    awaitingFirstResponse ? session?.first_response_sla_deadline ?? null : null,
    awaitingFirstResponse,
  );

  if (!session || session.session_id == null) {
    return null;
  }

  if (!isActive) {
    const label =
      session.status === "completed"
        ? "Chat completed"
        : session.status === "auto_closed"
          ? session.thank_you_present === false
            ? "Chat auto-closed — closing message requirement was not met"
            : "Chat auto-closed (3-minute limit reached)"
          : session.status === "abandoned"
            ? "Customer left before this chat was completed"
            : "Chat session ended";
    return (
      <div className="shrink-0 border-b border-white/10 bg-white/[0.02] px-4 py-2 text-xs text-slate-400 flex items-center gap-2">
        <ClockIcon className="h-3.5 w-3.5" />
        {label}
      </div>
    );
  }

  const chatTone = chatRemaining == null ? "normal" : chatRemaining <= 10 ? "urgent" : chatRemaining <= 30 ? "critical" : chatRemaining <= 60 ? "warning" : "normal";
  const respTone = responseRemaining == null ? "normal" : responseRemaining <= 10 ? "critical" : responseRemaining <= 20 ? "warning" : "normal";

  const toneClass: Record<string, string> = {
    normal: "text-slate-300",
    warning: "text-amber-400",
    critical: "text-orange-400",
    urgent: "text-red-400 animate-pulse",
  };

  return (
    <div className="shrink-0 border-b border-white/10 bg-bg-navy px-4 py-2 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-5">
        {awaitingFirstResponse && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">First Response</span>
            <span className={cn("text-sm font-mono font-semibold tabular-nums", toneClass[respTone])}>
              {responseRemaining != null ? formatMMSS(responseRemaining) : "--:--"}
            </span>
          </div>
        )}
        {session.first_response_sla_met === false && (
          <span className="text-[11px] text-red-400 font-medium">Response SLA Missed</span>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Chat Timer</span>
          <span className={cn("text-sm font-mono font-semibold tabular-nums", toneClass[chatTone])}>
            {chatRemaining != null ? formatMMSS(chatRemaining) : "--:--"}
          </span>
          <span className="text-[10px] text-slate-600">/ {formatMMSS(session.max_duration_seconds)}</span>
        </div>
      </div>
      {onCloseChat && (
        <button
          type="button"
          onClick={onCloseChat}
          disabled={closing}
          className="text-xs font-medium text-operator hover:text-white hover:bg-operator/20 rounded-lg px-2.5 py-1.5 transition-colors cursor-pointer disabled:opacity-50"
        >
          {closing ? "Closing…" : "Close Chat"}
        </button>
      )}
    </div>
  );
}
