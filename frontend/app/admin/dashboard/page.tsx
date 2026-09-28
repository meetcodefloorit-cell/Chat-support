"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { AttachmentImage, AttachmentLink } from "@/components/AttachmentDisplay";
import { NotificationBell } from "@/components/NotificationBell";
import { PresenceDot } from "@/components/PresenceDot";
import {
  activateProject,
  adminAssignMemberOperator,
  adminCreateMember,
  assignOperator,
  broadcastMembers,
  changeMyPassword,
  changeUserPassword,
  clearConversationsBulk,
  createProject,
  createUser,
  deactivateProject,
  deactivateUsersGloballyBulk,
  deactivateUserGlobally,
  deleteConversation,
  deleteProject,
  deleteProjectLogo,
  permanentlyDeleteUser,
  permanentlyDeleteUsersBulk,
  hideConversationsBulk,
  permanentlyDeleteProject,
  getConversations,
  getMe,
  getMembersWithOperators,
  getMessages,
  getOperators,
  getOperatorsWithStatus,
  getUsersByRole,
  getPresence,
  getProjects,
  getOperatorAssignOptions,
  postMessage,
  removeOperator,
  removeMember,
  resetAdminPassword,
  searchMessages,
  terminateUser,
  updateProject,
  uploadAttachment,
  uploadProjectLogo,
} from "@/lib/api";
import { clearSession, getDashboardPath, getLoginPath, getToken, getUser } from "@/lib/auth";
import { useIsMobile } from "@/hooks/useIsMobile";
import { parseError } from "@/lib/parseError";
import { buildWebSocketUrl } from "@/lib/ws";
import { Conversation, Message, Presence, Project, User, UserRole, UserWithOperator } from "@/lib/types";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { LoadingState } from "@/components/ui/Skeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchInput } from "@/components/ui/SearchInput";
import { ToastStack } from "@/components/ui/Toast";
import {
  AlertTriangleIcon,
  ChartBarIcon,
  ChatBubbleIcon,
  CheckDoubleIcon,
  ChevronLeftIcon,
  FolderIcon,
  GridIcon,
  HeadsetIcon,
  HistoryIcon,
  ImageIcon,
  InboxIcon,
  KeyIcon,
  LogoutIcon,
  MegaphoneIcon,
  MenuIcon,
  PaperclipIcon,
  SendIcon,
  UsersIcon,
} from "@/components/ui/icons";
import { AdminAnalyticsOverview } from "@/components/analytics/AdminAnalyticsOverview";
import { AdminDashboardHome } from "@/components/dashboard/AdminDashboardHome";
import { MemberAnalyticsDashboard } from "@/components/analytics/MemberAnalyticsDashboard";
import { OperatorPresenceHistoryPanel } from "@/components/analytics/OperatorPresenceHistoryPanel";
import { ChatHistoryPage } from "@/components/analytics/ChatHistoryPage";

type Panel =
  | "dashboard"
  | "inbox"
  | "broadcast"
  | "operators"
  | "members"
  | "history"
  | "projects"
  | "users"
  | "branding"
  | "analytics"
  | "chatHistory";
type InboxTab = "active" | "terminated";

