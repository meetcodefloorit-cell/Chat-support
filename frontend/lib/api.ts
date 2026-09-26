import {
  AdminOverview,
  ChatHistoryPage,
  ChatSessionDetail,
  ChatSessionState,
  Conversation,
  Message,
  MemberAnalytics,
  OperatorAnalytics,
  OperatorSummaryRow,
  Presence,
  PresenceAnalytics,
  PresenceHistoryEvent,
  Project,
  ProjectAnalytics,
  TokenResponse,
  User,
  UserRole,
  Workload,
} from "@/lib/types";
import { clearSession, getUser, getLoginPath } from "@/lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "/api";

function handle401(): void {
  const user = getUser();
  clearSession();
  if (typeof window !== "undefined") {
    window.location.href = getLoginPath(user?.role);
  }
}

function looksLikeHtml(payload: string): boolean {
  const sample = payload.trim().slice(0, 256).toLowerCase();
  return sample.startsWith("<!doctype html") || sample.startsWith("<html") || sample.includes("<body");
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  // Only treat 401 as "session expired" when we sent a bearer token (authenticated request).
  // Login/register failures are also 401 but must show the API error, not redirect.
  if (response.status === 401 && token) {
    handle401();
    throw new Error("Session expired. Please log in again.");
  }

  if (response.status === 429) {
    throw new Error(
      path.startsWith("/auth/login")
        ? "Too many login attempts. Please wait a minute and try again."
        : "Too many requests. Please slow down and try again.",
    );
  }

  if (!response.ok) {
    const text = await response.text();
    let detail = text || `Request failed: ${response.status}`;
    try {
      const j = JSON.parse(text) as { detail?: unknown };
      if (typeof j.detail === "string") detail = j.detail;
      else if (Array.isArray(j.detail)) detail = JSON.stringify(j.detail);
    } catch {
      /* use raw text */
    }
    if (looksLikeHtml(detail)) {
      if (response.status === 504) {
        detail = "Server timeout (504). Please retry in a few seconds.";
      } else if (response.status === 502 || response.status === 503) {
        detail = "Server is temporarily unavailable. Please retry.";
      } else {
        detail = `Request failed: ${response.status}`;
      }
    }
    throw new Error(detail);
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json() as Promise<T>;
}

/** Login with email (admin) or email / numeric access ID (operator/member). */
export function login(identifier: string, password: string): Promise<TokenResponse> {
  return request<TokenResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier: identifier.trim(), password }),
  });
}

export function createUser(
  token: string,
  payload: { email: string; name: string; password: string; role: UserRole },
): Promise<User> {
  return request<User>("/admin/users", { method: "POST", body: JSON.stringify(payload) }, token);
}

export function getMe(token: string): Promise<User> {
  return request<User>("/me", {}, token);
}

export function getProjectStatus(token: string, projectId: number): Promise<{ status: string }> {
  return request<{ status: string }>(`/auth/me/status/${projectId}`, {}, token);
}

export function getUsersByRole(token: string, role: UserRole): Promise<User[]> {
  return request<User[]>(`/users?role=${role}`, {}, token);
}

export function getProjects(token: string): Promise<Project[]> {
  return request<Project[]>("/projects", {}, token);
}

export function createProject(
  token: string,
  payload: {
    name: string;
    logo_url?: string | null;
    operator_terminated_message?: string | null;
    support_email?: string | null;
    support_phone?: string | null;
  },
): Promise<Project> {
  return request<Project>("/projects", { method: "POST", body: JSON.stringify(payload) }, token);
}

export function updateProject(
  token: string,
  projectId: number,
  payload: {
    name?: string;
    logo_url?: string | null;
    operator_terminated_message?: string | null;
    support_email?: string | null;
    support_phone?: string | null;
  },
): Promise<Project> {
  return request<Project>(`/projects/${projectId}`, { method: "PATCH", body: JSON.stringify(payload) }, token);
}

export function deactivateProject(token: string, projectId: number): Promise<Project> {
  return request<Project>(`/projects/${projectId}/deactivate`, { method: "PATCH" }, token);
}

