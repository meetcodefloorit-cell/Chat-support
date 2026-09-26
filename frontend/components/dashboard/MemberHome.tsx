"use client";

import { Conversation, Project, User } from "@/lib/types";
import { DataCard } from "./DataCard";
import { ChatBubbleIcon, ClockIcon, HeadsetIcon, HistoryIcon } from "@/components/ui/icons";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function MemberHome({
  currentUser,
  project,
  myOperator,
  conversations,
  onStartConversation,
  onOpenConversation,
  onGoToHistory,
}: {
  currentUser: User;
  project: Project | null;
  myOperator: User | null;
  conversations: Conversation[];
  onStartConversation: () => void;
  onOpenConversation: (conversationId: number) => void;
  onGoToHistory: () => void;
}) {
  const recent = [...conversations]
    .filter((c) => c.last_message_at)
    .sort((a, b) => new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime())
    .slice(0, 5);

  return (
    <div className="min-h-full bg-content-bg px-6 py-6">
      <div className="max-w-[1100px] mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-content-text">
            {greeting()}, {currentUser.name}
          </h1>
          <p className="text-sm text-content-muted mt-0.5">
            We&apos;re here to help. Feel free to reach out with any questions or support requests.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <DataCard className="lg:col-span-2" bodyClassName="p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-badge-purple-bg text-badge-purple-fg">
                <ChatBubbleIcon className="h-5 w-5" />
              </div>
              <h2 className="text-base font-semibold text-content-text">Start a Conversation</h2>
            </div>
            <p className="text-sm text-content-muted mb-4">
              {myOperator ? `Our support team is available to assist you.` : "You'll be connected with a support operator shortly."}
            </p>
            <button
              type="button"
              onClick={onStartConversation}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-member to-member-dark px-4 py-2.5 text-sm font-medium text-white shadow-content hover:brightness-110 transition cursor-pointer"
            >
              Chat Now
              <span aria-hidden="true">→</span>
            </button>
          </DataCard>

          <DataCard bodyClassName="p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-badge-blue-bg text-badge-blue-fg">
                <ClockIcon className="h-5 w-5" />
              </div>
              <h2 className="text-sm font-semibold text-content-text">Support Hours</h2>
            </div>
            <p className="text-lg font-semibold text-content-text">24/7</p>
            <p className="text-xs text-content-muted mt-1">We&apos;re always here for you.</p>
            {(project?.support_email || project?.support_phone) && (
              <div className="mt-3 pt-3 border-t border-content-border space-y-1 text-xs text-content-muted">
                {project?.support_email && <p>{project.support_email}</p>}
                {project?.support_phone && <p>{project.support_phone}</p>}
              </div>
            )}
          </DataCard>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <DataCard title="Recent Conversations" className="lg:col-span-2" bodyClassName="p-0">
            {recent.length === 0 ? (
              <div className="p-5 text-sm text-content-muted">No conversations yet.</div>
            ) : (
              <div className="divide-y divide-content-border">
                {recent.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onOpenConversation(c.id)}
                    className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-content-bg transition-colors cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-content-text truncate">
                        {c.type === "admin_operator" ? "Support Team" : "Operator Support"}
                      </p>
                      <p className="text-xs text-content-muted">{formatWhen(c.last_message_at)}</p>
                    </div>
                    {(c.unread_count || 0) > 0 && (
                      <span className="shrink-0 rounded-full bg-badge-purple-bg text-badge-purple-fg text-xs font-semibold px-2 py-0.5">
                        {c.unread_count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </DataCard>

          <DataCard bodyClassName="p-6 flex flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-badge-indigo-bg text-badge-indigo-fg mb-3">
              <HeadsetIcon className="h-6 w-6" />
            </div>
            <h2 className="text-sm font-semibold text-content-text">Need Help?</h2>
            <p className="text-xs text-content-muted mt-1 mb-4">Our team is ready to assist you with any questions or issues.</p>
            <button
              type="button"
              onClick={onStartConversation}
              className="w-full rounded-xl bg-gradient-to-r from-member to-member-dark px-4 py-2.5 text-sm font-medium text-white shadow-content hover:brightness-110 transition cursor-pointer"
            >
              Start Chat
            </button>
            <button
              type="button"
              onClick={onGoToHistory}
              className="mt-2 w-full flex items-center justify-center gap-1.5 rounded-xl border border-content-border px-4 py-2.5 text-sm font-medium text-content-text hover:bg-content-bg transition cursor-pointer"
            >
              <HistoryIcon className="h-4 w-4" />
              My History
            </button>
          </DataCard>
        </div>
      </div>
    </div>
  );
}