export default function AdminDashboard() {
  const router = useRouter();
  const confirm = useConfirm();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalWsCloseRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsPendingSendRef = useRef<{ conversationId: number; content: string } | null>(null);
  const refreshProjectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshingProjectRef = useRef(false);
  const conversationsRef = useRef<Conversation[]>([]);
  const inboxFilterOperatorIdRef = useRef<number | null>(null);
  const inboxFilterMemberIdRef = useRef<number | null>(null);
  const inboxFilterTypeRef = useRef<string>("");

  const [token, setToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  const [members, setMembers] = useState<UserWithOperator[]>([]);
  const [operators, setOperators] = useState<User[]>([]);
  const [operatorsWithStatus, setOperatorsWithStatus] = useState<User[]>([]);
  const [assignableOperators, setAssignableOperators] = useState<User[]>([]);
  const [allOperators, setAllOperators] = useState<User[]>([]);
  const [allMembers, setAllMembers] = useState<User[]>([]);
  const [allAdmins, setAllAdmins] = useState<User[]>([]);

  const [analyticsMemberId, setAnalyticsMemberId] = useState<number | null>(null);
  const [presenceOperator, setPresenceOperator] = useState<{ id: number; name: string } | null>(null);

  const [presence, setPresence] = useState<Record<number, Presence>>({});
  const [activePanel, setActivePanel] = useState<Panel>("dashboard");

  const [chatInput, setChatInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [typingUserId, setTypingUserId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Message[] | null>(null);
  const [uploading, setUploading] = useState(false);

  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [wsReconnecting, setWsReconnecting] = useState(false);
  const [wsNotifKey, setWsNotifKey] = useState(0);
  const [dataLoading, setDataLoading] = useState(true);
  const initialLoadDoneRef = useRef(false);
  const isMobile = useIsMobile();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileInboxChat, setMobileInboxChat] = useState(false);

  const [inboxFilterOperatorId, setInboxFilterOperatorId] = useState<number | null>(null);
  const [inboxFilterMemberId, setInboxFilterMemberId] = useState<number | null>(null);
  const [inboxFilterType, setInboxFilterType] = useState<string>("");
  const [inboxTab, setInboxTab] = useState<InboxTab>("active");

  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcastAll, setBroadcastAll] = useState(true);
  const [broadcastMemberId, setBroadcastMemberId] = useState<number | null>(null);
  const [broadcastAllOperators, setBroadcastAllOperators] = useState(false);
  const [broadcastOperatorId, setBroadcastOperatorId] = useState<number | null>(null);
  const [broadcastDeliveryMethod, setBroadcastDeliveryMethod] = useState<"chat" | "notification">("chat");

  const [createProjectNameInput, setCreateProjectNameInput] = useState("");
  const [createProjectLogoInput, setCreateProjectLogoInput] = useState("");
  const [createProjectSupportEmail, setCreateProjectSupportEmail] = useState("");
  const [createProjectSupportPhone, setCreateProjectSupportPhone] = useState("");
  const [brandingProjectNameInput, setBrandingProjectNameInput] = useState("");
  const [brandingProjectLogoInput, setBrandingProjectLogoInput] = useState("");
  const [operatorTerminatedMessageInput, setOperatorTerminatedMessageInput] = useState("");
  const [supportEmailInput, setSupportEmailInput] = useState("");
  const [supportPhoneInput, setSupportPhoneInput] = useState("");

  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<UserRole>("OPERATOR");

  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberPassword, setNewMemberPassword] = useState("");
  const [newMemberOperatorId, setNewMemberOperatorId] = useState<number | null>(null);
  const [existingMemberId, setExistingMemberId] = useState<number | null>(null);
  const [existingMemberOperatorId, setExistingMemberOperatorId] = useState<number | null>(null);
  const [memberReassignOp, setMemberReassignOp] = useState<Record<number, number | null>>({});
  const [globalMemberAssignOp, setGlobalMemberAssignOp] = useState<Record<number, number | null>>({});

  const [assignOperatorId, setAssignOperatorId] = useState<number | null>(null);
  const [selectedOperatorIds, setSelectedOperatorIds] = useState<number[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);
  const [selectedConversationIds, setSelectedConversationIds] = useState<number[]>([]);
  const [selectedHistoryOperatorIds, setSelectedHistoryOperatorIds] = useState<number[]>([]);
  const [selectedHistoryMemberIds, setSelectedHistoryMemberIds] = useState<number[]>([]);
  const [inboxBulkActionLoading, setInboxBulkActionLoading] = useState<"clear" | "hide" | null>(null);
  const [historyBulkActionLoading, setHistoryBulkActionLoading] = useState<
    "operators-global" | "operators-permanent" | "members-global" | "members-permanent" | null
  >(null);
  const [projectActionKey, setProjectActionKey] = useState<string | null>(null);
  const [memberCreateLoading, setMemberCreateLoading] = useState(false);
  const [deactivatingUserIds, setDeactivatingUserIds] = useState<number[]>([]);
  const [permanentlyDeletingUserIds, setPermanentlyDeletingUserIds] = useState<number[]>([]);

  const [changePwUserId, setChangePwUserId] = useState<number | null>(null);
  const [changePwValue, setChangePwValue] = useState<string>("");
  const [myCurrentPw, setMyCurrentPw] = useState<string>("");
  const [myNewPw, setMyNewPw] = useState<string>("");
  const [adminResetUserId, setAdminResetUserId] = useState<number | null>(null);
  const [adminResetPw, setAdminResetPw] = useState<string>("");

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );
  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedConversationId) || null,
    [conversations, selectedConversationId],
  );

  const matchesActiveInboxFilters = useCallback((conversation: Conversation) => {
    if (inboxFilterTypeRef.current && conversation.type !== inboxFilterTypeRef.current) {
      return false;
    }
    if (
      inboxFilterOperatorIdRef.current != null &&
      conversation.operator_id !== inboxFilterOperatorIdRef.current
    ) {
      return false;
    }
    if (
      inboxFilterMemberIdRef.current != null &&
      conversation.member_id !== inboxFilterMemberIdRef.current
    ) {
      return false;
    }
    return true;
  }, []);

  const knownUsers = useMemo(() => {
    const map = new Map<number, User>();
    if (currentUser) map.set(currentUser.id, currentUser);
    [...members, ...operators, ...operatorsWithStatus, ...allOperators, ...allMembers].forEach((u) =>
      map.set(u.id, u),
    );
    return map;
  }, [currentUser, members, operators, operatorsWithStatus, allOperators, allMembers]);

  const projectMembersById = useMemo(() => {
    return new Map(members.map((m) => [m.id, m]));
  }, [members]);

  const existingMemberOptions = useMemo(() => {
    return allMembers
      .map((m) => {
        const projectMember = projectMembersById.get(m.id);
        const status = (projectMember?.membership_status || "active").toLowerCase();
        let scopeLabel = "Not in selected project";
        if (projectMember) {
          if (status === "active") {
            scopeLabel = projectMember.assigned_operator_name
              ? `Already in project · assigned to ${projectMember.assigned_operator_name}`
              : "Already in project · unassigned";
          } else {
            scopeLabel = `In project (${status})`;
          }
        }
        return {
          id: m.id,
          name: m.name,
          email: m.email,
          scopeLabel,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allMembers, projectMembersById]);

  const assignedOperatorIds = useMemo(() => {
    return new Set(operators.map((o) => o.id));
  }, [operators]);

  const activeProjectMembers = useMemo(
    () => members.filter((m) => m.is_active && (m.membership_status || "active").toLowerCase() === "active"),
    [members],
  );

  const historyMembers = useMemo(
    () => members.filter((m) => !m.is_active || (m.membership_status || "active").toLowerCase() !== "active"),
    [members],
  );

  const historyOperators = useMemo(
    () =>
      operatorsWithStatus.filter(
        (o) => !o.is_active || (o.membership_status || "active").toLowerCase() !== "active",
      ),
    [operatorsWithStatus],
  );

  const historyActiveOperatorIds = useMemo(
    () => historyOperators.filter((o) => o.is_active).map((o) => o.id),
    [historyOperators],
  );

  const historyDeletedOperatorIds = useMemo(
    () => historyOperators.filter((o) => !o.is_active).map((o) => o.id),
    [historyOperators],
  );

  const historyActiveMemberIds = useMemo(
    () => historyMembers.filter((m) => m.is_active).map((m) => m.id),
    [historyMembers],
  );

  const historyDeletedMemberIds = useMemo(
    () => historyMembers.filter((m) => !m.is_active).map((m) => m.id),
    [historyMembers],
  );

  const terminatedOperatorIds = useMemo(
    () =>
      new Set(
        operatorsWithStatus
          .filter((o) => (o.membership_status || "active").toLowerCase() === "terminated")
          .map((o) => o.id),
      ),
    [operatorsWithStatus],
  );

  const activeInboxConversations = useMemo(
    () =>
      conversations.filter(
        (conv) =>
          !(conv.type === "admin_operator" && terminatedOperatorIds.has(conv.operator_id)),
      ),
    [conversations, terminatedOperatorIds],
  );

  const terminatedInboxConversations = useMemo(
    () =>
      conversations.filter(
        (conv) => conv.type === "admin_operator" && terminatedOperatorIds.has(conv.operator_id),
      ),
    [conversations, terminatedOperatorIds],
  );

  const visibleInboxConversations = useMemo(
    () => (inboxTab === "terminated" ? terminatedInboxConversations : activeInboxConversations),
    [inboxTab, terminatedInboxConversations, activeInboxConversations],
  );

  const selectedVisibleConversationCount = useMemo(() => {
    const visibleIds = new Set(visibleInboxConversations.map((conv) => conv.id));
    return selectedConversationIds.filter((id) => visibleIds.has(id)).length;
  }, [selectedConversationIds, visibleInboxConversations]);

  const allVisibleConversationsSelected = useMemo(
    () =>
      visibleInboxConversations.length > 0 &&
      visibleInboxConversations.every((conv) => selectedConversationIds.includes(conv.id)),
    [visibleInboxConversations, selectedConversationIds],
  );

  const selectedHistoryActiveOperatorCount = useMemo(() => {
    const activeSet = new Set(historyActiveOperatorIds);
    return selectedHistoryOperatorIds.filter((id) => activeSet.has(id)).length;
  }, [selectedHistoryOperatorIds, historyActiveOperatorIds]);

  const selectedHistoryDeletedOperatorCount = useMemo(() => {
    const deletedSet = new Set(historyDeletedOperatorIds);
    return selectedHistoryOperatorIds.filter((id) => deletedSet.has(id)).length;
  }, [selectedHistoryOperatorIds, historyDeletedOperatorIds]);

  const selectedHistoryActiveMemberCount = useMemo(() => {
    const activeSet = new Set(historyActiveMemberIds);
    return selectedHistoryMemberIds.filter((id) => activeSet.has(id)).length;
  }, [selectedHistoryMemberIds, historyActiveMemberIds]);

  const selectedHistoryDeletedMemberCount = useMemo(() => {
    const deletedSet = new Set(historyDeletedMemberIds);
    return selectedHistoryMemberIds.filter((id) => deletedSet.has(id)).length;
  }, [selectedHistoryMemberIds, historyDeletedMemberIds]);

  const reassignableOperators = useMemo(
    () =>
      operatorsWithStatus.filter((o) => {
        const membershipStatus = (o.membership_status || "active").toLowerCase();
        return o.is_active && (membershipStatus === "active" || Boolean(o.is_assigned));
      }),
    [operatorsWithStatus],
  );

  const getHistoryStatus = (user: Pick<User, "is_active" | "membership_status">): string => {
    if (!user.is_active) return "deleted";
    return (user.membership_status || "active").toLowerCase();
  };

  const switchInboxTab = useCallback(
    (nextTab: InboxTab, preferredConversationId: number | null = null) => {
      setInboxTab(nextTab);
      const nextVisible =
        nextTab === "terminated" ? terminatedInboxConversations : activeInboxConversations;
      const visibleIds = new Set(nextVisible.map((conversation) => conversation.id));
      setSelectedConversationIds((prev) => prev.filter((id) => visibleIds.has(id)));

      let nextSelectedId: number | null = null;
      if (preferredConversationId != null && visibleIds.has(preferredConversationId)) {
        nextSelectedId = preferredConversationId;
      } else if (selectedConversationId != null && visibleIds.has(selectedConversationId)) {
        nextSelectedId = selectedConversationId;
      } else if (nextVisible.length > 0) {
        nextSelectedId = nextVisible[0].id;
      }

      setSelectedConversationId(nextSelectedId);
      if (nextSelectedId == null) {
        setMessages([]);
        setHasMoreOlder(false);
        if (isMobile) setMobileInboxChat(false);
      }
    },
    [
      activeInboxConversations,
      isMobile,
      selectedConversationId,
      terminatedInboxConversations,
    ],
  );

  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  };

  const runProjectAction = useCallback(
    async (key: string, action: () => Promise<void>) => {
      if (projectActionKey) return;
      setProjectActionKey(key);
      try {
        await action();
      } finally {
        setProjectActionKey(null);
      }
    },
    [projectActionKey],
  );

  useEffect(() => {
    if (!isMobile) {
      setMobileSidebarOpen(false);
      setMobileInboxChat(false);
    }
  }, [isMobile]);

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  };

  const sortConversationsByActivity = useCallback((items: Conversation[]): Conversation[] => {
    return [...items].sort((a, b) => {
      const aTime = a.last_message_at || a.created_at || "";
      const bTime = b.last_message_at || b.created_at || "";
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
  }, []);

  const loadProjects = useCallback(async () => {
    if (!token) return;
    const data = await getProjects(token);
    setProjects(data);
    const hasCurrentProject = selectedProjectId != null && data.some((project) => project.id === selectedProjectId);
    if (hasCurrentProject) return;

    const nextProject = data.find((project) => project.is_active) ?? data[0] ?? null;
    setSelectedProjectId(nextProject ? nextProject.id : null);
    if (!nextProject) {
      setConversations([]);
      setSelectedConversationId(null);
      setMessages([]);
      setMembers([]);
      setOperators([]);
      setOperatorsWithStatus([]);
      setPresence({});
      setActivePanel("projects");
    }
  }, [token, selectedProjectId]);

  const loadGlobalUsers = useCallback(async () => {
    if (!token) return;
    const [allOps, allMems, admins] = await Promise.all([
      getUsersByRole(token, "OPERATOR"),
      getUsersByRole(token, "MEMBER"),
      getUsersByRole(token, "ADMIN"),
    ]);
    setAllOperators(allOps);
    setAllMembers(allMems);
    setAllAdmins(admins);
  }, [token]);

  // Guards to prevent out-of-order async responses from overwriting UI
  // when the admin switches projects quickly or when websocket refresh triggers
  // overlapping loads.
  const loadProjectDataReqIdRef = useRef(0);
  const loadConversationMessagesReqIdRef = useRef(0);
  const loadOlderMessagesReqIdRef = useRef(0);

  const loadProjectData = useCallback(async () => {
    if (!token || !selectedProjectId) return;
    const reqId = ++loadProjectDataReqIdRef.current;
    if (!initialLoadDoneRef.current) setDataLoading(true);
    try {
      const proj = projects.find((p) => p.id === selectedProjectId) || null;
      if (reqId !== loadProjectDataReqIdRef.current) return;
      if (!proj || !proj.is_active) {
        setConversations([]);
        setSelectedConversationId(null);
        setMessages([]);
        setMembers([]);
        setOperators([]);
        setPresence({});
        return;
      }

      const filters =
        inboxFilterOperatorId != null || inboxFilterMemberId != null || inboxFilterType
          ? {
              operator_id: inboxFilterOperatorId ?? undefined,
              member_id: inboxFilterMemberId ?? undefined,
              type: inboxFilterType || undefined,
            }
          : undefined;

      const [convRes, memberRes, presenceRes, operatorRes, operatorStatusRes, assignOpts] = await Promise.all([
        getConversations(token, selectedProjectId, filters),
        getMembersWithOperators(token, selectedProjectId),
        getPresence(token, selectedProjectId),
        getOperators(token, selectedProjectId),
        getOperatorsWithStatus(token, selectedProjectId),
        getOperatorAssignOptions(token, selectedProjectId),
      ]);

      if (reqId !== loadProjectDataReqIdRef.current) return;
      const sortedConversations = sortConversationsByActivity(convRes);
      setConversations(sortedConversations);
      setSelectedConversationId((prev) => {
        if (sortedConversations.length === 0) return null;
        if (prev != null && sortedConversations.some((conversation) => conversation.id === prev)) {
          return prev;
        }
        return null;
      });
      setMembers(memberRes);
      setOperators(operatorRes);
      setOperatorsWithStatus(operatorStatusRes);
      setAssignableOperators(assignOpts.assignable);

      const pMap: Record<number, Presence> = {};
      presenceRes.forEach((item) => {
        pMap[item.user_id] = item;
      });
      setPresence(pMap);
    } catch (e) {
      if (reqId !== loadProjectDataReqIdRef.current) return;
      const msg = parseError(e);
      const normalized = msg.toLowerCase();
      if (normalized.includes("project not found") || normalized.includes("no access to this project")) {
        await loadProjects();
        return;
      }
      if (
        initialLoadDoneRef.current &&
        (normalized.includes("admin mismatch") ||
          normalized.includes("conversation not found") ||
          normalized.includes("fetch"))
      ) {
        return;
      }
      setError(msg);
    } finally {
      if (!initialLoadDoneRef.current && reqId === loadProjectDataReqIdRef.current) {
        initialLoadDoneRef.current = true;
        setDataLoading(false);
      }
    }
  }, [token, selectedProjectId, inboxFilterOperatorId, inboxFilterMemberId, inboxFilterType, projects, sortConversationsByActivity, loadProjects]);

  const loadConversationMessages = useCallback(async () => {
    if (!token || !selectedProjectId || !selectedConversationId) {
      setMessages([]);
      setHasMoreOlder(false);
      return;
    }
    const reqId = ++loadConversationMessagesReqIdRef.current;
    setMessages([]);
    setHasMoreOlder(false);
    try {
      const data = await getMessages(token, selectedProjectId, selectedConversationId, 50, 0);
      if (reqId !== loadConversationMessagesReqIdRef.current) return;
      setMessages(data);
      setHasMoreOlder(data.length === 50);
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === selectedConversationId
            ? { ...conversation, unread_count: 0 }
            : conversation,
        ),
      );
      scrollToBottom();
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ event: "join", conversation_id: selectedConversationId }));
        const myId = currentUser?.id;
        if (myId) {
          data
            .filter((m) => m.sender_user_id !== myId)
            .forEach((m) => wsRef.current?.send(JSON.stringify({ event: "read_update", conversation_id: selectedConversationId, message_id: m.id })));
        }
      } else {
        setConversations((prev) =>
          prev.map((conversation) =>
            conversation.id === selectedConversationId
              ? { ...conversation, unread_count: 0 }
              : conversation,
          ),
        );
      }
    } catch (err) {
      const msg = parseError(err);
      if (reqId !== loadConversationMessagesReqIdRef.current) return;
      const normalized = msg.toLowerCase();
      if (normalized.includes("project not found") || normalized.includes("no access to this project")) {
        await loadProjects();
        await loadProjectData();
        return;
      }
      if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
        // Conversation ID can become stale after canonical thread merge; refresh and remap selection.
        await loadProjectData();
        return;
      }
      setError(msg);
    }
  }, [token, selectedProjectId, selectedConversationId, currentUser?.id, loadProjectData, loadProjects]);

  const loadOlderMessages = useCallback(async () => {
    if (!token || !selectedProjectId || !selectedConversationId || loadingOlder || !hasMoreOlder) return;
    const reqId = ++loadOlderMessagesReqIdRef.current;
    setLoadingOlder(true);
    try {
      const older = await getMessages(token, selectedProjectId, selectedConversationId, 50, messages.length);
      if (reqId !== loadOlderMessagesReqIdRef.current) return;
      setMessages((prev) => [...older, ...prev]);
      setHasMoreOlder(older.length === 50);
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const myId = currentUser?.id;
        if (myId) {
          older
            .filter((message) => message.sender_user_id !== myId)
            .forEach((message) =>
              wsRef.current?.send(
                JSON.stringify({
                  event: "read_update",
                  conversation_id: selectedConversationId,
                  message_id: message.id,
                }),
              ),
            );
        }
      } else {
        setConversations((prev) =>
          prev.map((conversation) =>
            conversation.id === selectedConversationId
              ? { ...conversation, unread_count: 0 }
              : conversation,
          ),
        );
      }
    } catch (e) {
      if (reqId === loadOlderMessagesReqIdRef.current) setError(parseError(e));
    } finally {
      if (reqId === loadOlderMessagesReqIdRef.current) setLoadingOlder(false);
    }
  }, [token, selectedProjectId, selectedConversationId, messages.length, hasMoreOlder, loadingOlder, currentUser?.id, loadProjectData]);

  const selectedConvRef = useRef(selectedConversationId);
  const selectedProjectIdRef = useRef(selectedProjectId);
  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);
  useEffect(() => {
    selectedConvRef.current = selectedConversationId;
  }, [selectedConversationId]);
  useEffect(() => {
    inboxFilterOperatorIdRef.current = inboxFilterOperatorId;
  }, [inboxFilterOperatorId]);
  useEffect(() => {
    inboxFilterMemberIdRef.current = inboxFilterMemberId;
  }, [inboxFilterMemberId]);
  useEffect(() => {
    inboxFilterTypeRef.current = inboxFilterType;
  }, [inboxFilterType]);

  const loadProjectDataRef = useRef(loadProjectData);
  useEffect(() => {
    loadProjectDataRef.current = loadProjectData;
  }, [loadProjectData]);

  const loadConversationMessagesRef = useRef(loadConversationMessages);
  useEffect(() => {
    loadConversationMessagesRef.current = loadConversationMessages;
  }, [loadConversationMessages]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const scheduleProjectRefresh = useCallback(() => {
    if (refreshProjectTimerRef.current) return;
    refreshProjectTimerRef.current = setTimeout(async () => {
      refreshProjectTimerRef.current = null;
      if (refreshingProjectRef.current) return;
      refreshingProjectRef.current = true;
      try {
        await loadProjectDataRef.current();
        if (selectedConvRef.current != null) {
          await loadConversationMessagesRef.current();
        }
      } catch {
        // Ignore transient refresh errors during websocket bursts.
      } finally {
        refreshingProjectRef.current = false;
      }
    }, 160);
  }, []);

  const connectSocket = useCallback(() => {
    if (!token || !selectedProjectId) return;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    const socketProjectId = selectedProjectId;
    const wsUrl = buildWebSocketUrl(token, selectedProjectId);
    if (!wsUrl) return;

    try {
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        reconnectAttemptsRef.current = 0;
        setWsReconnecting(false);
        setError(null);
        socket.send(JSON.stringify({ event: "presence" }));
        const convId = selectedConvRef.current;
        if (convId && conversationsRef.current.some((conversation) => conversation.id === convId)) {
          socket.send(JSON.stringify({ event: "join", conversation_id: convId }));
        }
      };

      socket.onmessage = (event) => {
        try {
          // If the user switched projects, ignore messages arriving from an old socket.
          if (selectedProjectIdRef.current !== socketProjectId) return;

          const payload = JSON.parse(event.data);

          if (payload.event === "message:new") {
            const message = payload.data as Message;
            setWsNotifKey((k) => k + 1);
            if (message.sender_user_id === currentUser?.id && wsPendingSendRef.current?.conversationId === message.conversation_id) {
              wsPendingSendRef.current = null;
            }

            setConversations((prev) => {
              const match = prev.find((c) => c.id === message.conversation_id);
              if (!match) return prev;
              if (!matchesActiveInboxFilters(match)) {
                return prev.filter((c) => c.id !== message.conversation_id);
              }
              const sel = selectedConvRef.current;
              const isSelected = message.conversation_id === sel;
              const updated = prev.map((c) => {
                if (c.id !== message.conversation_id) return c;
                let unread = c.unread_count || 0;
                if (!isSelected && message.sender_user_id !== currentUser?.id) unread += 1;
                if (isSelected) unread = 0;
                return { ...c, last_message_at: message.created_at, unread_count: unread };
              });
              return sortConversationsByActivity(updated);
            });

            if (message.conversation_id === selectedConvRef.current) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === message.id)) return prev;
                return [...prev, message];
              });
              scrollToBottom();
              if (message.sender_user_id !== currentUser?.id && wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ event: "read_update", conversation_id: message.conversation_id, message_id: message.id }));
              }
            }
          } else if (payload.event === "read:update") {
            const d = payload.data as { message_id: number; user_id: number; conversation_id: number };
            if (d.conversation_id === selectedConvRef.current) {
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== d.message_id) return m;
                  const ids = m.read_by_user_ids || [];
                  if (ids.includes(d.user_id)) return m;
                  return { ...m, read_by_user_ids: [...ids, d.user_id] };
                }),
              );
            }
            if (d.user_id === currentUser?.id) {
              setConversations((prev) =>
                prev.map((conversation) =>
                  conversation.id === d.conversation_id
                    ? { ...conversation, unread_count: 0 }
                    : conversation,
                ),
              );
            }
          } else if (payload.event === "presence:update") {
            const update = payload.data as Presence;
            setPresence((prev) => ({ ...prev, [update.user_id]: update }));
          } else if (payload.event === "presence:snapshot") {
            const list = payload.data as Presence[];
            const map: Record<number, Presence> = {};
            list.forEach((item) => {
              map[item.user_id] = item;
            });
            setPresence((prev) => ({ ...prev, ...map }));
          } else if (payload.event === "typing:start") {
            const d = payload.data as { conversation_id: number; user_id: number };
            if (d.conversation_id === selectedConvRef.current) setTypingUserId(d.user_id);
          } else if (payload.event === "typing:stop") {
            const d = payload.data as { conversation_id: number; user_id: number };
            if (d.conversation_id === selectedConvRef.current) setTypingUserId((prev) => (prev === d.user_id ? null : prev));
          } else if (payload.event === "conversation:cleared") {
            const d = payload.data as { conversation_id: number; scope: "me" | "all" };
            setConversations((prev) =>
              prev.map((c) =>
                c.id === d.conversation_id
                  ? {
                      ...c,
                      unread_count: 0,
                      last_message_at: null,
                    }
                  : c,
              ),
            );
            if (d.conversation_id === selectedConvRef.current) {
              setMessages([]);
              setHasMoreOlder(false);
            }
          } else if (payload.event === "conversation:upsert") {
            const conversation = payload.data as Conversation;
            setConversations((prev) => {
              if (!matchesActiveInboxFilters(conversation)) {
                return prev.filter((item) => item.id !== conversation.id);
              }
              const next = prev.some((item) => item.id === conversation.id)
                ? prev.map((item) => (item.id === conversation.id ? conversation : item))
                : [conversation, ...prev];
              return sortConversationsByActivity(next);
            });
          } else if (payload.event === "conversation:remove") {
            const d = payload.data as { conversation_id: number };
            setConversations((prev) => prev.filter((conversation) => conversation.id !== d.conversation_id));
            if (d.conversation_id === selectedConvRef.current) {
              setSelectedConversationId(null);
              setMessages([]);
              setHasMoreOlder(false);
              if (isMobile) setMobileInboxChat(false);
            }
          } else if (payload.event === "members:changed" || payload.event === "operators:changed") {
            setTypingUserId(null);
            setSearchResults(null);
            scheduleProjectRefresh();
          } else if (payload.event === "project:refresh") {
            setTypingUserId(null);
            setSearchResults(null);
            scheduleProjectRefresh();
          } else if (payload.event === "error") {
            const detail = typeof payload.detail === "string" ? payload.detail : "WebSocket error";
            const pending = wsPendingSendRef.current;
            if (pending && pending.conversationId === selectedConvRef.current) {
              setChatInput((prev) => (prev.trim() ? prev : pending.content));
              wsPendingSendRef.current = null;
            }
            const normalized = detail.toLowerCase();
            if (
              normalized.includes("admin mismatch") ||
              normalized.includes("conversation not found") ||
              normalized.includes("project not found") ||
              normalized.includes("no access to this project")
            ) {
              scheduleProjectRefresh();
              return;
            }
            setError(`Send failed: ${detail}`);
          } else if (payload.event === "notification:count") {
            setWsNotifKey((k) => k + 1);
          }
        } catch {
          // ignore malformed events
        }
      };

      socket.onerror = () => {
        wsRef.current = null;
      };
      socket.onclose = (ev) => {
        // Ignore closes from sockets that no longer match the current project.
        if (selectedProjectIdRef.current !== socketProjectId) return;

        if (ev.code === 4401) {
          const role = getUser()?.role;
          clearSession();
          router.replace(getLoginPath(role));
          wsRef.current = null;
          return;
        }
        if (ev.code === 4403) {
          wsRef.current = null;
          setWsReconnecting(false);
          scheduleProjectRefresh();
          return;
        }
        wsRef.current = null;
        if (intentionalWsCloseRef.current || !token || !selectedProjectId) return;
        scheduleProjectRefresh();
        setWsReconnecting(true);
        const delay = Math.min(8000, 750 * Math.pow(2, reconnectAttemptsRef.current));
        reconnectAttemptsRef.current += 1;
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          connectSocket();
        }, delay);
      };
    } catch {
      wsRef.current = null;
    }
  }, [token, selectedProjectId, router, currentUser?.id, scheduleProjectRefresh, sortConversationsByActivity, matchesActiveInboxFilters, isMobile]);

  useEffect(() => {
    const user = getUser();
    const savedToken = getToken();
    if (!user || !savedToken || user.role !== "ADMIN") {
      router.replace("/admin/login");
      return;
    }
    getMe(savedToken)
      .then((me) => {
        if (me.role !== "ADMIN") {
          clearSession();
          router.replace("/admin/login");
          return;
        }
        setCurrentUser(me);
        setToken(savedToken);
      })
      .catch(() => {
        clearSession();
        router.replace("/admin/login");
      });
  }, [router]);

  useEffect(() => {
    if (token) loadProjects().catch((e) => setError(parseError(e)));
  }, [token, loadProjects]);

  useEffect(() => {
    if (token) loadGlobalUsers().catch((e) => setError(parseError(e)));
  }, [token, loadGlobalUsers]);

  useEffect(() => {
    if (token && selectedProjectId) loadProjectData().catch((e) => setError(parseError(e)));
  }, [token, selectedProjectId, loadProjectData]);

  useEffect(() => {
    if (token && selectedProjectId) {
      intentionalWsCloseRef.current = false;
      connectSocket();
      return () => {
        intentionalWsCloseRef.current = true;
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        if (refreshProjectTimerRef.current) {
          clearTimeout(refreshProjectTimerRef.current);
          refreshProjectTimerRef.current = null;
        }
        reconnectAttemptsRef.current = 0;
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }
      };
    }
  }, [token, selectedProjectId, connectSocket]);

  useEffect(() => {
    loadConversationMessages().catch((e) => setError(parseError(e)));
  }, [loadConversationMessages]);

  useEffect(() => {
    if (!token || !selectedProjectId) return;
    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      scheduleProjectRefresh();
    }, 2000);
    return () => clearInterval(interval);
  }, [token, selectedProjectId, scheduleProjectRefresh]);

  // Reset conversation & filter state when switching projects
  useEffect(() => {
    setSelectedConversationId(null);
    setMessages([]);
    setInboxFilterOperatorId(null);
    setInboxFilterMemberId(null);
    setInboxFilterType("");
    setInboxTab("active");
    setSearchResults(null);
    setExistingMemberId(null);
    setExistingMemberOperatorId(null);
    setMembers([]);
    setOperators([]);
    setOperatorsWithStatus([]);
    setAssignableOperators([]);
    setPresence({});
    setSelectedOperatorIds([]);
    setSelectedMemberIds([]);
    setSelectedConversationIds([]);
    setSelectedHistoryOperatorIds([]);
    setSelectedHistoryMemberIds([]);
    setHistoryBulkActionLoading(null);
  }, [selectedProjectId]);

  useEffect(() => {
    setTypingUserId(null);
    setSearchResults(null);
  }, [selectedConversationId]);

  useEffect(() => {
    setSelectedOperatorIds((prev) => prev.filter((id) => operators.some((o) => o.id === id)));
  }, [operators]);

  useEffect(() => {
    setSelectedMemberIds((prev) => prev.filter((id) => allMembers.some((m) => m.id === id)));
  }, [allMembers]);

  useEffect(() => {
    setSelectedConversationIds((prev) => prev.filter((id) => conversations.some((c) => c.id === id)));
  }, [conversations]);

  useEffect(() => {
    setSelectedHistoryOperatorIds((prev) => prev.filter((id) => historyOperators.some((o) => o.id === id)));
  }, [historyOperators]);

  useEffect(() => {
    setSelectedHistoryMemberIds((prev) => prev.filter((id) => historyMembers.some((m) => m.id === id)));
  }, [historyMembers]);

  useEffect(() => {
    if (activePanel !== "inbox") return;
    const visibleIds = new Set(visibleInboxConversations.map((c) => c.id));
    setSelectedConversationIds((prev) => prev.filter((id) => visibleIds.has(id)));
    if (selectedConversationId != null && !visibleIds.has(selectedConversationId)) {
      const fallbackConversationId =
        visibleInboxConversations.length > 0 ? visibleInboxConversations[0].id : null;
      setSelectedConversationId(fallbackConversationId);
      if (fallbackConversationId == null) {
        setMessages([]);
        setHasMoreOlder(false);
        if (isMobile) setMobileInboxChat(false);
      }
    }
  }, [
    activePanel,
    isMobile,
    selectedConversationId,
    visibleInboxConversations,
  ]);

  useEffect(() => {
    if (selectedConversationId == null) return;
    if (!conversations.some((c) => c.id === selectedConversationId)) {
      setSelectedConversationId(null);
      setMessages([]);
      setHasMoreOlder(false);
      if (isMobile) setMobileInboxChat(false);
    }
  }, [conversations, selectedConversationId, isMobile]);

  useEffect(() => {
    if (activePanel !== "inbox") return;
    if (selectedConversationId != null) return;
    if (visibleInboxConversations.length === 0) return;
    setSelectedConversationId(visibleInboxConversations[0].id);
  }, [activePanel, selectedConversationId, visibleInboxConversations]);

  useEffect(() => {
    setMemberReassignOp((prev) => {
      const valid = new Set(members.map((m) => m.id));
      const next: Record<number, number | null> = {};
      Object.entries(prev).forEach(([key, value]) => {
        const id = Number(key);
        if (valid.has(id)) next[id] = value;
      });
      return next;
    });
  }, [members]);

  useEffect(() => {
    setGlobalMemberAssignOp((prev) => {
      const valid = new Set(allMembers.map((m) => m.id));
      const next: Record<number, number | null> = {};
      Object.entries(prev).forEach(([key, value]) => {
        const id = Number(key);
        if (valid.has(id)) next[id] = value;
      });
      return next;
    });
  }, [allMembers]);

  useEffect(() => {
    if (!selectedProject) {
      setBrandingProjectNameInput("");
      setBrandingProjectLogoInput("");
      setOperatorTerminatedMessageInput("");
      setSupportEmailInput("");
      setSupportPhoneInput("");
      return;
    }
    setBrandingProjectNameInput(selectedProject.name || "");
    setBrandingProjectLogoInput(selectedProject.logo_url || "");
    setOperatorTerminatedMessageInput(selectedProject.operator_terminated_message || "");
    setSupportEmailInput(selectedProject.support_email || "");
    setSupportPhoneInput(selectedProject.support_phone || "");
  }, [selectedProject]);

  const sendTypingStart = useCallback(() => {
    if (!selectedConversationId || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ event: "typing_start", conversation_id: selectedConversationId }));
  }, [selectedConversationId]);

  const sendTypingStop = useCallback(() => {
    if (!selectedConversationId || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ event: "typing_stop", conversation_id: selectedConversationId }));
  }, [selectedConversationId]);

  const onChatInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setChatInput(e.target.value);
    if (e.target.value.trim()) {
      sendTypingStart();
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        sendTypingStop();
        typingTimeoutRef.current = null;
      }, 3000);
    }
  };

  const getConversationTarget = (conv: Conversation): { userId: number | null; label: string } => {
    if (conv.type === "admin_operator") {
      const op = knownUsers.get(conv.operator_id);
      return { userId: conv.operator_id, label: op?.name || `Operator #${conv.operator_id}` };
    }
    const memberId = conv.member_id;
    if (!memberId) return { userId: null, label: `Conversation #${conv.id}` };
    const member = knownUsers.get(memberId);
    return { userId: memberId, label: member?.name || `Member #${memberId}` };
  };

  const formatSender = (msg: Message): string => {
    if (currentUser && msg.sender_user_id === currentUser.id) return "You";
    const known = knownUsers.get(msg.sender_user_id);
    if (known) return known.name;
    if (msg.sender_role === "ADMIN") return "Admin";
    if (msg.sender_role === "OPERATOR") return `Operator #${msg.sender_user_id}`;
    return `Member #${msg.sender_user_id}`;
  };

  const onSendMessage = async () => {
    if (!token || !selectedProjectId || !selectedConversationId || !chatInput.trim()) return;
    const convAtSend = conversations.find((c) => c.id === selectedConversationId) || null;
    if (!convAtSend) {
      sendTypingStop();
      setError("Selected conversation is no longer available. Please select a conversation again.");
      await loadProjectData();
      return;
    }
    if (currentUser?.role === "ADMIN" && convAtSend.type === "operator_member") {
      sendTypingStop();
      setError("Admins cannot send direct chat messages in Operator ↔ Member conversations. Use Admin Broadcast to message members.");
      return;
    }
    sendTypingStop();
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    const content = chatInput.trim();
    setChatInput("");
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsPendingSendRef.current = { conversationId: selectedConversationId, content };
        wsRef.current.send(JSON.stringify({ event: "message", conversation_id: selectedConversationId, content }));
      } else {
        const message = await postMessage(token, selectedProjectId, selectedConversationId, content);
        setMessages((prev) => [...prev, message]);
        scrollToBottom();
      }
    } catch (e) {
      setChatInput((prev) => (prev.trim() ? prev : content));
      wsPendingSendRef.current = null;
      setError(parseError(e));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSendMessage();
    }
  };

  const onFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (selectedConversation?.type === "operator_member") {
      e.target.value = "";
      return;
    }
    const file = e.target.files?.[0];
    if (!file || !token || !selectedProjectId || !selectedConversationId) return;
    e.target.value = "";
    setUploading(true);
    setError(null);
    try {
      const msg = await uploadAttachment(token, selectedProjectId, selectedConversationId, file);
      setMessages((prev) => [...prev, msg]);
      scrollToBottom();
    } catch (err) {
      setError(parseError(err));
    } finally {
      setUploading(false);
    }
  };

  const onSearch = async () => {
    if (!token || !selectedProjectId) {
      setError("Select a project first.");
      return;
    }
    if (!searchQuery.trim()) {
      setError("Enter a search term first.");
      return;
    }
    try {
      const results = await searchMessages(token, selectedProjectId, searchQuery.trim());
      setSearchResults(results);
    } catch (err) {
      setError(parseError(err));
    }
  };

  const onLogout = () => {
    clearSession();
    router.replace("/admin/login");
  };

  const onBroadcast = async () => {
    if (!token || !selectedProjectId) {
      setError("Select a project first.");
      return;
    }
    if (!broadcastMessage.trim()) {
      setError("Write a broadcast message first.");
      return;
    }
    const memberRequested = broadcastAll || broadcastMemberId != null;
    const operatorRequested = broadcastAllOperators || broadcastOperatorId != null;
    if (!memberRequested && !operatorRequested) {
      setError("Select members and/or operators for the broadcast");
      return;
    }
    try {
      await broadcastMembers(token, selectedProjectId, {
        all_members: broadcastAll,
        member_ids: broadcastAll ? undefined : broadcastMemberId ? [broadcastMemberId] : undefined,
        all_operators: broadcastAllOperators,
        operator_ids: broadcastAllOperators ? undefined : broadcastOperatorId ? [broadcastOperatorId] : undefined,
        content: broadcastMessage.trim(),
        delivery_method: broadcastDeliveryMethod,
      });
      setBroadcastMessage("");
      setBroadcastMemberId(null);
      setBroadcastOperatorId(null);
      setBroadcastDeliveryMethod("chat");
      showNotice("Broadcast sent");
    } catch (e) {
      setError(parseError(e));
    }
  };

  const onCreateProject = async () => {
    if (!token) {
      setError("Session expired. Please log in again.");
      return;
    }
    if (!createProjectNameInput.trim()) {
      setError("Project name is required.");
      return;
    }
    await runProjectAction("project-create", async () => {
      try {
        const created = await createProject(token, {
          name: createProjectNameInput.trim(),
          logo_url: createProjectLogoInput || null,
          support_email: createProjectSupportEmail.trim() || null,
          support_phone: createProjectSupportPhone.trim() || null,
        });
        setCreateProjectNameInput("");
        setCreateProjectLogoInput("");
        setCreateProjectSupportEmail("");
        setCreateProjectSupportPhone("");
        setSelectedProjectId((prev) => prev ?? created.id);
        await Promise.all([loadProjects(), loadGlobalUsers()]);
        showNotice("Project created");
      } catch (e) {
        setError(parseError(e));
      }
    });
  };

  const onUpdateBranding = async () => {
    if (!token || !selectedProjectId) {
      setError("Select a project first.");
      return;
    }
    try {
      await updateProject(token, selectedProjectId, {
        name: brandingProjectNameInput.trim() || undefined,
        logo_url: brandingProjectLogoInput.trim() || undefined,
        operator_terminated_message: operatorTerminatedMessageInput,
        support_email: supportEmailInput.trim() || null,
        support_phone: supportPhoneInput.trim() || null,
      });
      await loadProjects();
      showNotice("Branding updated");
    } catch (e) {
      setError(parseError(e));
    }
  };

  const onUploadLogo = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!token || !selectedProjectId) {
      setError("Select a project first.");
      return;
    }
    try {
      await uploadProjectLogo(token, selectedProjectId, file);
      await loadProjects();
      showNotice("Logo uploaded successfully");
    } catch (err) {
      setError(parseError(err));
    }
    if (logoInputRef.current) logoInputRef.current.value = "";
  };

  const onRemoveLogo = async () => {
    if (!token || !selectedProjectId) {
      setError("Select a project first.");
      return;
    }
    try {
      await deleteProjectLogo(token, selectedProjectId);
      await loadProjects();
      showNotice("Logo removed");
    } catch (err) {
      setError(parseError(err));
    }
  };

  const onDeleteProject = async (proj: Project) => {
    if (!token) return;
    if (!(await confirm({ message: `Archive "${proj.name}"? Users and history will stay in the system for reuse.`, confirmText: "Archive", tone: "danger" }))) return;
    await runProjectAction(`project-archive-${proj.id}`, async () => {
      try {
        await deleteProject(token, proj.id);
        if (selectedProjectId === proj.id) {
          setSelectedProjectId(null);
          setSelectedConversationId(null);
          setConversations([]);
          setMessages([]);
          setMembers([]);
          setOperators([]);
          setPresence({});
        }
        await Promise.all([loadProjects(), loadGlobalUsers(), selectedProjectId ? loadProjectData() : Promise.resolve()]);
        showNotice("Project archived");
      } catch (e) {
        setError(parseError(e));
      }
    });
  };

  const onPermanentlyDeleteProject = async (proj: Project) => {
    if (!token) return;
    if (
      !(await confirm({
        message: `Permanently delete "${proj.name}"? Project chats/history will be removed forever, but operator/member accounts will stay in the system.`,
        confirmText: "Delete permanently",
        tone: "danger",
      }))
    )
      return;
    await runProjectAction(`project-delete-${proj.id}`, async () => {
      try {
        await permanentlyDeleteProject(token, proj.id);
        if (selectedProjectId === proj.id) {
          setSelectedProjectId(null);
          setSelectedConversationId(null);
          setConversations([]);
          setMessages([]);
          setMembers([]);
          setOperators([]);
          setPresence({});
        }
        await Promise.all([loadProjects(), loadGlobalUsers(), selectedProjectId ? loadProjectData() : Promise.resolve()]);
        showNotice("Project permanently deleted");
      } catch (e) {
        setError(parseError(e));
      }
    });
  };

  const onToggleProjectActive = async (proj: Project) => {
    if (!token) return;
    const action = proj.is_active ? "deactivate" : "activate";
    if (!(await confirm({ message: `Are you sure you want to ${action} "${proj.name}"?`, confirmText: action === "deactivate" ? "Deactivate" : "Activate", tone: action === "deactivate" ? "danger" : "admin" }))) return;
    await runProjectAction(`project-toggle-${proj.id}`, async () => {
      try {
        if (proj.is_active) await deactivateProject(token, proj.id);
        else await activateProject(token, proj.id);

        if (selectedProjectId === proj.id && proj.is_active) {
          setSelectedProjectId(null);
          setSelectedConversationId(null);
          setConversations([]);
          setMessages([]);
        }
        await Promise.all([loadProjects(), loadGlobalUsers(), selectedProjectId ? loadProjectData() : Promise.resolve()]);
        showNotice(`Project ${action}d`);
      } catch (e) {
        setError(parseError(e));
      }
    });
  };

  const onAssignOperator = async () => {
    if (!token || !selectedProjectId) {
      setError("Select a project first.");
      return;
    }
    if (!assignOperatorId) {
      setError("Select an operator to assign.");
      return;
    }
    try {
      await assignOperator(token, selectedProjectId, assignOperatorId);
      setAssignOperatorId(null);
      await loadProjectData();
      showNotice("Operator assigned");
    } catch (e) {
      setError(parseError(e));
    }
  };

  const onAssignOperatorRow = async (operatorId: number) => {
    if (!token || !selectedProjectId) {
      setError("Select a project first.");
      return;
    }
    try {
      await assignOperator(token, selectedProjectId, operatorId);
      await loadProjectData();
      showNotice("Operator assigned");
    } catch (e) {
      setError(parseError(e));
    }
  };

  const onRemoveOperator = async (opId: number) => {
    if (!token || !selectedProjectId) {
      setError("Select a project first.");
      return;
    }
    try {
      await removeOperator(token, selectedProjectId, opId);
      await loadProjectData();
      showNotice("Operator removed");
    } catch (e) {
      setError(parseError(e));
    }
  };

  const onRemoveMember = async (memberId: number) => {
    if (!token || !selectedProjectId) {
      setError("Select a project first.");
      return;
    }
    if (!(await confirm({ message: "Remove this member from their assigned operator?", confirmText: "Remove", tone: "danger" }))) return;
    try {
      await removeMember(token, selectedProjectId, memberId);
      await loadProjectData();
      showNotice("Member removed");
    } catch (e) {
      setError(parseError(e));
    }
  };

  const onTerminateUser = async (userId: number) => {
    if (!token || !selectedProjectId) {
      setError("Select a project first.");
      return;
    }
    if (
      !(await confirm({
        message: "Terminate this user in the current project? Account remains in system and can be reassigned later.",
        confirmText: "Terminate",
        tone: "danger",
      }))
    )
      return;
    try {
      await terminateUser(token, selectedProjectId, userId);
      await loadProjectData();
      showNotice("User terminated in this project");
    } catch (e) {
      setError(parseError(e));
    }
  };

  const onDeactivateGlobally = async (userId: number, isActive?: boolean) => {
    if (!token) {
      setError("Session expired. Please log in again.");
      return;
    }
    if (isActive === false) {
      showNotice("This user is already deleted globally.");
      return;
    }
    if (deactivatingUserIds.includes(userId)) return;
    if (!(await confirm({ message: "Deactivate this user globally across ALL projects? This cannot be easily undone.", confirmText: "Deactivate", tone: "danger" }))) return;
    setDeactivatingUserIds((prev) => [...prev, userId]);
    try {
      await deactivateUserGlobally(token, userId);
      await Promise.all([loadProjectData(), loadGlobalUsers()]);
      setSelectedOperatorIds((prev) => prev.filter((id) => id !== userId));
      setSelectedMemberIds((prev) => prev.filter((id) => id !== userId));
      showNotice("User deactivated globally");
    } catch (e) {
      setError(parseError(e));
    } finally {
      setDeactivatingUserIds((prev) => prev.filter((id) => id !== userId));
    }
  };

  const onPermanentlyDeleteUser = async (userId: number, name: string) => {
    if (!token) {
      setError("Session expired. Please log in again.");
      return;
    }
    if (permanentlyDeletingUserIds.includes(userId)) return;
    if (
      !(await confirm({
        message: `Permanently delete "${name}" from the system? This cannot be undone and removes this user from Past / Deleted.`,
        confirmText: "Delete permanently",
        tone: "danger",
      }))
    ) {
      return;
    }
    setPermanentlyDeletingUserIds((prev) => [...prev, userId]);
    try {
      await permanentlyDeleteUser(token, userId);
      await Promise.all([loadProjectData(), loadGlobalUsers()]);
      setSelectedOperatorIds((prev) => prev.filter((id) => id !== userId));
      setSelectedMemberIds((prev) => prev.filter((id) => id !== userId));
      showNotice("User permanently deleted");
    } catch (e) {
      setError(parseError(e));
    } finally {
      setPermanentlyDeletingUserIds((prev) => prev.filter((id) => id !== userId));
    }
  };

  const onBulkDeactivateOperators = async () => {
    if (!token) {
      setError("Session expired. Please log in again.");
      return;
    }
    if (selectedOperatorIds.length === 0) {
      setError("Select at least one operator first.");
      return;
    }
    if (!(await confirm({ message: `Deactivate ${selectedOperatorIds.length} selected operator account(s) globally?`, confirmText: "Deactivate", tone: "danger" }))) return;
    try {
      await deactivateUsersGloballyBulk(token, selectedOperatorIds);
      setSelectedOperatorIds([]);
      await Promise.all([loadProjectData(), loadGlobalUsers()]);
      showNotice("Selected operators deactivated globally");
    } catch (e) {
      setError(parseError(e));
    }
  };

  const onBulkDeactivateMembers = async () => {
    if (!token) {
      setError("Session expired. Please log in again.");
      return;
    }
    if (selectedMemberIds.length === 0) {
      setError("Select at least one member first.");
      return;
    }
    if (!(await confirm({ message: `Deactivate ${selectedMemberIds.length} selected member account(s) globally?`, confirmText: "Deactivate", tone: "danger" }))) return;
    try {
      await deactivateUsersGloballyBulk(token, selectedMemberIds);
      setSelectedMemberIds([]);
      await Promise.all([loadProjectData(), loadGlobalUsers()]);
      showNotice("Selected members deactivated globally");
    } catch (e) {
      setError(parseError(e));
    }
  };

  const onBulkDeactivateHistoryOperators = async () => {
    if (!token) {
      setError("Session expired. Please log in again.");
      return;
    }
    if (historyBulkActionLoading) return;
    const activeSet = new Set(historyActiveOperatorIds);
    const selectedIds = selectedHistoryOperatorIds.filter((id) => activeSet.has(id));
    if (selectedIds.length === 0) {
      setError("Select at least one active operator in Past / Deleted.");
      return;
    }
    if (!(await confirm({ message: `Delete globally ${selectedIds.length} selected operator account(s)?`, confirmText: "Delete globally", tone: "danger" }))) return;
    setHistoryBulkActionLoading("operators-global");
    try {
      await deactivateUsersGloballyBulk(token, selectedIds);
      await Promise.all([loadProjectData(), loadGlobalUsers()]);
      const removed = new Set(selectedIds);
      setSelectedHistoryOperatorIds((prev) => prev.filter((id) => !removed.has(id)));
      showNotice("Selected operators deleted globally");
    } catch (e) {
      setError(parseError(e));
    } finally {
      setHistoryBulkActionLoading(null);
    }
  };

  const onBulkPermanentlyDeleteHistoryOperators = async () => {
    if (!token) {
      setError("Session expired. Please log in again.");
      return;
    }
    if (historyBulkActionLoading) return;
    const deletedSet = new Set(historyDeletedOperatorIds);
    const selectedIds = selectedHistoryOperatorIds.filter((id) => deletedSet.has(id));
    if (selectedIds.length === 0) {
      setError("Select at least one globally deleted operator to permanently delete.");
      return;
    }
    if (!(await confirm({ message: `Permanently delete ${selectedIds.length} selected operator account(s)? This cannot be undone.`, confirmText: "Delete permanently", tone: "danger" }))) return;
    setHistoryBulkActionLoading("operators-permanent");
    try {
      await permanentlyDeleteUsersBulk(token, selectedIds);
      await Promise.all([loadProjectData(), loadGlobalUsers()]);
      const removed = new Set(selectedIds);
      setSelectedHistoryOperatorIds((prev) => prev.filter((id) => !removed.has(id)));
      showNotice("Selected operators permanently deleted");
    } catch (e) {
      setError(parseError(e));
    } finally {
      setHistoryBulkActionLoading(null);
    }
  };

  const onBulkDeactivateHistoryMembers = async () => {
    if (!token) {
      setError("Session expired. Please log in again.");
      return;
    }
    if (historyBulkActionLoading) return;
    const activeSet = new Set(historyActiveMemberIds);
    const selectedIds = selectedHistoryMemberIds.filter((id) => activeSet.has(id));
    if (selectedIds.length === 0) {
      setError("Select at least one active member in Past / Deleted.");
      return;
    }
    if (!(await confirm({ message: `Delete globally ${selectedIds.length} selected member account(s)?`, confirmText: "Delete globally", tone: "danger" }))) return;
    setHistoryBulkActionLoading("members-global");
    try {
      await deactivateUsersGloballyBulk(token, selectedIds);
      await Promise.all([loadProjectData(), loadGlobalUsers()]);
      const removed = new Set(selectedIds);
      setSelectedHistoryMemberIds((prev) => prev.filter((id) => !removed.has(id)));
      showNotice("Selected members deleted globally");
    } catch (e) {
      setError(parseError(e));
    } finally {
      setHistoryBulkActionLoading(null);
    }
  };

  const onBulkPermanentlyDeleteHistoryMembers = async () => {
    if (!token) {
      setError("Session expired. Please log in again.");
      return;
    }
    if (historyBulkActionLoading) return;
    const deletedSet = new Set(historyDeletedMemberIds);
    const selectedIds = selectedHistoryMemberIds.filter((id) => deletedSet.has(id));
    if (selectedIds.length === 0) {
      setError("Select at least one globally deleted member to permanently delete.");
      return;
    }
    if (!(await confirm({ message: `Permanently delete ${selectedIds.length} selected member account(s)? This cannot be undone.`, confirmText: "Delete permanently", tone: "danger" }))) return;
    setHistoryBulkActionLoading("members-permanent");
    try {
      await permanentlyDeleteUsersBulk(token, selectedIds);
      await Promise.all([loadProjectData(), loadGlobalUsers()]);
      const removed = new Set(selectedIds);
      setSelectedHistoryMemberIds((prev) => prev.filter((id) => !removed.has(id)));
      showNotice("Selected members permanently deleted");
    } catch (e) {
      setError(parseError(e));
    } finally {
      setHistoryBulkActionLoading(null);
    }
  };

  const onDeleteConversation = async (scope: "me" | "all") => {
    if (!token || !selectedProjectId || !selectedConversationId || !selectedConversation) {
      setError("Select a conversation first.");
      return;
    }
    if (scope === "me" && selectedConversation.type !== "admin_operator") {
      setError("Delete for me is available only for Admin ↔ Operator conversations.");
      return;
    }
    if (
      !(await confirm({
        message:
          scope === "me"
            ? "Clear this chat history for your admin view only?"
            : "Clear this chat history for everyone in this conversation? This cannot be undone.",
        confirmText: "Clear",
        tone: "danger",
      }))
    )
      return;
    try {
      await deleteConversation(token, selectedProjectId, selectedConversationId, scope);
      setMessages([]);
      setHasMoreOlder(false);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedConversationId
            ? {
                ...c,
                unread_count: 0,
                last_message_at: null,
              }
            : c,
        ),
      );
      showNotice(scope === "me" ? "Chat history cleared for you" : "Chat history cleared for all participants");
    } catch (e) {
      setError(parseError(e));
    }
  };

  const onBulkDeleteConversations = async () => {
    if (!token || !selectedProjectId) {
      setError("Select a project first.");
      return;
    }
    if (inboxBulkActionLoading) return;
    const visibleIds = new Set(visibleInboxConversations.map((conv) => conv.id));
    const selectedVisibleIds = selectedConversationIds.filter((id) => visibleIds.has(id));
    if (selectedVisibleIds.length === 0) {
      setError("Select at least one visible conversation first.");
      return;
    }
    if (
      !(await confirm({
        message: `Clear ${selectedVisibleIds.length} selected chat(s) for all participants? This cannot be undone.`,
        confirmText: "Clear",
        tone: "danger",
      }))
    )
      return;
    setInboxBulkActionLoading("clear");
    try {
      await clearConversationsBulk(token, selectedProjectId, selectedVisibleIds);
      const clearedIds = new Set(selectedVisibleIds);
      setConversations((prev) =>
        prev.map((c) =>
          clearedIds.has(c.id)
            ? {
                ...c,
                unread_count: 0,
                last_message_at: null,
              }
            : c,
        ),
      );
      if (selectedConversationId != null && clearedIds.has(selectedConversationId)) {
        setMessages([]);
        setHasMoreOlder(false);
      }
      setSelectedConversationIds((prev) => prev.filter((id) => !clearedIds.has(id)));
      showNotice("Selected chats cleared for all participants");
    } catch (e) {
      setError(parseError(e));
    } finally {
      setInboxBulkActionLoading(null);
    }
  };

  const onBulkHideConversations = async () => {
    if (!token || !selectedProjectId) {
      setError("Select a project first.");
      return;
    }
    if (inboxBulkActionLoading) return;
    const visibleIds = new Set(visibleInboxConversations.map((conv) => conv.id));
    const selectedVisibleIds = selectedConversationIds.filter((id) => visibleIds.has(id));
    if (selectedVisibleIds.length === 0) {
      setError("Select at least one visible conversation first.");
      return;
    }
    const selectedConversations = visibleInboxConversations.filter((conv) =>
      selectedVisibleIds.includes(conv.id),
    );
    const hideableIds = selectedConversations
      .filter((conv) => conv.type === "operator_member")
      .map((conv) => conv.id);
    if (hideableIds.length === 0) {
      setError("Hide selected works for member conversations only.");
      return;
    }
    if (
      !(await confirm({
        message: `Hide ${hideableIds.length} selected member conversation(s) from admin inbox only? Messages will stay intact.`,
        confirmText: "Hide",
        tone: "admin",
      }))
    ) {
      return;
    }
    setInboxBulkActionLoading("hide");
    try {
      await hideConversationsBulk(token, selectedProjectId, hideableIds);
      const hiddenIds = new Set(hideableIds);
      setConversations((prev) => prev.filter((conv) => !hiddenIds.has(conv.id)));
      if (selectedConversationId != null && hiddenIds.has(selectedConversationId)) {
        setSelectedConversationId(null);
        setMessages([]);
        setHasMoreOlder(false);
      }
      setSelectedConversationIds((prev) => prev.filter((id) => !hiddenIds.has(id)));
      if (hideableIds.length !== selectedVisibleIds.length) {
        showNotice("Member chats hidden. Admin-operator chats stay visible.");
      } else {
        showNotice("Selected member chats hidden from admin inbox");
      }
    } catch (e) {
      setError(parseError(e));
    } finally {
      setInboxBulkActionLoading(null);
    }
  };

  const onAdminCreateMember = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !selectedProjectId) {
      setError("Select a project first.");
      return;
    }
    if (!newMemberName.trim() || !newMemberEmail.trim() || !newMemberPassword.trim()) {
      setError("Name, email, and password are required.");
      return;
    }
    if (!newMemberOperatorId) {
      setError("Select an operator for this new member");
      return;
    }
    if (memberCreateLoading) return;
    setMemberCreateLoading(true);
    try {
      await adminCreateMember(token, selectedProjectId, {
        operator_id: newMemberOperatorId,
        name: newMemberName.trim(),
        email: newMemberEmail.trim(),
        password: newMemberPassword,
      });
      setNewMemberName("");
      setNewMemberEmail("");
      setNewMemberPassword("");
      setNewMemberOperatorId(null);
      await Promise.all([loadProjectData(), loadGlobalUsers(), loadProjects()]);
      showNotice("Member created");
    } catch (e) {
      setError(parseError(e));
    } finally {
      setMemberCreateLoading(false);
    }
  };

  const onAttachExistingMember = async () => {
    if (!token || !selectedProjectId) {
      setError("Select a project first.");
      return;
    }
    if (!existingMemberId || !existingMemberOperatorId) {
      setError("Select an existing member and operator");
      return;
    }
    try {
      await adminAssignMemberOperator(
        token,
        selectedProjectId,
        existingMemberId,
        existingMemberOperatorId,
      );
      setExistingMemberId(null);
      setExistingMemberOperatorId(null);
      await Promise.all([loadProjectData(), loadGlobalUsers(), loadProjects()]);
      showNotice("Existing member added to project");
    } catch (e) {
      setError(parseError(e));
    }
  };

  const onReassignMember = async (memberId: number) => {
    if (!token || !selectedProjectId) {
      setError("Select a project first.");
      return;
    }
    const opId = memberReassignOp[memberId];
    if (opId == null) {
      setError("Select an operator first.");
      return;
    }
    try {
      await adminAssignMemberOperator(token, selectedProjectId, memberId, Number(opId));
      await Promise.all([loadProjectData(), loadGlobalUsers()]);
      showNotice("Member reassigned");
    } catch (e) {
      setError(parseError(e));
    }
  };

  const onAssignGlobalMember = async (memberId: number) => {
    if (!token || !selectedProjectId) {
      setError("Select a project first.");
      return;
    }
    const opId = globalMemberAssignOp[memberId];
    if (opId == null) {
      setError("Select operator first");
      return;
    }
    try {
      await adminAssignMemberOperator(token, selectedProjectId, memberId, Number(opId));
      setGlobalMemberAssignOp((prev) => ({ ...prev, [memberId]: null }));
      await Promise.all([loadProjectData(), loadGlobalUsers()]);
      showNotice("Member assigned");
    } catch (e) {
      setError(parseError(e));
    }
  };

  const onCreateUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) {
      setError("Session expired. Please log in again.");
      return;
    }
    if (!newUserName.trim() || !newUserEmail.trim() || !newUserPassword.trim()) {
      setError("Name, email, and password are required.");
      return;
    }
    try {
      await createUser(token, {
        name: newUserName.trim(),
        email: newUserEmail.trim(),
        password: newUserPassword,
        role: newUserRole,
      });
      setNewUserName("");
      setNewUserEmail("");
      setNewUserPassword("");
      setNewUserRole("OPERATOR");
      await Promise.all([loadProjectData(), loadGlobalUsers()]);
      showNotice(newUserRole === "ADMIN" ? "Admin created" : "Operator created");
    } catch (e) {
      setError(parseError(e));
    }
  };

  const onChangePassword = async () => {
    if (!token) {
      setError("Session expired. Please log in again.");
      return;
    }
    if (!changePwUserId) {
      setError("Select a user first.");
      return;
    }
    const next = changePwValue.trim();
    if (next.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    try {
      await changeUserPassword(token, changePwUserId, next);
      setChangePwUserId(null);
      setChangePwValue("");
      showNotice("Password updated successfully");
    } catch (e) {
      setError(parseError(e));
    }
  };

  const onChangeMyPassword = async () => {
    if (!token) return;
    if (myNewPw.trim().length < 6) {
      setError("New password must be at least 6 characters");
      return;
    }
    try {
      await changeMyPassword(token, myCurrentPw, myNewPw.trim());
      setMyCurrentPw("");
      setMyNewPw("");
      showNotice("Your password has been updated");
    } catch (e) {
      setError(parseError(e));
    }
  };

  const onResetAdminPassword = async () => {
    if (!token) {
      setError("Session expired. Please log in again.");
      return;
    }
    if (!adminResetUserId) {
      setError("Select an admin first.");
      return;
    }
    if (adminResetPw.trim().length < 6) {
      setError("New password must be at least 6 characters");
      return;
    }
    try {
      await resetAdminPassword(token, adminResetUserId, adminResetPw.trim());
      setAdminResetUserId(null);
      setAdminResetPw("");
      showNotice("Admin password reset successfully");
    } catch (e) {
      setError(parseError(e));
    }
  };

  const toggleOperatorSelection = (userId: number, checked: boolean) => {
    setSelectedOperatorIds((prev) => {
      if (checked) {
        if (prev.includes(userId)) return prev;
        return [...prev, userId];
      }
      return prev.filter((id) => id !== userId);
    });
  };

  const toggleMemberSelection = (userId: number, checked: boolean) => {
    setSelectedMemberIds((prev) => {
      if (checked) {
        if (prev.includes(userId)) return prev;
        return [...prev, userId];
      }
      return prev.filter((id) => id !== userId);
    });
  };

  const toggleConversationSelection = (conversationId: number, checked: boolean) => {
    setSelectedConversationIds((prev) => {
      if (checked) {
        if (prev.includes(conversationId)) return prev;
        return [...prev, conversationId];
      }
      return prev.filter((id) => id !== conversationId);
    });
  };

  const toggleHistoryOperatorSelection = (userId: number, checked: boolean) => {
    setSelectedHistoryOperatorIds((prev) => {
      if (checked) {
        if (prev.includes(userId)) return prev;
        return [...prev, userId];
      }
      return prev.filter((id) => id !== userId);
    });
  };

  const toggleHistoryMemberSelection = (userId: number, checked: boolean) => {
    setSelectedHistoryMemberIds((prev) => {
      if (checked) {
        if (prev.includes(userId)) return prev;
        return [...prev, userId];
      }
      return prev.filter((id) => id !== userId);
    });
  };

  if (!currentUser) {
    return (
      <main className="h-screen flex items-center justify-center bg-bg-deep">
        <LoadingState label="Loading…" />
      </main>
    );
  }

  const navItems: [Panel, string, React.ReactNode][] = [
    ["dashboard", "Dashboard", <GridIcon key="i" className="w-4.5 h-4.5" />],
    ["inbox", "Inbox", <InboxIcon key="i" className="w-4.5 h-4.5" />],
    ["broadcast", "Broadcast", <MegaphoneIcon key="i" className="w-4.5 h-4.5" />],
    ["operators", "Operators", <HeadsetIcon key="i" className="w-4.5 h-4.5" />],
    ["members", "Members", <UsersIcon key="i" className="w-4.5 h-4.5" />],
    ["history", "Past / Deleted", <HistoryIcon key="i" className="w-4.5 h-4.5" />],
    ["projects", "Projects", <FolderIcon key="i" className="w-4.5 h-4.5" />],
    ["branding", "Branding", <ImageIcon key="i" className="w-4.5 h-4.5" />],
    ["users", "User Mgmt", <KeyIcon key="i" className="w-4.5 h-4.5" />],
    ["analytics", "Analytics", <ChartBarIcon key="i" className="w-4.5 h-4.5" />],
    ["chatHistory", "Chat History", <ChatBubbleIcon key="i" className="w-4.5 h-4.5" />],
  ];

  return (
    <main className="h-screen flex flex-col bg-bg-deep">
      <ToastStack
        toasts={[
          !!notice && { id: "notice", message: notice, variant: "success" },
          !!error && { id: "error", message: error, variant: "error", onDismiss: () => setError(null) },
          wsReconnecting && { id: "ws", message: "Reconnecting to live chat…", variant: "warning" },
          dataLoading && !!selectedProjectId && { id: "loading", message: "Loading project data…", variant: "info" },
        ]}
      />
      {isMobile && mobileSidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          aria-label="Close menu"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      <header className="h-16 shrink-0 border-b border-white/10 bg-bg-navy flex items-center justify-between px-4">
        <div className="flex items-center gap-3 min-w-0">
          <IconButton
            aria-label="Open menu"
            className="md:hidden"
            onClick={() => setMobileSidebarOpen(true)}
          >
            <MenuIcon />
          </IconButton>
          <div className="flex items-center gap-3 min-w-0">
            {selectedProject?.logo_url ? (
              <img src={selectedProject.logo_url} alt={selectedProject.name} className="h-11 w-11 rounded-lg object-cover" />
            ) : (
              <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-admin to-admin-dark flex items-center justify-center text-white">
                <FolderIcon className="w-5 h-5" />
              </div>
            )}
            <span className="font-semibold text-lg text-white truncate hidden sm:inline">
              {selectedProject?.name || "Admin Dashboard"}
            </span>
          </div>
          <div className="h-5 w-px bg-white/[0.1] hidden sm:block" />
          <select
            value={selectedProjectId ?? ""}
            onChange={(e) => setSelectedProjectId(e.target.value ? Number(e.target.value) : null)}
            className="text-sm border border-white/10 rounded-lg px-2 py-1.5 outline-none focus:border-admin cursor-pointer max-w-[9rem] sm:max-w-none bg-bg-navy text-white [color-scheme:dark]"
          >
            <option value="">No active project</option>
            {projects.filter((p) => p.is_active).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          {selectedProjectId && token && (
            <NotificationBell
              token={token}
              projectId={selectedProjectId}
              wsMessageKey={wsNotifKey}
              onNotificationClick={(refId) => {
                if (refId) {
                  setActivePanel("inbox");
                  const conv = conversations.find((c) => c.id === refId) || null;
                  if (conv?.type === "admin_operator" && terminatedOperatorIds.has(conv.operator_id)) {
                    switchInboxTab("terminated", refId);
                  } else {
                    switchInboxTab("active", refId);
                  }
                  if (isMobile) setMobileInboxChat(true);
                }
              }}
            />
          )}
          <div className="flex items-center gap-2 text-sm">
            <PresenceDot online={true} />
            <span className="text-slate-300 font-medium hidden sm:inline">{currentUser.name}</span>
            <Badge color="emerald">ADMIN</Badge>
          </div>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <aside
          className={`w-56 shrink-0 border-r border-white/10 bg-bg-navy flex flex-col z-50 md:z-auto
            ${isMobile ? (mobileSidebarOpen ? "fixed top-16 left-0 bottom-0 flex shadow-xl" : "hidden") : "flex"}
            md:flex`}
        >
          <nav className="flex-1 p-3 space-y-1">
            {navItems.map(([key, label, icon]) => (
              <button
                key={key}
                onClick={() => {
                  setActivePanel(key);
                  setMobileSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  activePanel === key ? "bg-admin-light text-admin" : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                {icon}
                {label}
              </button>
            ))}
          </nav>
          <div className="p-3 border-t border-white/5">
            <Button
              variant="ghost"
              tone="danger"
              fullWidth
              className="justify-start"
              leftIcon={<LogoutIcon />}
              onClick={onLogout}
            >
              Logout
            </Button>
          </div>
        </aside>

        {/* DASHBOARD */}
        {activePanel === "dashboard" && token && (
          <section className="flex-1 overflow-y-auto">
            <AdminDashboardHome token={token} currentUser={currentUser} projects={projects} selectedProjectId={selectedProjectId} />
          </section>
        )}

        {/* INBOX */}
        {activePanel === "inbox" && (
          <div className="flex-1 flex min-h-0 min-w-0">
            <aside
              className={`w-full md:w-80 shrink-0 border-r border-white/10 bg-bg-navy flex flex-col min-h-0 ${
                isMobile && mobileInboxChat ? "hidden md:flex" : "flex"
              }`}
            >
              <div className="px-4 py-3 border-b border-white/5 space-y-2.5">
                <h2 className="text-sm font-semibold text-white">Conversations</h2>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => switchInboxTab("active")}
                    className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors cursor-pointer ${
                      inboxTab === "active"
                        ? "border-admin/30 bg-admin-light text-admin"
                        : "border-white/10 text-slate-400 hover:bg-white/5"
                    }`}
                  >
                    Active Inbox ({activeInboxConversations.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => switchInboxTab("terminated")}
                    className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors cursor-pointer ${
                      inboxTab === "terminated"
                        ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                        : "border-white/10 text-slate-400 hover:bg-white/5"
                    }`}
                  >
                    Terminated Inbox ({terminatedInboxConversations.length})
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <Select
                    tone="admin"
                    value={inboxFilterOperatorId ?? ""}
                    onChange={(e) => setInboxFilterOperatorId(e.target.value ? Number(e.target.value) : null)}
                    className="col-span-1 text-xs px-2 py-1.5"
                  >
                    <option value="">All operators</option>
                    {operators.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </Select>
                  <Select
                    tone="admin"
                    value={inboxFilterMemberId ?? ""}
                    onChange={(e) => setInboxFilterMemberId(e.target.value ? Number(e.target.value) : null)}
                    className="col-span-1 text-xs px-2 py-1.5"
                  >
                    <option value="">All members</option>
                    {activeProjectMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                  <Select
                    tone="admin"
                    value={inboxFilterType}
                    onChange={(e) => setInboxFilterType(e.target.value)}
                    className="col-span-1 text-xs px-2 py-1.5"
                  >
                    <option value="">All types</option>
                    <option value="admin_operator">Admin ↔ Operator</option>
                    <option value="operator_member">Operator ↔ Member</option>
                  </Select>
                </div>

                <div className="flex gap-1.5">
                  <SearchInput
                    tone="admin"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && onSearch()}
                    placeholder="Search messages…"
                    className="flex-1"
                  />
                  <Button tone="admin" variant="subtle" size="sm" onClick={onSearch}>
                    Search
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {visibleInboxConversations.length > 0 && (
                  <div className="px-4 py-2 border-b border-white/5 bg-bg-deep flex items-center justify-between gap-3">
                    <label className="text-xs text-slate-300 inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={allVisibleConversationsSelected}
                        onChange={(e) =>
                          setSelectedConversationIds(
                            e.target.checked ? visibleInboxConversations.map((conv) => conv.id) : [],
                          )
                        }
                      />
                      Select all
                    </label>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        tone="neutral"
                        size="sm"
                        disabled={selectedVisibleConversationCount === 0 || inboxBulkActionLoading !== null}
                        onClick={onBulkHideConversations}
                      >
                        {inboxBulkActionLoading === "hide"
                          ? "Hiding…"
                          : `Hide selected (${selectedVisibleConversationCount})`}
                      </Button>
                      <Button
                        variant="outline"
                        tone="danger"
                        size="sm"
                        disabled={selectedVisibleConversationCount === 0 || inboxBulkActionLoading !== null}
                        onClick={onBulkDeleteConversations}
                      >
                        {inboxBulkActionLoading === "clear"
                          ? "Deleting…"
                          : `Delete selected (${selectedVisibleConversationCount})`}
                      </Button>
                    </div>
                  </div>
                )}
                {visibleInboxConversations.map((conv) => {
                  const target = getConversationTarget(conv);
                  const isActive = conv.id === selectedConversationId;
                  const unread = conv.unread_count || 0;
                  return (
                    <div
                      key={conv.id}
                      className={`flex items-center gap-3 px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors ${
                        isActive ? "bg-admin-light" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedConversationIds.includes(conv.id)}
                        onChange={(e) => toggleConversationSelection(conv.id, e.target.checked)}
                        className="shrink-0"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedConversationId(conv.id);
                          if (isMobile) setMobileInboxChat(true);
                        }}
                        className="flex-1 min-w-0 text-left cursor-pointer"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Avatar name={target.label} tone="neutral" size="sm" />
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-white truncate">{target.label}</div>
                              <div className="text-xs text-slate-500">
                                {conv.type === "admin_operator" ? "Admin ↔ Operator" : "Operator ↔ Member"}
                              </div>
                            </div>
                          </div>
                          {unread > 0 && (
                            <Badge color="emerald" className="px-1.5 py-0 min-w-[1.25rem] justify-center">
                              {unread}
                            </Badge>
                          )}
                        </div>
                      </button>
                    </div>
                  );
                })}
                {visibleInboxConversations.length === 0 && !searchResults && (
                  <EmptyState icon={<InboxIcon />} title="No conversations in this tab" />
                )}

                {searchResults !== null && (
                  <div className="px-4 py-3 border-t border-white/5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-slate-400">Search results</span>
                      <button onClick={() => setSearchResults(null)} className="text-xs text-slate-500 hover:text-slate-300 cursor-pointer">
                        Close
                      </button>
                    </div>
                    <div className="max-h-40 overflow-y-auto space-y-2">
                      {searchResults.length === 0 ? (
                        <p className="text-xs text-slate-500">No matches</p>
                      ) : (
                        searchResults.map((m) => (
                          <div key={m.id} className="text-xs p-2 rounded-lg bg-bg-deep border border-white/5">
                            <p className="text-slate-300 line-clamp-2">{m.content || "(attachment)"}</p>
                            <span className="text-slate-500">
                              {formatSender(m)} · {new Date(m.created_at).toLocaleString()}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </aside>

            <section
              className={`flex-1 flex flex-col min-h-0 bg-bg-deep min-w-0 ${
                isMobile && !mobileInboxChat ? "hidden md:flex" : "flex"
              }`}
            >
              {selectedConversation ? (
                <>
                  <div className="h-14 shrink-0 border-b border-white/10 bg-bg-navy flex items-center justify-between px-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <IconButton
                        aria-label="Back to conversations"
                        className="md:hidden"
                        onClick={() => setMobileInboxChat(false)}
                      >
                        <ChevronLeftIcon />
                      </IconButton>
                      <Avatar name={getConversationTarget(selectedConversation).label} tone="admin" size="sm" />
                      <div>
                        <div className="text-sm font-medium text-white">{getConversationTarget(selectedConversation).label}</div>
                        <div className="text-xs text-slate-500">{selectedConversation.type === "admin_operator" ? "Admin ↔ Operator" : "Operator ↔ Member"}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {(() => {
                        const t = getConversationTarget(selectedConversation);
                        const tp = t.userId ? presence[t.userId] : null;
                        if (!tp) return null;
                        return (
                          <span className={`text-xs flex items-center gap-1.5 ${tp.is_online ? "text-emerald-400" : "text-slate-500"}`}>
                            <PresenceDot online={tp.is_online} />
                            {tp.is_online ? "Online" : "Offline"}
                          </span>
                        );
                      })()}
                      {selectedConversation.type === "admin_operator" && (
                        <Button variant="outline" tone="danger" size="sm" onClick={() => onDeleteConversation("me")} title="Clear chat history for me">
                          Delete for me
                        </Button>
                      )}
                      {(selectedConversation.type === "admin_operator" || selectedConversation.type === "operator_member") && (
                        <Button variant="outline" tone="danger" size="sm" onClick={() => onDeleteConversation("all")} title="Clear chat history for everyone in this conversation">
                          Delete for all
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {hasMoreOlder && (
                      <div className="flex justify-center py-2">
                        <button type="button" onClick={loadOlderMessages} disabled={loadingOlder} className="text-xs text-admin hover:underline disabled:opacity-50 cursor-pointer">
                          {loadingOlder ? "Loading…" : "Load older messages"}
                        </button>
                      </div>
                    )}

                    {messages.map((msg) => {
                      const isMe = msg.sender_user_id === currentUser.id;
                      const isBroadcast = msg.message_type === "admin_broadcast";
                      return (
                        <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 shadow-soft ${isBroadcast ? "bg-amber-400/10 border border-amber-400/30 text-amber-200" : isMe ? "bg-admin text-white" : "bg-white/[0.06] border border-white/10 text-white"}`}>
                            {!isMe && <div className={`text-xs font-medium mb-1 ${isBroadcast ? "text-amber-300" : "text-slate-400"}`}>{formatSender(msg)}{isBroadcast ? " (Broadcast)" : ""}</div>}
                            {msg.attachment_url && (
                              <div className="mb-1.5">
                                {msg.attachment_mime?.startsWith("image/") ? (
                                  <AttachmentImage url={msg.attachment_url} token={token!} />
                                ) : (
                                  <AttachmentLink url={msg.attachment_url} filename={msg.attachment_filename} token={token!} isMe={isMe} tone="admin" />
                                )}
                              </div>
                            )}
                            {msg.content && <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>}
                            <div className={`text-[10px] mt-1 flex items-center gap-1.5 ${isMe ? "text-white/70" : isBroadcast ? "text-amber-400" : "text-slate-500"}`}>
                              {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              {isMe && (() => {
                                const otherIds = (msg.read_by_user_ids || []).filter(id => id !== currentUser.id);
                                return otherIds.length > 0 ? <CheckDoubleIcon className="h-3.5 w-3.5 opacity-90" /> : null;
                              })()}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {messages.length === 0 && <div className="flex items-center justify-center h-full text-sm text-slate-500">No messages yet</div>}
                    <div ref={messagesEndRef} />
                  </div>

                  {typingUserId && typingUserId !== currentUser?.id && (
                    <div className="shrink-0 px-4 py-1 text-xs text-slate-400 italic">
                      {knownUsers.get(typingUserId)?.name || `User #${typingUserId}`} is typing…
                    </div>
                  )}

                  <div className="shrink-0 border-t border-white/10 bg-bg-navy p-3">
                    <div className="flex items-end gap-2">
                      <input ref={fileInputRef} type="file" className="hidden" onChange={onFileSelect} />
                      <IconButton
                        aria-label="Attach file"
                        variant="outline"
                        tone="neutral"
                        onClick={() => {
                          if (selectedConversation?.type === "operator_member") return;
                          fileInputRef.current?.click();
                        }}
                        disabled={uploading || selectedConversation?.type === "operator_member"}
                      >
                        <PaperclipIcon />
                      </IconButton>
                      <Textarea
                        tone="admin"
                        value={chatInput}
                        onChange={onChatInputChange}
                        onBlur={sendTypingStop}
                        onKeyDown={onKeyDown}
                        placeholder={
                          selectedConversation?.type === "operator_member"
                            ? "Admins cannot send direct messages here. Use Admin Broadcast to message members."
                            : "Type a message…"
                        }
                        rows={1}
                        className="flex-1"
                        disabled={selectedConversation?.type === "operator_member"}
                      />
                      <IconButton
                        aria-label="Send message"
                        tone="admin"
                        variant="solid"
                        onClick={onSendMessage}
                        disabled={!chatInput.trim() || selectedConversation?.type === "operator_member"}
                      >
                        <SendIcon />
                      </IconButton>
                    </div>
                  </div>
                </>
              ) : (
                <EmptyState icon={<ChatBubbleIcon />} title="Select a conversation to start chatting" className="flex-1" />
              )}
            </section>
          </div>
        )}

        {/* BROADCAST */}
        {activePanel === "broadcast" && (
          <section className="flex-1 overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto space-y-6">
              <PageHeader title="Broadcast" description="Send an announcement to members and/or operators." />
              <Card>
                <CardBody className="space-y-4">
                  <Textarea
                    tone="admin"
                    value={broadcastMessage}
                    onChange={(e) => setBroadcastMessage(e.target.value)}
                    placeholder="Write an announcement…"
                    className="min-h-[120px]"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={broadcastAll} onChange={(e) => setBroadcastAll(e.target.checked)} />
                        <span className="text-sm text-slate-300">All members</span>
                      </div>
                      {!broadcastAll && (
                        <Select
                          tone="admin"
                          value={broadcastMemberId ?? ""}
                          onChange={(e) => setBroadcastMemberId(e.target.value ? Number(e.target.value) : null)}
                        >
                          <option value="">Select member</option>
                          {activeProjectMembers.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </Select>
                      )}
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={broadcastAllOperators} onChange={(e) => setBroadcastAllOperators(e.target.checked)} />
                        <span className="text-sm text-slate-300">All operators</span>
                      </div>
                      {!broadcastAllOperators && (
                        <Select
                          tone="admin"
                          value={broadcastOperatorId ?? ""}
                          onChange={(e) => setBroadcastOperatorId(e.target.value ? Number(e.target.value) : null)}
                        >
                          <option value="">Select operator</option>
                          {operators.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </Select>
                      )}
                    </div>
                  </div>
                  <div className="pt-4 border-t border-white/5 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-white">
                      <MegaphoneIcon className="w-4 h-4 text-admin shrink-0" />
                      Delivery
                    </div>
                    <label className="flex items-start gap-2 text-sm text-slate-300 cursor-pointer">
                      <input
                        type="radio"
                        name="broadcastDelivery"
                        className="mt-1"
                        checked={broadcastDeliveryMethod === "chat"}
                        onChange={() => setBroadcastDeliveryMethod("chat")}
                      />
                      <span>
                        <strong>In chat + notification</strong> — operators and members receive chat + bell notifications.
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-sm text-slate-300 cursor-pointer">
                      <input
                        type="radio"
                        name="broadcastDelivery"
                        className="mt-1"
                        checked={broadcastDeliveryMethod === "notification"}
                        onChange={() => setBroadcastDeliveryMethod("notification")}
                      />
                      <span>
                        <strong>Notification only</strong> — no message in chat threads (popup / bell only).
                      </span>
                    </label>
                  </div>
                  <Button
                    tone="admin"
                    onClick={onBroadcast}
                    disabled={
                      !selectedProjectId ||
                      !broadcastMessage.trim() ||
                      (!broadcastAll && broadcastMemberId == null && !broadcastAllOperators && broadcastOperatorId == null)
                    }
                  >
                    Send broadcast
                  </Button>
                </CardBody>
              </Card>
            </div>
          </section>
        )}

        {/* OPERATORS */}
        {activePanel === "operators" && (
          <section className="flex-1 overflow-y-auto p-6">
            <div className="max-w-3xl mx-auto space-y-6">
              <PageHeader title="Operators" description="Assign and manage operator accounts for this project." />
              {!selectedProjectId && (
                <div className="flex items-start gap-2 bg-amber-400/10 border border-amber-400/30 rounded-2xl p-4 text-amber-200 text-sm">
                  <AlertTriangleIcon className="h-4 w-4 mt-0.5 shrink-0" />
                  No active project selected. Operator accounts are still available globally and can be assigned after you create/select a project.
                </div>
              )}

              <Card>
                <CardHeader>
                  <CardTitle>All Operators (Global Accounts)</CardTitle>
                </CardHeader>
                <div className="divide-y divide-white/5">
                  {allOperators.length === 0 ? (
                    <EmptyState compact icon={<HeadsetIcon />} title="No operators found" />
                  ) : (
                    allOperators.map((o) => {
                      const isAssigned = selectedProjectId ? assignedOperatorIds.has(o.id) : false;
                      const isDeactivating = deactivatingUserIds.includes(o.id);
                      return (
                        <div key={o.id} className="p-4 flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar name={o.name} tone="admin" size="sm" />
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-white truncate">{o.name}</div>
                              <div className="text-xs text-slate-500 truncate">{o.email} · {o.uid}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            {selectedProjectId ? (
                              <StatusBadge status={isAssigned ? "active" : "inactive"} />
                            ) : (
                              <span className="text-xs text-slate-500">No project selected</span>
                            )}
                            {selectedProjectId && !isAssigned && (
                              <button
                                onClick={() => onAssignOperatorRow(o.id)}
                                className="text-xs text-admin hover:underline cursor-pointer"
                              >
                                Assign to project
                              </button>
                            )}
                            {selectedProjectId && isAssigned && (
                              <button
                                onClick={() => onRemoveOperator(o.id)}
                                className="text-xs text-amber-300 hover:underline cursor-pointer"
                              >
                                Unassign
                              </button>
                            )}
                            <button
                              onClick={() => setPresenceOperator({ id: o.id, name: o.name })}
                              className="text-xs text-slate-300 hover:text-white hover:underline cursor-pointer"
                              title="View online/offline activity history"
                            >
                              Activity
                            </button>
                            <button
                              onClick={() => onDeactivateGlobally(o.id, o.is_active)}
                              disabled={isDeactivating}
                              className="text-xs text-slate-400 hover:text-red-400 cursor-pointer disabled:opacity-60"
                              title="Delete this operator globally"
                            >
                              {isDeactivating ? "Deleting…" : "Delete"}
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Project Operators</CardTitle>
                  <p className="mt-1 text-xs text-slate-400">
                    <strong>Remove</strong> — unassign from this project only (account stays; you can assign them again from the list above).
                    {" "}<strong>Terminate</strong> — terminate this user in this project (account stays for history/re-assignment).
                  </p>
                </CardHeader>
                <CardBody>
                  <div className="flex items-center gap-2 mb-4">
                    <Select
                      tone="admin"
                      value={assignOperatorId ?? ""}
                      onChange={(e) => setAssignOperatorId(e.target.value ? Number(e.target.value) : null)}
                      disabled={!selectedProjectId}
                      className="flex-1"
                    >
                      <option value="">Select operator to assign</option>
                      {assignableOperators.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name} ({o.email})
                        </option>
                      ))}
                    </Select>
                    <Button tone="admin" onClick={onAssignOperator} disabled={!selectedProjectId || !assignOperatorId}>
                      Assign
                    </Button>
                  </div>
                  {operators.length > 0 && (
                    <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-bg-deep px-3 py-2">
                      <label className="text-xs text-slate-300 inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={operators.length > 0 && selectedOperatorIds.length === operators.length}
                          onChange={(e) =>
                            setSelectedOperatorIds(e.target.checked ? operators.map((o) => o.id) : [])
                          }
                        />
                        Select all project operators
                      </label>
                      <Button
                        variant="outline"
                        tone="danger"
                        size="sm"
                        disabled={selectedOperatorIds.length === 0}
                        onClick={onBulkDeactivateOperators}
                      >
                        Delete selected ({selectedOperatorIds.length})
                      </Button>
                    </div>
                  )}
                  <div className="divide-y divide-white/5 border border-white/5 rounded-xl overflow-hidden">
                    {operators.length === 0 ? (
                      <EmptyState compact icon={<HeadsetIcon />} title="No operators assigned" />
                    ) : (
                      operators.map((o) => (
                        <div key={o.id} className="p-4 flex items-center justify-between">
                          <div className="flex items-center gap-3 min-w-0">
                            <input
                              type="checkbox"
                              checked={selectedOperatorIds.includes(o.id)}
                              onChange={(e) => toggleOperatorSelection(o.id, e.target.checked)}
                            />
                            <Avatar name={o.name} tone="admin" size="sm" />
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-white truncate">{o.name}</div>
                              <div className="text-xs text-slate-500 truncate">{o.email}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <button onClick={() => onRemoveOperator(o.id)} className="text-xs text-red-400 hover:text-red-300 cursor-pointer">
                              Remove
                            </button>
                            <button
                              onClick={() => onTerminateUser(o.id)}
                              className="text-xs text-slate-400 hover:text-red-400 cursor-pointer"
                              title="Terminate this user in this project"
                            >
                              Terminate
                            </button>
                            <button
                              onClick={() => onDeactivateGlobally(o.id, o.is_active)}
                              disabled={deactivatingUserIds.includes(o.id)}
                              className="text-xs text-slate-400 hover:text-red-400 cursor-pointer disabled:opacity-60"
                              title="Delete this operator globally"
                            >
                              {deactivatingUserIds.includes(o.id) ? "Deleting…" : "Delete"}
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardBody>
              </Card>
            </div>
          </section>
        )}

        {/* MEMBERS */}
        {activePanel === "members" && (
          <section className="flex-1 overflow-y-auto p-6">
            <div className="max-w-4xl mx-auto space-y-6">
              <PageHeader title="Members" description="Create, assign, and manage member accounts for this project." />
              {!selectedProjectId && (
                <div className="flex items-start gap-2 bg-amber-400/10 border border-amber-400/30 rounded-2xl p-4 text-amber-200 text-sm">
                  <AlertTriangleIcon className="h-4 w-4 mt-0.5 shrink-0" />
                  No active project selected. Member accounts are still available globally and can be assigned after you create/select a project.
                </div>
              )}

              <Card>
                <CardHeader>
                  <CardTitle>Create Member</CardTitle>
                </CardHeader>
                <CardBody>
                  <form onSubmit={onAdminCreateMember} className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <Input tone="admin" disabled={!selectedProjectId} value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)} placeholder="Name" />
                    <Input tone="admin" disabled={!selectedProjectId} value={newMemberEmail} onChange={(e) => setNewMemberEmail(e.target.value)} placeholder="Email" />
                    <Input tone="admin" disabled={!selectedProjectId} value={newMemberPassword} onChange={(e) => setNewMemberPassword(e.target.value)} placeholder="Password" />
                    <Select tone="admin" disabled={!selectedProjectId} value={newMemberOperatorId ?? ""} onChange={(e) => setNewMemberOperatorId(e.target.value ? Number(e.target.value) : null)}>
                      <option value="">Select operator</option>
                      {operators.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </Select>
                    <div className="md:col-span-4">
                      <Button
                        type="submit"
                        tone="admin"
                        loading={memberCreateLoading}
                        disabled={
                          memberCreateLoading ||
                          !selectedProjectId ||
                          !newMemberName.trim() ||
                          !newMemberEmail.trim() ||
                          !newMemberPassword.trim() ||
                          !newMemberOperatorId
                        }
                      >
                        {memberCreateLoading ? "Creating…" : "Create member"}
                      </Button>
                    </div>
                  </form>
                </CardBody>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Add Existing Member To This Project</CardTitle>
                  <p className="mt-1 text-xs text-slate-400">
                    Reuse any active global member account and assign or reassign it inside this project.
                  </p>
                </CardHeader>
                <CardBody>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Select
                      tone="admin"
                      value={existingMemberId ?? ""}
                      onChange={(e) => setExistingMemberId(e.target.value ? Number(e.target.value) : null)}
                      disabled={!selectedProjectId}
                    >
                      <option value="">Select existing member</option>
                      {existingMemberOptions.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.email}) — {m.scopeLabel}
                        </option>
                      ))}
                    </Select>
                    <Select
                      tone="admin"
                      value={existingMemberOperatorId ?? ""}
                      onChange={(e) => setExistingMemberOperatorId(e.target.value ? Number(e.target.value) : null)}
                      disabled={!selectedProjectId}
                    >
                      <option value="">Assign to operator</option>
                      {operators.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </Select>
                    <Button
                      tone="admin"
                      onClick={onAttachExistingMember}
                      disabled={!selectedProjectId || existingMemberOptions.length === 0 || !existingMemberId || !existingMemberOperatorId}
                    >
                      Add Existing Member
                    </Button>
                  </div>
                  {selectedProjectId && existingMemberOptions.length === 0 && (
                    <div className="text-xs text-slate-400 mt-3">
                      No active global members found.
                    </div>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>All Members (Global Accounts)</CardTitle>
                </CardHeader>
                <CardBody className="p-0 pt-0">
                  {allMembers.length > 0 && (
                    <div className="mx-5 mt-5 mb-3 flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-bg-deep px-3 py-2">
                      <label className="text-xs text-slate-300 inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={allMembers.length > 0 && selectedMemberIds.length === allMembers.length}
                          onChange={(e) => setSelectedMemberIds(e.target.checked ? allMembers.map((m) => m.id) : [])}
                        />
                        Select all global members
                      </label>
                      <Button
                        variant="outline"
                        tone="danger"
                        size="sm"
                        disabled={selectedMemberIds.length === 0}
                        onClick={onBulkDeactivateMembers}
                      >
                        Delete selected ({selectedMemberIds.length})
                      </Button>
                    </div>
                  )}
                  <div className="divide-y divide-white/5 border-t border-white/5">
                    {allMembers.length === 0 ? (
                      <EmptyState compact icon={<UsersIcon />} title="No members found" />
                    ) : (
                      allMembers.map((m) => {
                        const projectMember = projectMembersById.get(m.id);
                        const isAssigned = Boolean(
                          selectedProjectId &&
                            projectMember?.membership_status === "active" &&
                            projectMember?.assigned_operator_id,
                        );
                        return (
                          <div key={m.id} className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3 items-center">
                            <div className="flex items-center gap-3 min-w-0">
                              <input
                                type="checkbox"
                                checked={selectedMemberIds.includes(m.id)}
                                onChange={(e) => toggleMemberSelection(m.id, e.target.checked)}
                              />
                              <Avatar name={m.name} tone="neutral" size="sm" />
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-white truncate">{m.name}</div>
                                <div className="text-xs text-slate-500 truncate">{m.email}</div>
                              </div>
                            </div>
                            <div className="text-xs">
                              {!selectedProjectId ? (
                                <span className="text-slate-400">No project selected</span>
                              ) : isAssigned ? (
                                <span className="text-admin font-medium">
                                  Assigned: {projectMember?.assigned_operator_name || "Operator"}
                                </span>
                              ) : (
                                <span className="text-slate-400">Unassigned</span>
                              )}
                            </div>
                            <div>
                              {selectedProjectId && !isAssigned ? (
                                <Select
                                  tone="admin"
                                  value={globalMemberAssignOp[m.id] ?? ""}
                                  onChange={(e) =>
                                    setGlobalMemberAssignOp((prev) => ({
                                      ...prev,
                                      [m.id]: e.target.value ? Number(e.target.value) : null,
                                    }))
                                  }
                                >
                                  <option value="">Select operator</option>
                                  {operators.map((o) => (
                                    <option key={o.id} value={o.id}>
                                      {o.name}
                                    </option>
                                  ))}
                                </Select>
                              ) : (
                                <div className="text-xs text-slate-500">—</div>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              {selectedProjectId && !isAssigned && (
                                <button
                                  onClick={() => onAssignGlobalMember(m.id)}
                                  disabled={!selectedProjectId || (globalMemberAssignOp[m.id] ?? null) == null}
                                  className="text-xs text-admin hover:underline cursor-pointer disabled:opacity-50"
                                >
                                  Assign to project
                                </button>
                              )}
                              <button
                                onClick={() => setAnalyticsMemberId(m.id)}
                                className="text-xs text-slate-300 hover:text-white hover:underline cursor-pointer"
                                title="View this customer's chat analytics"
                              >
                                Analytics
                              </button>
                              <button
                                onClick={() => onDeactivateGlobally(m.id, m.is_active)}
                                disabled={deactivatingUserIds.includes(m.id)}
                                className="text-xs text-slate-400 hover:text-red-400 cursor-pointer disabled:opacity-60"
                                title="Delete this member globally"
                              >
                                {deactivatingUserIds.includes(m.id) ? "Deleting…" : "Delete"}
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Members</CardTitle>
                </CardHeader>
                <div className="divide-y divide-white/5">
                  {members.filter((m) => m.is_active).length === 0 ? (
                    <EmptyState compact icon={<UsersIcon />} title="No members yet" />
                  ) : (
                    members.filter((m) => m.is_active).map((m) => (
                      <div key={m.id} className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3 items-center">
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar name={m.name} tone="neutral" size="sm" />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-white truncate">{m.name}</div>
                            <div className="text-xs text-slate-500 truncate">{m.email}</div>
                            <div className="mt-1">
                              <StatusBadge status={getHistoryStatus(m)} />
                            </div>
                          </div>
                        </div>
                        <div className="text-sm text-slate-400">
                          Assigned:{" "}
                          <span className="font-medium text-white">
                            {m.assigned_operator_name ? `${m.assigned_operator_name} (${m.assigned_operator_uid})` : "—"}
                          </span>
                        </div>
                        <Select
                          tone="admin"
                          value={memberReassignOp[m.id] ?? m.assigned_operator_id ?? ""}
                          onChange={(e) => setMemberReassignOp((prev) => ({ ...prev, [m.id]: e.target.value ? Number(e.target.value) : null }))}
                        >
                          <option value="">Select operator</option>
                          {operators.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </Select>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => onReassignMember(m.id)}
                            disabled={(memberReassignOp[m.id] ?? null) == null}
                            className="text-xs text-admin hover:underline cursor-pointer disabled:opacity-50"
                          >
                            Reassign
                          </button>
                          <button onClick={() => onRemoveMember(m.id)} className="text-xs text-red-600 hover:underline cursor-pointer">
                            Remove
                          </button>
                          <button
                            onClick={() => onTerminateUser(m.id)}
                            className="text-xs text-slate-400 hover:text-red-400 cursor-pointer"
                            title="Terminate this user in this project"
                          >
                            Terminate
                          </button>
                          <button
                            onClick={() => onDeactivateGlobally(m.id, m.is_active)}
                            disabled={deactivatingUserIds.includes(m.id)}
                            className="text-xs text-slate-400 hover:text-red-400 cursor-pointer disabled:opacity-60"
                            title="Delete this member globally"
                          >
                            {deactivatingUserIds.includes(m.id) ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </div>
          </section>
        )}

        {/* HISTORY */}
        {activePanel === "history" && (
          <section className="flex-1 overflow-y-auto p-6">
            <div className="max-w-5xl mx-auto space-y-6">
              <PageHeader title="Past / Deleted" description="Removed, terminated, or globally deleted operators and members." />
              <Card>
                <CardHeader>
                  <CardTitle>Past / Deleted Operators</CardTitle>
                  <p className="mt-1 text-xs text-slate-400">
                    Tip: <strong>Delete globally</strong> deactivates active accounts. Deleted rows show only <strong>Delete permanently</strong>.
                  </p>
                </CardHeader>
                <CardBody className="pt-0">
                  {historyOperators.length > 0 && (
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-bg-deep px-3 py-2">
                      <label className="text-xs text-slate-300 inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={historyOperators.length > 0 && selectedHistoryOperatorIds.length === historyOperators.length}
                          onChange={(e) =>
                            setSelectedHistoryOperatorIds(
                              e.target.checked ? historyOperators.map((o) => o.id) : [],
                            )
                          }
                        />
                        Select all history operators
                      </label>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          tone="danger"
                          size="sm"
                          onClick={onBulkDeactivateHistoryOperators}
                          disabled={selectedHistoryActiveOperatorCount === 0 || historyBulkActionLoading !== null}
                        >
                          {historyBulkActionLoading === "operators-global"
                            ? "Deleting globally…"
                            : `Delete globally selected (${selectedHistoryActiveOperatorCount})`}
                        </Button>
                        <Button
                          variant="solid"
                          tone="danger"
                          size="sm"
                          onClick={onBulkPermanentlyDeleteHistoryOperators}
                          disabled={selectedHistoryDeletedOperatorCount === 0 || historyBulkActionLoading !== null}
                        >
                          {historyBulkActionLoading === "operators-permanent"
                            ? "Deleting permanently…"
                            : `Delete permanently selected (${selectedHistoryDeletedOperatorCount})`}
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="divide-y divide-white/5 border border-white/5 rounded-xl overflow-hidden">
                    {historyOperators.length === 0 ? (
                      <EmptyState compact icon={<HistoryIcon />} title="No removed, terminated, or deleted operators" />
                    ) : (
                      historyOperators.map((o) => {
                        const historyStatus = getHistoryStatus(o);
                        return (
                          <div key={o.id} className="p-4 flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3 min-w-0">
                              <input
                                type="checkbox"
                                checked={selectedHistoryOperatorIds.includes(o.id)}
                                onChange={(e) => toggleHistoryOperatorSelection(o.id, e.target.checked)}
                              />
                              <Avatar name={o.name} tone="neutral" size="sm" />
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-white truncate">{o.name}</div>
                                <div className="text-xs text-slate-500 truncate">{o.email} · {o.uid}</div>
                                <div className="mt-1">
                                  <StatusBadge status={historyStatus} />
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              {o.is_active ? (
                                <>
                                  <button onClick={() => setActivePanel("operators")} className="text-xs text-admin hover:underline cursor-pointer">
                                    Assign from Operators panel
                                  </button>
                                  <button
                                    onClick={() => onDeactivateGlobally(o.id, o.is_active)}
                                    disabled={deactivatingUserIds.includes(o.id)}
                                    className="text-xs text-red-600 hover:underline cursor-pointer disabled:opacity-60"
                                  >
                                    {deactivatingUserIds.includes(o.id) ? "Deleting…" : "Delete globally"}
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => onPermanentlyDeleteUser(o.id, o.name)}
                                  disabled={permanentlyDeletingUserIds.includes(o.id)}
                                  className="text-xs text-red-600 hover:underline cursor-pointer disabled:opacity-60"
                                >
                                  {permanentlyDeletingUserIds.includes(o.id) ? "Deleting…" : "Delete permanently"}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Past / Deleted Members</CardTitle>
                </CardHeader>
                <CardBody className="pt-0">
                  {historyMembers.length > 0 && (
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-bg-deep px-3 py-2">
                      <label className="text-xs text-slate-300 inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={historyMembers.length > 0 && selectedHistoryMemberIds.length === historyMembers.length}
                          onChange={(e) =>
                            setSelectedHistoryMemberIds(
                              e.target.checked ? historyMembers.map((m) => m.id) : [],
                            )
                          }
                        />
                        Select all history members
                      </label>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          tone="danger"
                          size="sm"
                          onClick={onBulkDeactivateHistoryMembers}
                          disabled={selectedHistoryActiveMemberCount === 0 || historyBulkActionLoading !== null}
                        >
                          {historyBulkActionLoading === "members-global"
                            ? "Deleting globally…"
                            : `Delete globally selected (${selectedHistoryActiveMemberCount})`}
                        </Button>
                        <Button
                          variant="solid"
                          tone="danger"
                          size="sm"
                          onClick={onBulkPermanentlyDeleteHistoryMembers}
                          disabled={selectedHistoryDeletedMemberCount === 0 || historyBulkActionLoading !== null}
                        >
                          {historyBulkActionLoading === "members-permanent"
                            ? "Deleting permanently…"
                            : `Delete permanently selected (${selectedHistoryDeletedMemberCount})`}
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="divide-y divide-white/5 border border-white/5 rounded-xl overflow-hidden">
                    {historyMembers.length === 0 ? (
                      <EmptyState compact icon={<HistoryIcon />} title="No removed, terminated, or deleted members" />
                    ) : (
                      historyMembers.map((m) => {
                        const historyStatus = getHistoryStatus(m);
                        return (
                          <div key={m.id} className="p-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-center">
                            <div className="flex items-center gap-3 min-w-0 md:col-span-1">
                              <input
                                type="checkbox"
                                checked={selectedHistoryMemberIds.includes(m.id)}
                                onChange={(e) => toggleHistoryMemberSelection(m.id, e.target.checked)}
                              />
                              <Avatar name={m.name} tone="neutral" size="sm" />
                            </div>
                            <div>
                              <div className="text-sm font-medium text-white">{m.name}</div>
                              <div className="text-xs text-slate-500">{m.email} · {m.uid}</div>
                              <div className="mt-1">
                                <StatusBadge status={historyStatus} />
                              </div>
                            </div>
                            <div className="text-xs text-slate-400">
                              Last assigned: {m.assigned_operator_name ? `${m.assigned_operator_name} (${m.assigned_operator_uid})` : "—"}
                            </div>
                            {m.is_active ? (
                              <Select
                                tone="admin"
                                value={memberReassignOp[m.id] ?? ""}
                                onChange={(e) => setMemberReassignOp((prev) => ({ ...prev, [m.id]: e.target.value ? Number(e.target.value) : null }))}
                              >
                                <option value="">Select operator to restore</option>
                                {reassignableOperators.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {o.name}
                                  </option>
                                ))}
                              </Select>
                            ) : (
                              <span className="text-xs text-slate-500">—</span>
                            )}
                            <div className="flex items-center gap-3">
                              {m.is_active ? (
                                <>
                                  <button
                                    onClick={() => onReassignMember(m.id)}
                                    disabled={(memberReassignOp[m.id] ?? null) == null}
                                    className="text-xs text-admin hover:underline cursor-pointer disabled:opacity-50"
                                  >
                                    Restore & Reassign
                                  </button>
                                  <button
                                    onClick={() => onDeactivateGlobally(m.id, m.is_active)}
                                    disabled={deactivatingUserIds.includes(m.id)}
                                    className="text-xs text-red-600 hover:underline cursor-pointer disabled:opacity-60"
                                  >
                                    {deactivatingUserIds.includes(m.id) ? "Deleting…" : "Delete globally"}
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => onPermanentlyDeleteUser(m.id, m.name)}
                                  disabled={permanentlyDeletingUserIds.includes(m.id)}
                                  className="text-xs text-red-600 hover:underline cursor-pointer disabled:opacity-60"
                                >
                                  {permanentlyDeletingUserIds.includes(m.id) ? "Deleting…" : "Delete permanently"}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </CardBody>
              </Card>
            </div>
          </section>
        )}

        {/* PROJECTS */}
        {activePanel === "projects" && (
          <section className="flex-1 overflow-y-auto p-6">
            <div className="max-w-4xl mx-auto space-y-6">
              <PageHeader title="Projects" description="Create and manage support projects." />
              <Card>
                <CardHeader>
                  <CardTitle>Create Project</CardTitle>
                </CardHeader>
                <CardBody>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Input tone="admin" value={createProjectNameInput} onChange={(e) => setCreateProjectNameInput(e.target.value)} placeholder="Project name" />
                    <Input tone="admin" value={createProjectLogoInput} onChange={(e) => setCreateProjectLogoInput(e.target.value)} placeholder="Logo URL (optional)" />
                    <Input tone="admin" value={createProjectSupportEmail} onChange={(e) => setCreateProjectSupportEmail(e.target.value)} placeholder="Support email (optional)" />
                    <Input tone="admin" value={createProjectSupportPhone} onChange={(e) => setCreateProjectSupportPhone(e.target.value)} placeholder="Support phone (optional)" />
                    <div className="md:col-span-2">
                      <Button
                        tone="admin"
                        onClick={onCreateProject}
                        disabled={!createProjectNameInput.trim() || projectActionKey !== null}
                        loading={projectActionKey === "project-create"}
                      >
                        {projectActionKey === "project-create" ? "Creating…" : "Create"}
                      </Button>
                    </div>
                  </div>
                </CardBody>
              </Card>

              <div>
                <h2 className="text-sm font-semibold text-white mb-3">Active Projects</h2>
                {projects.filter((p) => p.is_active).length === 0 ? (
                  <Card>
                    <EmptyState compact icon={<FolderIcon />} title="No active projects" />
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {projects.filter((p) => p.is_active).map((p) => (
                      <Card key={p.id} className="overflow-hidden">
                        <div className="flex items-center gap-3 p-4">
                          {p.logo_url ? (
                            <img src={p.logo_url} alt={p.name} className="h-11 w-11 rounded-xl object-cover shrink-0" />
                          ) : (
                            <div className="h-11 w-11 rounded-xl bg-admin-light text-admin flex items-center justify-center shrink-0">
                              <FolderIcon className="h-5 w-5" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-white truncate">{p.name}</div>
                            <div className="text-xs text-slate-500">#{p.id}</div>
                          </div>
                          <StatusBadge status="active" />
                        </div>
                        <div className="flex items-center gap-2 border-t border-white/5 px-4 py-3">
                          <Button
                            variant="outline"
                            tone="neutral"
                            size="sm"
                            onClick={() => onToggleProjectActive(p)}
                            disabled={projectActionKey !== null}
                          >
                            {projectActionKey === `project-toggle-${p.id}` ? "Deactivating…" : "Deactivate"}
                          </Button>
                          <Button
                            variant="outline"
                            tone="danger"
                            size="sm"
                            onClick={() => onDeleteProject(p)}
                            disabled={projectActionKey !== null}
                          >
                            {projectActionKey === `project-archive-${p.id}` ? "Archiving…" : "Archive"}
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h2 className="text-sm font-semibold text-white mb-3">Archived Projects</h2>
                {projects.filter((p) => !p.is_active).length === 0 ? (
                  <Card>
                    <EmptyState compact icon={<FolderIcon />} title="No archived projects" />
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {projects.filter((p) => !p.is_active).map((p) => (
                      <Card key={p.id} className="overflow-hidden opacity-90">
                        <div className="flex items-center gap-3 p-4">
                          {p.logo_url ? (
                            <img src={p.logo_url} alt={p.name} className="h-11 w-11 rounded-xl object-cover shrink-0 grayscale" />
                          ) : (
                            <div className="h-11 w-11 rounded-xl bg-white/[0.08] text-slate-500 flex items-center justify-center shrink-0">
                              <FolderIcon className="h-5 w-5" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-white truncate">{p.name}</div>
                            <div className="text-xs text-slate-500">#{p.id}</div>
                          </div>
                          <StatusBadge status="inactive" />
                        </div>
                        <div className="flex items-center gap-2 border-t border-white/5 px-4 py-3">
                          <Button
                            variant="outline"
                            tone="admin"
                            size="sm"
                            onClick={() => onToggleProjectActive(p)}
                            disabled={projectActionKey !== null}
                          >
                            {projectActionKey === `project-toggle-${p.id}` ? "Restoring…" : "Restore"}
                          </Button>
                          <Button
                            variant="outline"
                            tone="danger"
                            size="sm"
                            onClick={() => onPermanentlyDeleteProject(p)}
                            disabled={projectActionKey !== null}
                          >
                            {projectActionKey === `project-delete-${p.id}` ? "Deleting…" : "Delete Permanently"}
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* BRANDING */}
        {activePanel === "branding" && (
          <section className="flex-1 overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto space-y-6">
              <PageHeader title="Branding & Details" description="Project image, name, and operator help details." />
              {!selectedProjectId ? (
                <Card>
                  <EmptyState icon={<ImageIcon />} title="No project selected" description="Select a project in the top dropdown to manage branding." />
                </Card>
              ) : (
                <Card>
                  <CardBody className="space-y-6">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-400">Status</span>
                      <StatusBadge status={selectedProject?.is_active ? "active" : "inactive"} />
                    </div>

                    <div className="flex items-center gap-4 p-4 bg-bg-deep rounded-xl border border-white/5">
                      {selectedProject?.logo_url ? (
                        <img src={selectedProject.logo_url} alt={selectedProject.name} className="h-16 w-16 rounded-xl object-cover shadow-soft bg-white" />
                      ) : (
                        <div className="h-16 w-16 rounded-xl bg-white/[0.1] flex items-center justify-center text-slate-500">
                          <ImageIcon className="h-6 w-6" />
                        </div>
                      )}
                      <div>
                        <div className="text-sm font-semibold text-white">{selectedProject?.name}</div>
                        <div className="text-xs text-slate-400">ID: #{selectedProject?.id}</div>
                      </div>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-white/5">
                      <Field label="Project Name">
                        <Input
                          tone="admin"
                          value={brandingProjectNameInput}
                          onChange={(e) => setBrandingProjectNameInput(e.target.value)}
                          placeholder="Project name"
                        />
                      </Field>

                      <Field label="Logo URL">
                        <Input
                          tone="admin"
                          value={brandingProjectLogoInput}
                          onChange={(e) => setBrandingProjectLogoInput(e.target.value)}
                          placeholder="https://example.com/logo.png"
                        />
                      </Field>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Upload Logo</label>
                        <div className="flex flex-wrap items-center gap-3">
                          <input ref={logoInputRef} type="file" onChange={onUploadLogo} className="hidden" id="logo-upload" />
                          <label
                            htmlFor="logo-upload"
                            className="inline-flex items-center justify-center rounded-lg border border-white/10 px-3.5 py-2 text-sm font-medium text-slate-300 hover:bg-white/5 cursor-pointer transition-colors"
                          >
                            Choose File
                          </label>
                          {selectedProject?.logo_url && (
                            <Button variant="outline" tone="danger" size="sm" onClick={onRemoveLogo}>
                              Remove Logo
                            </Button>
                          )}
                          <span className="text-xs text-slate-400 italic">Recommended: Square PNG/JPG</span>
                        </div>
                      </div>

                      <div className="pt-4 space-y-4">
                        <Field label="Operator Help Email">
                          <Input
                            tone="admin"
                            value={supportEmailInput}
                            onChange={(e) => setSupportEmailInput(e.target.value)}
                            placeholder="support@business.com"
                          />
                        </Field>
                        <Field label="Operator Help Phone">
                          <Input
                            tone="admin"
                            value={supportPhoneInput}
                            onChange={(e) => setSupportPhoneInput(e.target.value)}
                            placeholder="+1 555 000 0000"
                          />
                        </Field>
                        <Field label="Operator Terminated Message">
                          <Textarea
                            tone="admin"
                            value={operatorTerminatedMessageInput}
                            onChange={(e) => setOperatorTerminatedMessageInput(e.target.value)}
                            placeholder="Your ID is terminated. Please contact admin."
                            rows={3}
                          />
                        </Field>
                        <Button tone="admin" fullWidth onClick={onUpdateBranding} disabled={!selectedProjectId}>
                          Save Changes
                        </Button>
                      </div>
                    </div>
                  </CardBody>
                </Card>
              )}
            </div>
          </section>
        )}


        {/* USERS */}
        {activePanel === "users" && (
          <section className="flex-1 overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto space-y-6">
              <PageHeader title="User Management" description="Create staff accounts and manage passwords." />

              {currentUser.is_super_admin && (
                <Card>
                  <CardHeader>
                    <CardTitle>All Admins ({allAdmins.length})</CardTitle>
                  </CardHeader>
                  <CardBody>
                    {allAdmins.length === 0 ? (
                      <p className="text-sm text-slate-400">No admin accounts yet.</p>
                    ) : (
                      <div className="divide-y divide-white/5">
                        {allAdmins.map((admin) => (
                          <div key={admin.id} className="flex items-center justify-between gap-3 py-2.5">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-100 truncate">{admin.name}</p>
                              <p className="text-xs text-slate-400 truncate">{admin.email}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {admin.is_super_admin && <Badge color="emerald">Super Admin</Badge>}
                              <StatusBadge status={admin.is_active ? "active" : "inactive"} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardBody>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle>Create Operator / Admin</CardTitle>
                </CardHeader>
                <CardBody>
                  <form onSubmit={onCreateUser} className="space-y-3">
                    <Input tone="admin" value={newUserName} onChange={(e) => setNewUserName(e.target.value)} placeholder="Name" />
                    <Input tone="admin" value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} placeholder="Email" />
                    <Input tone="admin" value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} placeholder="Password" />
                    <Select
                      tone="admin"
                      value={newUserRole}
                      onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                    >
                      <option value="OPERATOR">Operator</option>
                      <option value="ADMIN">Admin</option>
                    </Select>
                    <Button type="submit" tone="admin" disabled={!newUserName.trim() || !newUserEmail.trim() || !newUserPassword.trim()}>
                      Create user
                    </Button>
                  </form>
                </CardBody>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Change user password</CardTitle>
                </CardHeader>
                <CardBody>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Select tone="admin" value={changePwUserId ?? ""} onChange={(e) => setChangePwUserId(e.target.value ? Number(e.target.value) : null)}>
                      <option value="">Select user</option>
                      {[...allOperators, ...allMembers].map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.role})
                        </option>
                      ))}
                    </Select>
                    <Input tone="admin" value={changePwValue} onChange={(e) => setChangePwValue(e.target.value)} placeholder="New password" />
                    <Button tone="admin" onClick={onChangePassword} disabled={!changePwUserId || changePwValue.trim().length < 6}>
                      Update
                    </Button>
                  </div>
                  <div className="mt-4 flex items-start gap-2 text-xs text-slate-400">
                    <KeyIcon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    Tip: To deactivate a user globally across all projects, use the “Deactivate globally” action in Members.
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Change my password</CardTitle>
                </CardHeader>
                <CardBody>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Input tone="admin" value={myCurrentPw} onChange={(e) => setMyCurrentPw(e.target.value)} placeholder="Current password" />
                    <Input tone="admin" value={myNewPw} onChange={(e) => setMyNewPw(e.target.value)} placeholder="New password" />
                    <Button tone="admin" onClick={onChangeMyPassword} disabled={!myCurrentPw.trim() || myNewPw.trim().length < 6}>
                      Update My Password
                    </Button>
                  </div>
                </CardBody>
              </Card>

              {currentUser.is_super_admin && (
                <Card>
                  <CardHeader>
                    <CardTitle>Reset admin password</CardTitle>
                  </CardHeader>
                  <CardBody>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <Select tone="admin" value={adminResetUserId ?? ""} onChange={(e) => setAdminResetUserId(e.target.value ? Number(e.target.value) : null)}>
                        <option value="">Select admin</option>
                        {allAdmins.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.email})
                          </option>
                        ))}
                      </Select>
                      <Input tone="admin" value={adminResetPw} onChange={(e) => setAdminResetPw(e.target.value)} placeholder="New admin password" />
                      <Button tone="admin" onClick={onResetAdminPassword} disabled={!adminResetUserId || adminResetPw.trim().length < 6}>
                        Reset Admin Password
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              )}
            </div>
          </section>
        )}

        {activePanel === "analytics" && token && (
          <section className="flex-1 overflow-y-auto p-6">
            <AdminAnalyticsOverview token={token} projects={projects} />
          </section>
        )}

        {activePanel === "chatHistory" && token && (
          <section className="flex-1 overflow-y-auto p-6">
            <ChatHistoryPage token={token} projects={projects} operators={allOperators} members={allMembers} />
          </section>
        )}
      </div>

      <Modal
        open={analyticsMemberId != null}
        onClose={() => setAnalyticsMemberId(null)}
        size="xl"
        title={
          analyticsMemberId != null
            ? `${allMembers.find((m) => m.id === analyticsMemberId)?.name ?? "Customer"} — Analytics`
            : "Customer Analytics"
        }
      >
        {analyticsMemberId != null && token && <MemberAnalyticsDashboard token={token} memberId={analyticsMemberId} />}
      </Modal>

      <Modal
        open={presenceOperator != null}
        onClose={() => setPresenceOperator(null)}
        size="xl"
        title={presenceOperator ? `${presenceOperator.name} — Activity / Presence History` : "Activity History"}
      >
        {presenceOperator != null && token && (
          <OperatorPresenceHistoryPanel token={token} operatorId={presenceOperator.id} operatorName={presenceOperator.name} />
        )}
      </Modal>
    </main>
  );
}
