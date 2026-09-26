"use client";

import { useEffect, useState } from "react";
import { getChatHistory, getChatHistoryDetail } from "@/lib/api";
import { ChatHistoryRow, ChatSessionDetail, Project, User } from "@/lib/types";
import { Card, CardBody } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchInput } from "@/components/ui/SearchInput";
import { LoadingState, SkeletonRow } from "@/components/ui/Skeleton";
import { AppSelect } from "@/components/ui/AppSelect";
import { DateRangeFilter, DateRangeValue, computePreset } from "./DateRangeFilter";
import { formatDateTime, formatDuration } from "./format";
import { ChartBarIcon, ChatBubbleIcon, FolderIcon, HeadsetIcon, UsersIcon } from "@/components/ui/icons";

const ALL_VALUE = -1;

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "auto_closed", label: "Expired (Auto-Closed)" },
  { value: "abandoned", label: "Abandoned" },
];

export function ChatHistoryPage({
  token,
  projects,
  operators,
  members,
}: {
  token: string;
  projects: Project[];
  operators: User[];
  members: User[];
}) {
  const [range, setRange] = useState<DateRangeValue>(() => computePreset("last30"));
  const [projectId, setProjectId] = useState<number | null>(null);
  const [operatorId, setOperatorId] = useState<number | null>(null);
  const [memberId, setMemberId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const [rows, setRows] = useState<ChatHistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ChatSessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
      setOffset(0);
    }, 350);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getChatHistory(token, {
      projectId,
      operatorId,
      memberId,
      status: statusFilter,
      startDate: range.startDate,
      endDate: range.endDate,
      search: search || null,
      limit,
      offset,
    })
      .then((res) => {
        if (!cancelled) {
          setRows(res.items);
          setTotal(res.total);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load chat history");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, projectId, operatorId, memberId, statusFilter, range.startDate, range.endDate, search, offset]);

  useEffect(() => {
    if (detailId == null) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    getChatHistoryDetail(token, detailId)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, detailId]);

  const resetFilters = () => {
    setProjectId(null);
    setOperatorId(null);
    setMemberId(null);
    setStatusFilter(null);
    setSearchInput("");
    setSearch("");
    setRange(computePreset("last30"));
    setOffset(0);
  };

  const activeProjects = projects.filter((p) => p.is_active);
  const page = Math.floor(offset / limit) + 1;
  const pageCount = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader title="Chat History" description="Every chat session, with real start/response/close timestamps from the server." />

      <Card>
        <CardBody className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <AppSelect
              aria-label="Filter by project"
              tone="admin"
              size="sm"
              icon={<FolderIcon />}
              value={projectId ?? ALL_VALUE}
              onChange={(v) => {
                setProjectId(v === ALL_VALUE ? null : v);
                setOffset(0);
              }}
              options={[{ value: ALL_VALUE, label: "All Projects" }, ...activeProjects.map((p) => ({ value: p.id, label: p.name }))]}
            />
            <AppSelect
              aria-label="Filter by operator"
              tone="admin"
              size="sm"
              icon={<HeadsetIcon />}
              value={operatorId ?? ALL_VALUE}
              onChange={(v) => {
                setOperatorId(v === ALL_VALUE ? null : v);
                setOffset(0);
              }}
              options={[{ value: ALL_VALUE, label: "All Operators" }, ...operators.map((o) => ({ value: o.id, label: o.name }))]}
            />
            <AppSelect
              aria-label="Filter by customer"
              tone="admin"
              size="sm"
              icon={<UsersIcon />}
              value={memberId ?? ALL_VALUE}
              onChange={(v) => {
                setMemberId(v === ALL_VALUE ? null : v);
                setOffset(0);
              }}
              options={[{ value: ALL_VALUE, label: "All Customers" }, ...members.map((m) => ({ value: m.id, label: m.name }))]}
            />
            <AppSelect
              aria-label="Filter by status"
              tone="admin"
              size="sm"
              icon={<ChatBubbleIcon />}
              value={statusFilter ?? "all"}
              onChange={(v) => {
                setStatusFilter(v === "all" ? null : String(v));
                setOffset(0);
              }}
              options={[{ value: "all", label: "All Statuses" }, ...STATUS_OPTIONS]}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SearchInput
              tone="admin"
              placeholder="Search customer or operator…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full sm:w-72"
            />
            <div className="flex flex-wrap items-center gap-2">
              <DateRangeFilter value={range} onChange={(v) => { setRange(v); setOffset(0); }} tone="admin" />
              <Button variant="outline" tone="neutral" size="sm" onClick={resetFilters}>
                Reset Filters
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {error && (
        <Card className="border-danger/30 bg-danger-light">
          <CardBody className="text-sm text-red-300">{error}</CardBody>
        </Card>
      )}

      <Card>
        {loading ? (
          <div className="p-2">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<ChartBarIcon />} title="No chats match these filters" description="Try widening the date range or clearing a filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  <th className="px-4 py-2.5 font-medium">Operator</th>
                  <th className="px-4 py-2.5 font-medium">Project</th>
                  <th className="px-4 py-2.5 font-medium">Started</th>
                  <th className="px-4 py-2.5 font-medium">Assigned</th>
                  <th className="px-4 py-2.5 font-medium">First Response</th>
                  <th className="px-4 py-2.5 font-medium">Closed</th>
                  <th className="px-4 py-2.5 font-medium">Duration</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.map((r) => (
                  <tr
                    key={r.session_id}
                    className="cursor-pointer text-slate-200 hover:bg-white/[0.03]"
                    onClick={() => setDetailId(r.session_id)}
                  >
                    <td className="px-4 py-2.5 whitespace-nowrap">{r.member_name}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{r.operator_name}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-400">{r.project_name}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{formatDateTime(r.started_at)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-400">{formatDateTime(r.assigned_at)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{formatDateTime(r.first_response_at)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{formatDateTime(r.closed_at)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">{formatDuration(r.duration_seconds)}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!loading && total > 0 && (
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>
            Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" tone="neutral" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
              Previous
            </Button>
            <span>
              Page {page} / {pageCount}
            </span>
            <Button
              variant="outline"
              tone="neutral"
              size="sm"
              disabled={offset + limit >= total}
              onClick={() => setOffset(offset + limit)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <Modal open={detailId != null} onClose={() => setDetailId(null)} size="xl" title={detail ? `${detail.member_name} × ${detail.operator_name}` : "Chat Detail"}>
        {detailLoading || !detail ? (
          <LoadingState label="Loading chat…" />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <Field label="Customer" value={`${detail.member_name} (${detail.member_uid})`} />
              <Field label="Operator" value={`${detail.operator_name} (${detail.operator_uid})`} />
              <Field label="Project" value={detail.project_name} />
              <Field label="Started" value={formatDateTime(detail.started_at)} />
              <Field label="Assigned" value={formatDateTime(detail.assigned_at)} />
              <Field label="First Response" value={formatDateTime(detail.first_response_at)} />
              <Field label="Closed" value={formatDateTime(detail.closed_at)} />
              <Field label="Duration" value={formatDuration(detail.duration_seconds)} />
              <Field label="Status" value={<StatusBadge status={detail.status} />} />
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Messages</h3>
              <div className="max-h-64 overflow-y-auto rounded-xl border border-white/10 divide-y divide-white/5">
                {detail.messages.length === 0 ? (
                  <p className="p-4 text-sm text-slate-500">No messages in this session.</p>
                ) : (
                  detail.messages.map((m) => (
                    <div key={m.id} className="p-3 text-sm">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>{m.sender_role === "OPERATOR" ? detail.operator_name : detail.member_name}</span>
                        <span>{formatDateTime(m.created_at)}</span>
                      </div>
                      <p className="mt-1 text-slate-200 break-words">{m.content}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">System Events</h3>
              <div className="space-y-1.5">
                {detail.events.map((e, i) => (
                  <div key={i} className="flex items-center justify-between text-xs text-slate-400">
                    <span className="text-slate-300">{e.event_type.replace(/_/g, " ")}</span>
                    <span>{formatDateTime(e.occurred_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-slate-200">{value}</p>
    </div>
  );
}