export function activateProject(token: string, projectId: number): Promise<Project> {
  return request<Project>(`/projects/${projectId}/activate`, { method: "PATCH" }, token);
}

export function deleteProject(token: string, projectId: number): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/projects/${projectId}`, { method: "DELETE" }, token);
}

export function permanentlyDeleteProject(token: string, projectId: number): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/projects/${projectId}/permanent`, { method: "DELETE" }, token);
}

export async function uploadProjectLogo(
  token: string,
  projectId: number,
  file: File,
): Promise<{ logo_url: string; detail: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${API_BASE}/projects/${projectId}/logo`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (response.status === 401) {
    handle401();
    throw new Error("Session expired. Please log in again.");
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Upload failed: ${response.status}`);
  }
  return response.json();
}

export function deleteProjectLogo(token: string, projectId: number): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/projects/${projectId}/logo`, { method: "DELETE" }, token);
}

export function getOperators(token: string, projectId: number): Promise<User[]> {
  return request<User[]>(`/projects/${projectId}/operators`, {}, token);
}

export function getOperatorsWithStatus(token: string, projectId: number): Promise<User[]> {
  return request<User[]>(`/projects/${projectId}/operators-with-status`, {}, token);
}

/** Admin: operators for assign dropdown (excludes already assigned & removed-from-project). */
export function getOperatorAssignOptions(
  token: string,
  projectId: number,
): Promise<{ assignable: User[] }> {
  return request(`/projects/${projectId}/operators/assign-options`, {}, token);
}

export function getMembers(
  token: string,
  projectId: number,
  forAssign?: boolean,
): Promise<User[]> {
  const params = forAssign ? "?for_assign=true" : "";
  return request<User[]>(`/projects/${projectId}/members${params}`, {}, token);
}

/** Admin: list all members in the project with their assigned operator name/uid. */
export function getMembersWithOperators(
  token: string,
  projectId: number,
): Promise<
  (User & {
    assigned_operator_id: number | null;
    assigned_operator_name: string | null;
    assigned_operator_uid: string | null;
    membership_status?: string | null;
  })[]
> {
  return request(`/projects/${projectId}/members-with-operators`, {}, token);
}

/** Member: get my assigned operator in this project. */
export function getMyOperator(token: string, projectId: number): Promise<User | null> {
  return request<User | null>(`/projects/${projectId}/my-operator`, {}, token);
}

export function getPresence(token: string, projectId: number): Promise<Presence[]> {
  return request<Presence[]>(`/projects/${projectId}/presence`, {}, token);
}

export interface NotificationItem {
  id: number;
  project_id: number;
  user_id: number;
  kind: string;
  reference_id: number | null;
  title: string;
  read_at: string | null;
  created_at: string;
}

export function getNotifications(
  token: string,
  projectId: number,
  params?: { limit?: number; offset?: number; unread_only?: boolean },
): Promise<NotificationItem[]> {
  const search = new URLSearchParams();
  if (params?.limit != null) search.set("limit", String(params.limit));
  if (params?.offset != null) search.set("offset", String(params.offset));
  if (params?.unread_only) search.set("unread_only", "true");
  const q = search.toString();
  return request<NotificationItem[]>(`/projects/${projectId}/notifications${q ? `?${q}` : ""}`, {}, token);
}

export function getUnreadNotificationCount(token: string, projectId: number): Promise<{ count: number }> {
  return request<{ count: number }>(`/projects/${projectId}/notifications/unread-count`, {}, token);
}

export function markNotificationsRead(token: string, projectId: number): Promise<{ marked: number }> {
  return request<{ marked: number }>(`/projects/${projectId}/notifications/read`, { method: "PATCH" }, token);
}

export function markNotificationRead(
  token: string,
  projectId: number,
  notificationId: number,
): Promise<{ marked: number }> {
  return request<{ marked: number }>(
    `/projects/${projectId}/notifications/${notificationId}/read`,
    { method: "PATCH" },
    token,
  );
}

export function assignOperator(token: string, projectId: number, operatorId: number): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/projects/${projectId}/operators/${operatorId}/assign`, { method: "POST" }, token);
}

