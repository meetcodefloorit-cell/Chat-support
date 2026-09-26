"use client";

import { Conversation } from "@/lib/types";
import { DataCard } from "./DataCard";
import { HistoryIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/EmptyState";

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "No messages yet";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function MemberHistory({
  conversations,
  onOpenConversation,
}: {
  conversations: Conversation[];
  onOpenConversation: (conversationId: number) => void;
}) {
  const sorted = [...conversations].sort((a, b) => {
    const at = a.last_message_at || a.created_at || "";
    const bt = b.last_message_at || b.created_at || "";
    return new Date(bt).getTime() - new Date(at).getTime();
  });

  return (
    <div className="min-h-full bg-content-bg px-6 py-6">
      <div className="max-w-[900px] mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-content-text">My History</h1>
          <p className="text-sm text-content-muted mt-0.5">All of your past and ongoing conversations.</p>
        </div>

        <DataCard bodyClassName="p-0">
          {sorted.length === 0 ? (
            <EmptyState icon={<HistoryIcon />} title="No conversation history yet" compact />
          ) : (
            <div className="divide-y divide-content-border">
              {sorted.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onOpenConversation(c.id)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-content-bg transition-colors cursor-pointer"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-content-text truncate">
                      {c.type === "admin_operator" ? "Support Team" : "Operator Support"}
                    </p>
                    <p className="text-xs text-content-muted">{formatWhen(c.last_message_at || c.created_at)}</p>
                  </div>
                  {(c.unread_count || 0) > 0 && (
                    <span className="shrink-0 rounded-full bg-badge-purple-bg text-badge-purple-fg text-xs font-semibold px-2 py-0.5">
                      {c.unread_count} new
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </DataCard>
      </div>
    </div>
  );
}
