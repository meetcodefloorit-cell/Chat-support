"use client";

import { ConversationRef } from "@/lib/types";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { InboxIcon } from "@/components/ui/icons";

export function ConversationRefList({ refs, categoryLabel }: { refs: ConversationRef[]; categoryLabel: string }) {
  if (refs.length === 0) {
    return <EmptyState icon={<InboxIcon />} title={`No ${categoryLabel.toLowerCase()} conversations`} compact />;
  }

  return (
    <div className="max-h-72 overflow-y-auto divide-y divide-white/5 rounded-xl border border-white/10">
      {refs.map((ref) => (
        <div key={ref.conversation_id} className="flex items-center gap-3 px-3 py-2.5">
          <Avatar name={ref.member_name} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{ref.member_name}</p>
            <p className="truncate text-xs text-slate-500">
              {ref.project_name} · #{ref.member_uid}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