export function removeOperator(token: string, projectId: number, operatorId: number): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/projects/${projectId}/operators/${operatorId}/remove`, { method: "DELETE" }, token);
}


export function terminateUser(token: string, projectId: number, userId: number): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/projects/${projectId}/users/${userId}/terminate`, { method: "DELETE" }, token);
}

export function deactivateUserGlobally(token: string, userId: number): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/admin/users/${userId}/deactivate`, { method: "DELETE" }, token);
}

export function deactivateUsersGloballyBulk(token: string, userIds: number[]): Promise<{ detail: string }> {
  return request<{ detail: string }>(
    "/admin/users/deactivate/bulk",
    { method: "POST", body: JSON.stringify({ user_ids: userIds }) },
    token,
  );
}

export function permanentlyDeleteUser(token: string, userId: number): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/admin/users/${userId}/permanent`, { method: "DELETE" }, token);
}

export function permanentlyDeleteUsersBulk(token: string, userIds: number[]): Promise<{ detail: string }> {
  return request<{ detail: string }>(
    "/admin/users/permanent-delete/bulk",
    { method: "POST", body: JSON.stringify({ user_ids: userIds }) },
    token,
  );
}

export function changeUserPassword(
  token: string,
  userId: number,
  newPassword: string,
): Promise<{ detail: string }> {
  return request<{ detail: string }>(
    `/admin/users/${userId}/password`,
    { method: "PATCH", body: JSON.stringify({ new_password: newPassword }) },
    token,
  );
}

export function changeMyPassword(
  token: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ detail: string }> {
  return request<{ detail: string }>(
    "/me/password",
    { method: "PATCH", body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) },
    token,
  );
}

export function resetAdminPassword(
  token: string,
  userId: number,
  newPassword: string,
): Promise<{ detail: string }> {
  return request<{ detail: string }>(
    `/admin/admins/${userId}/password`,
    { method: "PATCH", body: JSON.stringify({ new_password: newPassword }) },
    token,
  );
}

export function createMember(
  token: string,
  projectId: number,
  payload: { email: string; name: string; password: string },
): Promise<User> {
  return request<User>(`/projects/${projectId}/members`, { method: "POST", body: JSON.stringify(payload) }, token);
}

export function adminCreateMember(
  token: string,
  projectId: number,
  payload: { operator_id: number; email: string; name: string; password: string },
): Promise<User> {
  return request<User>(
    `/projects/${projectId}/admin/members`,
    { method: "POST", body: JSON.stringify(payload) },
    token,
  );
}

export function adminAssignMemberOperator(
  token: string,
  projectId: number,
  memberId: number,
  operatorId: number,
): Promise<{ detail: string }> {
  return request<{ detail: string }>(
    `/projects/${projectId}/members/${memberId}/assign-operator`,
    { method: "POST", body: JSON.stringify({ operator_id: operatorId }) },
    token,
  );
}

export function assignMember(token: string, projectId: number, memberId: number): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/projects/${projectId}/members/${memberId}/assign`, { method: "POST" }, token);
}

export function removeMember(token: string, projectId: number, memberId: number): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/projects/${projectId}/members/${memberId}/remove`, { method: "DELETE" }, token);
}

export function broadcastMembers(
  token: string,
  projectId: number,
  payload: {
    member_ids?: number[];
    all_members?: boolean;
    operator_ids?: number[];
    all_operators?: boolean;
    content: string;
    delivery_method?: "chat" | "notification";
  },
): Promise<{ detail: string; messages_created: number }> {
  return request<{ detail: string; messages_created: number }>(
    `/projects/${projectId}/members/broadcast`,
    { method: "POST", body: JSON.stringify(payload) },
    token,
  );
}

export function getConversations(
  token: string,
  projectId: number,
  filters?: { operator_id?: number; member_id?: number; type?: string },
): Promise<Conversation[]> {
  const params = new URLSearchParams();
  if (filters?.operator_id != null) params.set("operator_id", String(filters.operator_id));
  if (filters?.member_id != null) params.set("member_id", String(filters.member_id));
  if (filters?.type != null && filters.type !== "") params.set("type", filters.type);
  const q = params.toString();
  return request<Conversation[]>(`/projects/${projectId}/conversations${q ? `?${q}` : ""}`, {}, token);
}

