export type UserRole = "ADMIN" | "OPERATOR" | "MEMBER";

export interface User {
  id: number;
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  is_super_admin?: boolean;
  is_active: boolean;
  created_at: string;
  membership_status?: string | null;
  is_assigned?: boolean | null;
}

export interface UserWithOperator extends User {
  assigned_operator_id: number | null;
  assigned_operator_name: string | null;
  assigned_operator_uid: string | null;
  membership_status?: string | null;
}

export interface Project {
  id: number;
  name: string;
  logo_url: string | null;
  operator_terminated_message?: string | null;
  support_email?: string | null;
  support_phone?: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Conversation {
  id: number;
  project_id: number;
  type: "admin_operator" | "operator_member" | "group";
  operator_id: number;
  member_id: number | null;
  admin_id: number | null;
  name?: string;
  created_at: string;
  unread_count?: number;
  last_message_at?: string | null;
}

export interface Message {
  id: number;
  conversation_id: number;
  project_id: number;
  sender_user_id: number;
  sender_role: UserRole;
  content: string;
  message_type: "text" | "admin_broadcast";
  attachment_url?: string | null;
  attachment_filename?: string | null;
  attachment_mime?: string | null;
  created_at: string;
  read_by_user_ids?: number[];
}

export interface Presence {
  user_id: number;
  project_id: number;
  is_online: boolean;
  last_seen_at: string | null;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

// ---- Analytics ----
// Derived only from real conversation/message/assignment/presence data, plus the
// server-authoritative ChatSession/OperatorMistake tables (chat timing/SLA system) for the
// `timing` fields below.

export interface AnalyticsRange {
  start: string;
  end: string;
  granularity: "hour" | "day" | "week";
}

export interface ConversationBreakdown {
  active: number;
  reassigned: number;
  terminated: number;
  removed: number;
}

export interface MessageStats {
  sent: number;
  received: number;
}

export interface ResponseTimeStats {
  avg_seconds: number | null;
  min_seconds: number | null;
  max_seconds: number | null;
  sample_size: number;
}

export interface VolumePoint {
  bucket: string;
  conversations_started: number;
  messages_sent: number;
  messages_received: number;
}

export interface ResponseTimePoint {
  bucket: string;
  avg_seconds: number | null;
  sample_size: number;
}

export interface TimingMetrics {
  total_sessions: number;
  completed: number;
  missed: number;
  abandoned: number;
  auto_closed: number;
  sla_met: number;
  sla_breached: number;
  avg_first_response_seconds: number | null;
  avg_handling_seconds: number | null;
  missing_thank_you_count: number;
  operator_mistake_count: number;
  sla_compliance_percent: number | null;
}

export interface PresenceStatus {
  project_id: number;
  project_name: string;
  is_online: boolean;
  last_seen_at: string | null;
}

export interface ConversationRef {
  conversation_id: number;
  project_id: number;
  project_name: string;
  member_id: number;
  member_name: string;
  member_uid: string;
  last_message_at: string | null;
}

export type BreakdownCategory = "active" | "reassigned" | "terminated" | "removed";

export interface OperatorAnalytics {
  operator_id: number;
  operator_name: string;
  operator_uid: string;
  operator_email: string;
  range: AnalyticsRange;
  project_id: number | null;
  conversations_started: number;
  conversations: ConversationBreakdown;
  messages: MessageStats;
  response_time: ResponseTimeStats;
  presence: PresenceStatus[];
  volume_series: VolumePoint[];
  response_time_series: ResponseTimePoint[];
  breakdown_refs: Record<BreakdownCategory, ConversationRef[]>;
  timing: TimingMetrics;
}

export interface OperatorSummaryRow {
  operator_id: number;
  operator_name: string;
  operator_uid: string;
  operator_email: string;
  is_online: boolean;
  conversations_started: number;
  conversations: ConversationBreakdown;
  messages: MessageStats;
  response_time: ResponseTimeStats;
  timing: TimingMetrics;
}

export interface AdminOverview {
  range: AnalyticsRange;
  project_id: number | null;
  conversations_started: number;
  conversations: ConversationBreakdown;
  messages: MessageStats;
  response_time: ResponseTimeStats;
  volume_series: VolumePoint[];
  operators: OperatorSummaryRow[];
  timing: TimingMetrics;
}

export interface ProjectAnalytics {
  project_id: number;
  project_name: string;
  range: AnalyticsRange;
  conversations_started: number;
  conversations: ConversationBreakdown;
  messages: MessageStats;
  response_time: ResponseTimeStats;
  operators: OperatorSummaryRow[];
  timing: TimingMetrics;
}

export interface WorkloadOperator {
  operator_id: number;
  operator_name: string;
  operator_uid: string;
  is_online: boolean;
  active_members: number;
  assigned_project_count: number;
}

export interface Workload {
  online_count: number;
  offline_count: number;
  operators: WorkloadOperator[];
}

export interface MemberAnalytics {
  member_id: number;
  member_name: string;
  member_uid: string;
  member_email: string;
  project_id: number | null;
  project_name: string | null;
  assigned_operator_id: number | null;
  assigned_operator_name: string | null;
  account_status: string;
  is_active: boolean;
  range: AnalyticsRange;
  active_chats_now: number;
  messages: MessageStats;
  response_time: ResponseTimeStats;
  volume_series: VolumePoint[];
  response_time_series: ResponseTimePoint[];
  timing: TimingMetrics;
  first_chat_at: string | null;
  last_chat_at: string | null;
}

// ---- Operator presence / activity history (server-authoritative) ----

export interface PresenceHistoryEvent {
  id: number;
  user_id: number;
  project_id: number;
  project_name: string;
  event_type: "online" | "offline";
  occurred_at: string;
  duration_seconds: number | null;
  is_ongoing: boolean;
}

export interface PresenceAnalytics {
  operator_id: number;
  operator_name: string;
  operator_uid: string;
  project_id: number | null;
  range: AnalyticsRange;
  is_online: boolean;
  total_online_seconds: number;
  total_offline_seconds: number;
  session_count: number;
  first_login_at: string | null;
  last_logout_at: string | null;
  active_session_seconds: number | null;
}

// ---- Chat History report (server-authoritative) ----

export interface ChatHistoryRow {
  session_id: number;
  conversation_id: number;
  project_id: number;
  project_name: string;
  member_id: number;
  member_name: string;
  member_uid: string;
  operator_id: number;
  operator_name: string;
  operator_uid: string;
  started_at: string;
  assigned_at: string;
  first_response_at: string | null;
  closed_at: string | null;
  duration_seconds: number | null;
  status: ChatSessionStatus;
}

export interface ChatHistoryPage {
  items: ChatHistoryRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface ChatSessionEventItem {
  event_type: string;
  occurred_at: string;
  detail: string | null;
}

export interface ChatSessionDetail extends ChatHistoryRow {
  thank_you_present: boolean | null;
  first_response_sla_met: boolean | null;
  messages: Message[];
  events: ChatSessionEventItem[];
}

// ---- Chat session timing / SLA (server-authoritative) ----

export type ChatSessionStatus = "active" | "completed" | "auto_closed" | "abandoned";

export interface ChatSessionState {
  conversation_id: number;
  session_id: number | null;
  status: ChatSessionStatus | null;
  started_at: string | null;
  expires_at: string | null;
  remaining_seconds: number | null;
  first_response_sla_deadline: string | null;
  first_response_at: string | null;
  first_response_sla_met: boolean | null;
  first_response_remaining_seconds: number | null;
  thank_you_present: boolean | null;
  closed_at: string | null;
  max_duration_seconds: number;
  first_response_sla_seconds: number;
}