export function deleteConversation(
  token: string,
  projectId: number,
  conversationId: number,
  scope: "me" | "all" = "all",
): Promise<{ detail: string }> {
  return request<{ detail: string }>(
    `/projects/${projectId}/conversations/${conversationId}?scope=${scope}`,
    { method: "DELETE" },
    token,
  );
}

export function clearConversationsBulk(
  token: string,
  projectId: number,
  conversationIds: number[],
): Promise<{ detail: string }> {
  return request<{ detail: string }>(
    `/projects/${projectId}/conversations/clear/bulk`,
    { method: "POST", body: JSON.stringify({ conversation_ids: conversationIds }) },
    token,
  );
}

export function hideConversationsBulk(
  token: string,
  projectId: number,
  conversationIds: number[],
): Promise<{ detail: string }> {
  return request<{ detail: string }>(
    `/projects/${projectId}/conversations/hide/bulk`,
    { method: "POST", body: JSON.stringify({ conversation_ids: conversationIds }) },
    token,
  );
}

export function createGroup(
  token: string,
  projectId: number,
  payload: { name: string; participant_ids: number[] },
): Promise<Conversation> {
  return request<Conversation>(`/projects/${projectId}/conversations/group`, {
    method: "POST",
    body: JSON.stringify(payload),
  }, token);
}

export function searchMessages(
  token: string,
  projectId: number,
  q: string,
): Promise<Message[]> {
  return request<Message[]>(`/projects/${projectId}/messages/search?q=${encodeURIComponent(q)}`, {}, token);
}

export async function uploadAttachment(
  token: string,
  projectId: number,
  conversationId: number,
  file: File,
): Promise<Message> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_BASE || "/api"}/projects/${projectId}/conversations/${conversationId}/attachments`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    },
  );
  if (response.status === 401) {
    handle401();
    throw new Error("Session expired");
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Upload failed: ${response.status}`);
  }
  return response.json();
}

export function getMessages(
  token: string,
  projectId: number,
  conversationId: number,
  limit?: number,
  offset?: number,
): Promise<Message[]> {
  const params = new URLSearchParams();
  if (limit != null) params.set("limit", String(limit));
  if (offset != null) params.set("offset", String(offset));
  const q = params.toString();
  return request<Message[]>(
    `/projects/${projectId}/conversations/${conversationId}/messages${q ? `?${q}` : ""}`,
    {},
    token,
  );
}

export async function fetchAttachment(
  token: string,
  url: string,
): Promise<string> {
  const base = process.env.NEXT_PUBLIC_API_BASE || "/api";
  const path = url.startsWith("/") ? url : `/${url}`;
  const fullUrl = url.startsWith("http") ? url : `${base.replace(/\/$/, "")}${path}`;
  const response = await fetch(fullUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) {
    handle401();
    throw new Error("Session expired");
  }
  if (!response.ok) throw new Error(`Failed to load attachment: ${response.status}`);
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export function postMessage(
  token: string,
  projectId: number,
  conversationId: number,
  content: string,
): Promise<Message> {
  return request<Message>(
    `/projects/${projectId}/conversations/${conversationId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ content }),
    },
    token,
  );
}

// ---- Analytics ----

export interface AnalyticsQuery {
  projectId?: number | null;
  startDate?: string | null; // ISO datetime
  endDate?: string | null; // ISO datetime
  granularity?: "hour" | "day" | "week" | null;
}

function analyticsQueryString(query: AnalyticsQuery): string {
  const params = new URLSearchParams();
  if (query.projectId != null) params.set("project_id", String(query.projectId));
  if (query.startDate) params.set("start_date", query.startDate);
  if (query.endDate) params.set("end_date", query.endDate);
  if (query.granularity) params.set("granularity", query.granularity);
  const q = params.toString();
  return q ? `?${q}` : "";
}

export function getMyOperatorAnalytics(token: string, query: AnalyticsQuery = {}): Promise<OperatorAnalytics> {
  return request<OperatorAnalytics>(`/analytics/operator/me${analyticsQueryString(query)}`, {}, token);
}

export function getOperatorAnalytics(
  token: string,
  operatorId: number,
  query: AnalyticsQuery = {},
): Promise<OperatorAnalytics> {
  return request<OperatorAnalytics>(`/analytics/operator/${operatorId}${analyticsQueryString(query)}`, {}, token);
}

export function getOperatorsAnalytics(token: string, query: AnalyticsQuery = {}): Promise<OperatorSummaryRow[]> {
  return request<OperatorSummaryRow[]>(`/analytics/operators${analyticsQueryString(query)}`, {}, token);
}

export function getAnalyticsOverview(token: string, query: AnalyticsQuery = {}): Promise<AdminOverview> {
  return request<AdminOverview>(`/analytics/overview${analyticsQueryString(query)}`, {}, token);
}

export function getProjectAnalytics(
  token: string,
  projectId: number,
  query: AnalyticsQuery = {},
): Promise<ProjectAnalytics> {
  return request<ProjectAnalytics>(`/analytics/projects/${projectId}${analyticsQueryString(query)}`, {}, token);
}

export function getWorkload(token: string, projectId?: number | null): Promise<Workload> {
  return request<Workload>(`/analytics/workload${analyticsQueryString({ projectId })}`, {}, token);
}

export function getMemberAnalytics(
  token: string,
  memberId: number,
  query: AnalyticsQuery = {},
): Promise<MemberAnalytics> {
  return request<MemberAnalytics>(`/analytics/member/${memberId}${analyticsQueryString(query)}`, {}, token);
}

export function getOperatorPresenceHistory(
  token: string,
  operatorId: number,
  query: AnalyticsQuery = {},
): Promise<PresenceHistoryEvent[]> {
  return request<PresenceHistoryEvent[]>(
    `/analytics/operator/${operatorId}/presence-history${analyticsQueryString(query)}`,
    {},
    token,
  );
}

export function getOperatorPresenceAnalytics(
  token: string,
  operatorId: number,
  query: AnalyticsQuery = {},
): Promise<PresenceAnalytics> {
  return request<PresenceAnalytics>(
    `/analytics/operator/${operatorId}/presence-analytics${analyticsQueryString(query)}`,
    {},
    token,
  );
}

// ---- Chat History report ----

export interface ChatHistoryQuery {
  projectId?: number | null;
  operatorId?: number | null;
  memberId?: number | null;
  status?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export function getChatHistory(token: string, query: ChatHistoryQuery = {}): Promise<ChatHistoryPage> {
  const params = new URLSearchParams();
  if (query.projectId != null) params.set("project_id", String(query.projectId));
  if (query.operatorId != null) params.set("operator_id", String(query.operatorId));
  if (query.memberId != null) params.set("member_id", String(query.memberId));
  if (query.status) params.set("status", query.status);
  if (query.startDate) params.set("start_date", query.startDate);
  if (query.endDate) params.set("end_date", query.endDate);
  if (query.search) params.set("search", query.search);
  if (query.limit != null) params.set("limit", String(query.limit));
  if (query.offset != null) params.set("offset", String(query.offset));
  const q = params.toString();
  return request<ChatHistoryPage>(`/chat-history${q ? `?${q}` : ""}`, {}, token);
}

export function getChatHistoryDetail(token: string, sessionId: number): Promise<ChatSessionDetail> {
  return request<ChatSessionDetail>(`/chat-history/${sessionId}`, {}, token);
}

// ---- Chat session timing / SLA ----

export function getChatSessionState(token: string, projectId: number, conversationId: number): Promise<ChatSessionState> {
  return request<ChatSessionState>(`/projects/${projectId}/conversations/${conversationId}/session`, {}, token);
}

export function closeChatSession(token: string, projectId: number, conversationId: number): Promise<ChatSessionState> {
  return request<ChatSessionState>(
    `/projects/${projectId}/conversations/${conversationId}/session/close`,
    { method: "POST" },
    token,
  );
}
