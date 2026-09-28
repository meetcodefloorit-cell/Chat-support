"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";

import { AttachmentImage, AttachmentLink } from "@/components/AttachmentDisplay";
import { NotificationBell } from "@/components/NotificationBell";
import { PresenceDot } from "@/components/PresenceDot";
import {
  closeChatSession,
  getChatSessionState,
  getConversations,
  getMembers,
  getMessages,
  getPresence,
  getProjects,
  postMessage,
  searchMessages,
  uploadAttachment,
  getProjectStatus,
} from "@/lib/api";
import { ChatTimerBar } from "@/components/chat/ChatTimerBar";
import { clearSession, getLoginPath, getToken, getUser } from "@/lib/auth";
import { useIsMobile } from "@/hooks/useIsMobile";
import { parseError } from "@/lib/parseError";
import { buildWebSocketUrl } from "@/lib/ws";
import { ChatSessionState, Conversation, Message, Presence, Project, User } from "@/lib/types";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { SearchInput } from "@/components/ui/SearchInput";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/Skeleton";
import { ToastStack } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import {
  ChatBubbleIcon,
  ChevronLeftIcon,
  CheckDoubleIcon,
  LogoutIcon,
  PaperclipIcon,
  SendIcon,
  InboxIcon,
  HeadsetIcon,
  MenuIcon,
  AlertTriangleIcon,
  ChartBarIcon,
  GridIcon,
} from "@/components/ui/icons";
import { OperatorAnalyticsDashboard } from "@/components/analytics/OperatorAnalyticsDashboard";
import { OperatorDashboardHome } from "@/components/dashboard/OperatorDashboardHome";

type Panel = "dashboard" | "inbox" | "admin_help" | "analytics";

export default function OperatorWorkspace() {
  const router = useRouter();
  const params = useParams();
  const uid = params.uid as string;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalWsCloseRef = useRef(false);
  const refreshConversationsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshingConversationsRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsPendingSendRef = useRef<{ conversationId: number; content: string } | null>(null);
  const loadConversationMessagesReqIdRef = useRef(0);

  const [token, setToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  const [members, setMembers] = useState<User[]>([]);
  const [presence, setPresence] = useState<Record<number, Presence>>({});
  const [isTerminated, setIsTerminated] = useState(false);
  const [showTerminatedPopup, setShowTerminatedPopup] = useState(false);

  const [activePanel, setActivePanel] = useState<Panel>("dashboard");
  const [chatInput, setChatInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [typingUserId, setTypingUserId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Message[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sessionsByConversation, setSessionsByConversation] = useState<Record<number, ChatSessionState>>({});
  const [closingSession, setClosingSession] = useState(false);
  const [thankYouWarning, setThankYouWarning] = useState<string | null>(null);

  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [wsReconnecting, setWsReconnecting] = useState(false);
  const [wsNotifKey, setWsNotifKey] = useState(0);
  const [dataLoading, setDataLoading] = useState(true);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const initialLoadDoneRef = useRef(false);
  const hasShownTerminatedPopupRef = useRef(false);
  const isMobile = useIsMobile();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileShowChat, setMobileShowChat] = useState(false);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );
  const adminHelpConversation = useMemo(
    () => conversations.find((c) => c.type === "admin_operator") || null,
    [conversations],
  );
  const visibleConversations = useMemo(
    () =>
      conversations.filter((conv) => {
        if (isTerminated) {
          return conv.type === "admin_operator";
        }
        if (activePanel === "admin_help") {
          return conv.type === "admin_operator";
        }
        if (conv.type !== "operator_member") return false;
        return conv.last_message_at !== null || (conv.unread_count || 0) > 0;
      }),
    [conversations, isTerminated, activePanel],
  );
  const selectedConversation = useMemo(
    () => visibleConversations.find((c) => c.id === selectedConversationId) || null,
    [visibleConversations, selectedConversationId],
  );

  // Server-authoritative: mirrors the same "session ended" check the backend enforces
  // before accepting an operator message, so the input disables the instant the
  // chat_session:update WS event reports a non-active status -- no page refresh needed.
  const currentChatSession = selectedConversation ? sessionsByConversation[selectedConversation.id] ?? null : null;
  const isChatSessionClosed =
    selectedConversation?.type === "operator_member" &&
    currentChatSession != null &&
    currentChatSession.status != null &&
    currentChatSession.status !== "active";

  const knownUsers = useMemo(() => {
    const map = new Map<number, User>();
    if (currentUser) map.set(currentUser.id, currentUser);
    members.forEach((u) => map.set(u.id, u));
    return map;
  }, [currentUser, members]);

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
    setProjectsLoaded(true);
    const hasCurrentProject = selectedProjectId != null && data.some((project) => project.id === selectedProjectId);
    if (hasCurrentProject) return;

    const nextProject = data.find((project) => project.is_active) ?? data[0] ?? null;
    setSelectedProjectId(nextProject ? nextProject.id : null);
    if (!nextProject) {
      setConversations([]);
      setSelectedConversationId(null);
      setMessages([]);
      setMembers([]);
      setPresence({});
      setIsTerminated(false);
    }
  }, [token, selectedProjectId]);

  const loadProjectData = useCallback(async () => {
    if (!token || !selectedProjectId) return;
    if (!initialLoadDoneRef.current) setDataLoading(true);
    try {
      const proj = projects.find((p) => p.id === selectedProjectId) || null;
      if (!proj || !proj.is_active) {
        setConversations([]);
        setSelectedConversationId(null);
        setMessages([]);
        setMembers([]);
        setPresence({});
        setIsTerminated(false);
        return;
      }

      const [convRes, memberRes, presenceRes, statusRes] = await Promise.all([
        getConversations(token, selectedProjectId),
        getMembers(token, selectedProjectId),
        getPresence(token, selectedProjectId),
        getProjectStatus(token, selectedProjectId),
      ]);

      const terminated = statusRes.status === "terminated" || statusRes.status === "TERMINATED";
      setIsTerminated(terminated);
      if (terminated) {
        setActivePanel("admin_help");
      }

      const sortedConversations = sortConversationsByActivity(convRes);
      setConversations(sortedConversations);
      setSelectedConversationId((prev) => {
        if (sortedConversations.length === 0) return null;
        if (prev != null && sortedConversations.some((conversation) => conversation.id === prev)) {
          return prev;
        }
        // For active operators, start with a blank chat until they click a conversation.
        // For terminated operators, we allow selecting the admin-help conversation automatically.
        return terminated ? sortedConversations[0].id : null;
      });
      setMembers(memberRes);

      const pMap: Record<number, Presence> = {};
      presenceRes.forEach((item) => {
        pMap[item.user_id] = item;
      });
      setPresence(pMap);
    } catch (e) {
      const msg = parseError(e);
      const normalized = msg.toLowerCase();
      if (normalized.includes("project not found") || normalized.includes("no access to this project")) {
        try {
          await loadProjects();
        } catch {
          // ignore refresh failures and preserve existing state
        }
        return;
      }
      setError(msg);
    } finally {
      if (!initialLoadDoneRef.current) {
        initialLoadDoneRef.current = true;
        setDataLoading(false);
      }
    }
  }, [token, selectedProjectId, projects, sortConversationsByActivity, loadProjects]);

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
            .forEach((m) =>
              wsRef.current?.send(
                JSON.stringify({
                  event: "read_update",
                  conversation_id: selectedConversationId,
                  message_id: m.id,
                })
              )
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
    } catch (err) {
      if (reqId !== loadConversationMessagesReqIdRef.current) return;
      const msg = parseError(err);
      const normalized = msg.toLowerCase();
      if (normalized.includes("project not found") || normalized.includes("no access to this project")) {
        await loadProjects();
        await loadProjectData();
        return;
      }
      if (msg.includes("404") || normalized.includes("not found")) {
        await loadProjectData();
        return;
      }
      setError(msg);
    }
  }, [token, selectedProjectId, selectedConversationId, currentUser?.id, loadProjectData, loadProjects]);

  const loadOlderMessages = useCallback(async () => {
    if (!token || !selectedProjectId || !selectedConversationId || loadingOlder || !hasMoreOlder) return;
    setLoadingOlder(true);
    try {
      const older = await getMessages(token, selectedProjectId, selectedConversationId, 50, messages.length);
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
      setError(parseError(e));
    } finally {
      setLoadingOlder(false);
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

  const loadProjectDataRef = useRef(loadProjectData);
  useEffect(() => {
    loadProjectDataRef.current = loadProjectData;
  }, [loadProjectData]);

  const loadConversationMessagesRef = useRef(loadConversationMessages);
  useEffect(() => {
    loadConversationMessagesRef.current = loadConversationMessages;
  }, [loadConversationMessages]);

  const conversationsRef = useRef(conversations);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // Server-authoritative session/timer state: fetched fresh on conversation select or page
  // load/refresh (recovery path), then kept live via the "chat_session:update" WS event.
  useEffect(() => {
    if (!token || !selectedProjectId || selectedConversationId == null) return;
    const conv = conversationsRef.current.find((c) => c.id === selectedConversationId);
    if (!conv || conv.type !== "operator_member") return;
    let cancelled = false;
    getChatSessionState(token, selectedProjectId, selectedConversationId)
      .then((state) => {
        if (!cancelled) setSessionsByConversation((prev) => ({ ...prev, [selectedConversationId]: state }));
      })
      .catch(() => {
        // Non-fatal: the timer bar simply stays hidden until the next successful sync.
      });
    return () => {
      cancelled = true;
    };
  }, [token, selectedProjectId, selectedConversationId]);

  const scheduleConversationRefresh = useCallback(() => {
    if (refreshConversationsTimerRef.current) return;
    refreshConversationsTimerRef.current = setTimeout(async () => {
      refreshConversationsTimerRef.current = null;
      if (refreshingConversationsRef.current) return;
      refreshingConversationsRef.current = true;
      try {
        await loadProjectDataRef.current();
        if (selectedConvRef.current != null) {
          await loadConversationMessagesRef.current();
        }
      } catch {
        // ignore transient refresh failures from burst events
      } finally {
        refreshingConversationsRef.current = false;
      }
    }, 180);
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
        if (convId && conversationsRef.current.some((c) => c.id === convId)) {
          socket.send(JSON.stringify({ event: "join", conversation_id: convId }));
        }
      };

      socket.onmessage = (event) => {
        try {
          if (selectedProjectIdRef.current !== socketProjectId) return;
          const payload = JSON.parse(event.data);

          if (payload.event === "message:new") {
            const message = payload.data as Message;
            setWsNotifKey((k) => k + 1);
            if (
              message.sender_user_id === currentUser?.id &&
              wsPendingSendRef.current?.conversationId === message.conversation_id
            ) {
              wsPendingSendRef.current = null;
            }
            const knownConversation = conversationsRef.current.some((conversation) => conversation.id === message.conversation_id);
            if (!knownConversation) {
              return;
            }
            if (message.conversation_id === selectedConvRef.current) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === message.id)) return prev;
                return [...prev, message];
              });
              scrollToBottom();
              if (message.sender_user_id !== currentUser?.id && wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ event: "read_update", conversation_id: message.conversation_id, message_id: message.id }));
              }
            } else if (message.sender_user_id !== currentUser?.id) {
              setConversations((prev) => {
                const exists = prev.some((c) => c.id === message.conversation_id);
                if (!exists) return prev;
                const updated = prev.map((c) =>
                  c.id === message.conversation_id
                    ? { ...c, unread_count: (c.unread_count || 0) + 1, last_message_at: message.created_at }
                    : c,
                );
                return sortConversationsByActivity(updated);
              });
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
              const next = prev.some((item) => item.id === conversation.id)
                ? prev.map((item) => (item.id === conversation.id ? conversation : item))
                : [conversation, ...prev];
              return sortConversationsByActivity(next);
            });
          } else if (payload.event === "conversation:remove") {
            const d = payload.data as { conversation_id: number };
            setConversations((prev) => prev.filter((conversation) => conversation.id !== d.conversation_id));
            if (d.conversation_id === selectedConvRef.current) {
              setMessages([]);
              setHasMoreOlder(false);
            }
          } else if (payload.event === "members:changed" || payload.event === "operators:changed") {
            setTypingUserId(null);
            setSearchResults(null);
            scheduleConversationRefresh();
          } else if (payload.event === "project:refresh") {
            setTypingUserId(null);
            setSearchResults(null);
            scheduleConversationRefresh();
          } else if (payload.event === "error") {
            const pending = wsPendingSendRef.current;
            if (pending && pending.conversationId === selectedConvRef.current) {
              setChatInput((prev) => (prev.trim() ? prev : pending.content));
              wsPendingSendRef.current = null;
            }
            scheduleConversationRefresh();
          } else if (payload.event === "notification:count") {
            setWsNotifKey((k) => k + 1);
          } else if (payload.event === "chat_session:update") {
            const state = payload.data as ChatSessionState;
            if (state?.conversation_id != null) {
              setSessionsByConversation((prev) => ({ ...prev, [state.conversation_id]: state }));
            }
          }
        } catch {
          // ignore malformed events
        }
      };

      socket.onerror = () => {
        wsRef.current = null;
      };
      socket.onclose = (ev) => {
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
          scheduleConversationRefresh();
          return;
        }
        wsRef.current = null;
        if (intentionalWsCloseRef.current || !token || !selectedProjectId) return;
        const pending = wsPendingSendRef.current;
        if (pending && pending.conversationId === selectedConvRef.current) {
          setChatInput((prev) => (prev.trim() ? prev : pending.content));
          wsPendingSendRef.current = null;
        }
        scheduleConversationRefresh();
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
  }, [token, selectedProjectId, router, currentUser?.id, scheduleConversationRefresh, sortConversationsByActivity]);

  useEffect(() => {
    if (!/^\d{6,16}$/.test(uid ?? "")) {
      router.replace("/operator/login");
      return;
    }
    const user = getUser();
    const savedToken = getToken();
    if (!user || !savedToken || user.role !== "OPERATOR" || user.uid !== uid) {
      router.replace("/operator/login");
      return;
    }
    setCurrentUser(user);
    setToken(savedToken);
  }, [router, uid]);

  useEffect(() => {
    if (token) loadProjects().catch((e) => setError(parseError(e)));
  }, [token, loadProjects]);

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
        reconnectAttemptsRef.current = 0;
        if (refreshConversationsTimerRef.current) {
          clearTimeout(refreshConversationsTimerRef.current);
          refreshConversationsTimerRef.current = null;
        }
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
      scheduleConversationRefresh();
    }, 2000);
    return () => clearInterval(interval);
  }, [token, selectedProjectId, scheduleConversationRefresh]);

  // Reset conversation state when switching projects
  useEffect(() => {
    setSelectedConversationId(null);
    setMessages([]);
    setSearchResults(null);
  }, [selectedProjectId]);

  useEffect(() => {
    setTypingUserId(null);
    setSearchResults(null);
  }, [selectedConversationId]);

  useEffect(() => {
    if (selectedConversationId == null) return;
    if (!visibleConversations.some((conv) => conv.id === selectedConversationId)) {
      setSelectedConversationId(null);
      setMessages([]);
      setHasMoreOlder(false);
      if (isMobile) setMobileShowChat(false);
    }
  }, [visibleConversations, selectedConversationId, isMobile]);

  useEffect(() => {
    if (!isTerminated) {
      hasShownTerminatedPopupRef.current = false;
      setShowTerminatedPopup(false);
      return;
    }
    if (!hasShownTerminatedPopupRef.current) {
      setShowTerminatedPopup(true);
      hasShownTerminatedPopupRef.current = true;
    }
  }, [isTerminated]);

  useEffect(() => {
    if (!isTerminated) return;
    setActivePanel("admin_help");
    if (adminHelpConversation) {
      setSelectedConversationId(adminHelpConversation.id);
      if (isMobile) setMobileShowChat(true);
    } else {
      setSelectedConversationId(null);
    }
  }, [isTerminated, adminHelpConversation, isMobile]);

  useEffect(() => {
    // Only auto-select for terminated operators (admin help thread).
    // Active operators must start with a blank chat until user clicks.
    if (selectedConversationId != null) return;
    if (!isTerminated) return;
    if (visibleConversations.length === 0) return;
    setSelectedConversationId(visibleConversations[0].id);
  }, [selectedConversationId, visibleConversations, isTerminated]);

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

  // Operator Panel shows only the member/customer's email, never their name (name stays
  // available in the backend/API for roles that are meant to see it, e.g. Admin).
  const identityLabel = (user: User, fallback: string): string =>
    user.role === "MEMBER" ? user.email || fallback : user.name;

  const formatSender = (msg: Message): string => {
    if (currentUser && msg.sender_user_id === currentUser.id) return "You";
    const known = knownUsers.get(msg.sender_user_id);
    if (known) return identityLabel(known, `Member #${msg.sender_user_id}`);
    if (msg.sender_role === "ADMIN") return "Admin";
    return `Member #${msg.sender_user_id}`;
  };

  const getConversationTarget = (
    conv: Conversation,
  ): { userId: number | null; label: string; subtitle: string } => {
    if (conv.type === "admin_operator") {
      return { userId: conv.admin_id, label: "Admin", subtitle: "Admin Help" };
    }
    const memberId = conv.member_id;
    if (!memberId) {
      return { userId: null, label: `Conversation #${conv.id}`, subtitle: `Thread #${conv.id}` };
    }
    const member = knownUsers.get(memberId);
    return {
      userId: memberId,
      label: member?.email || `Member #${memberId}`,
      subtitle: member ? member.uid : `Member #${memberId}`,
    };
  };

  const onSendMessage = async () => {
    if (!token || !selectedProjectId || !selectedConversationId || !chatInput.trim()) return;
    const conv = conversations.find((c) => c.id === selectedConversationId) || null;
    if (!conv) {
      setError("Conversation is no longer available.");
      return;
    }
    if (isTerminated && conv.type !== "admin_operator") {
      setError("Terminated operators can only contact admin.");
      return;
    }
    if (isChatSessionClosed) {
      setError("This chat has expired and can no longer receive messages.");
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
    if (!token || !selectedProjectId || !searchQuery.trim()) return;
    try {
      const results = await searchMessages(token, selectedProjectId, searchQuery.trim());
      setSearchResults(results);
    } catch (err) {
      setError(parseError(err));
    }
  };

  const onCloseChat = async () => {
    if (!token || !selectedProjectId || selectedConversationId == null) return;
    setClosingSession(true);
    try {
      const state = await closeChatSession(token, selectedProjectId, selectedConversationId);
      setSessionsByConversation((prev) => ({ ...prev, [selectedConversationId]: state }));
    } catch (err) {
      setThankYouWarning(parseError(err));
    } finally {
      setClosingSession(false);
    }
  };

  const onLogout = () => {
    clearSession();
    router.replace("/operator/login");
  };

  useEffect(() => {
    if (!isMobile) {
      setMobileNavOpen(false);
      setMobileShowChat(false);
    }
  }, [isMobile]);

  if (!currentUser) {
    return (
      <main className="h-screen flex items-center justify-center bg-bg-deep">
        <LoadingState label="Loading…" />
      </main>
    );
  }

  if (projectsLoaded && projects.length === 0) {
    return (
      <main className="h-screen flex flex-col items-center justify-center bg-bg-deep px-6">
        <EmptyState
          icon={<InboxIcon />}
          title="No projects have been assigned to you yet."
          description="Contact your admin to get assigned to a project."
          action={
            <Button variant="ghost" tone="neutral" size="sm" onClick={onLogout}>
              Logout
            </Button>
          }
        />
      </main>
    );
  }

  return (
    <main className="h-screen flex flex-col bg-bg-deep">
      <ToastStack
        toasts={[
          wsReconnecting && { id: "ws", message: "Reconnecting to live chat…", variant: "warning" },
          dataLoading && !!selectedProjectId && { id: "loading", message: "Loading project data…", variant: "info" },
          !!error && { id: "error", message: error, variant: "error", onDismiss: () => setError(null) },
        ]}
      />

      {isMobile && mobileNavOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          aria-label="Close menu"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <header className="h-16 shrink-0 border-b border-white/10 bg-bg-navy flex items-center justify-between px-4">
        <div className="flex items-center gap-3 min-w-0">
          <IconButton
            aria-label="Open menu"
            className="md:hidden"
            onClick={() => setMobileNavOpen(true)}
          >
            <MenuIcon />
          </IconButton>
          <div className="flex items-center gap-3 min-w-0">
            {selectedProject?.logo_url ? (
              <img src={selectedProject.logo_url} alt={selectedProject.name} className="h-11 w-11 rounded-lg object-cover" />
            ) : (
              <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-operator to-operator-dark flex items-center justify-center text-white">
                <HeadsetIcon className="w-5 h-5" />
              </div>
            )}
            <span className="font-semibold text-lg text-white truncate hidden sm:inline">
              {selectedProject?.name || "Operator Panel"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {selectedProjectId && token && (
            <NotificationBell
              token={token}
              projectId={selectedProjectId}
              wsMessageKey={wsNotifKey}
              onNotificationClick={(refId) => {
                if (!refId) return;
                const conv = conversations.find((c) => c.id === refId);
                if (conv) {
                  if (conv.type === "admin_operator") {
                    setActivePanel("admin_help");
                  } else {
                    setActivePanel("inbox");
                  }
                }
                setSelectedConversationId(refId);
                if (isMobile) setMobileShowChat(true);
              }}
            />
          )}
          <div className="flex items-center gap-2 text-sm">
            <PresenceDot online={true} />
            <span className="text-slate-300 font-medium hidden sm:inline">{currentUser.name}</span>
            <Badge color="blue">OPERATOR</Badge>
            <span className="text-xs text-slate-500 bg-white/[0.08] px-1.5 py-0.5 rounded font-mono hidden sm:inline">{uid}</span>
          </div>
        </div>
      </header>

      {isTerminated && (
        <div className="shrink-0 bg-danger-light border-b border-danger/20 text-red-200 text-sm px-4 py-3 text-center font-medium flex items-center justify-center gap-2">
          <AlertTriangleIcon className="h-4 w-4 shrink-0" />
          {selectedProject?.operator_terminated_message || "Your ID is terminated. Please contact admin."}
        </div>
      )}

      <Modal
        open={showTerminatedPopup}
        onClose={() => setShowTerminatedPopup(false)}
        size="sm"
      >
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-danger-light text-danger">
            <AlertTriangleIcon className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold text-red-300 mb-3">Access Restricted</h2>
          <p className="text-sm text-slate-300 mb-6">
            {selectedProject?.operator_terminated_message || "Your ID is terminated. Please contact admin."}
          </p>
          <Button
            tone="operator"
            fullWidth
            onClick={() => {
              setShowTerminatedPopup(false);
              setActivePanel("admin_help");
              if (adminHelpConversation) {
                setSelectedConversationId(adminHelpConversation.id);
                if (isMobile) setMobileShowChat(true);
              }
            }}
          >
            Contact Admin
          </Button>
        </div>
      </Modal>

      <Modal open={thankYouWarning != null} onClose={() => setThankYouWarning(null)} size="sm">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-400/10 text-amber-400">
            <AlertTriangleIcon className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold text-white mb-3">Can&apos;t close this chat yet</h2>
          <p className="text-sm text-slate-300 mb-6">{thankYouWarning}</p>
          <Button tone="operator" fullWidth onClick={() => setThankYouWarning(null)}>
            Continue Chat
          </Button>
        </div>
      </Modal>

      <div className="flex-1 flex min-h-0">
        <aside
          className={`w-52 shrink-0 border-r border-white/10 bg-bg-navy flex flex-col z-50 md:z-auto
            ${isMobile ? (mobileNavOpen ? "fixed top-16 left-0 bottom-0 flex shadow-xl" : "hidden") : "flex"}
            md:flex`}
        >
          <nav className="flex-1 p-3 space-y-1">
            {((isTerminated ? ["admin_help", "analytics"] : ["dashboard", "inbox", "admin_help", "analytics"]) as Panel[]).map((item) => (
              <button
                key={item}
                onClick={() => {
                  setActivePanel(item);
                  setMobileNavOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  activePanel === item ? "bg-operator-light text-operator" : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                {item === "dashboard" && <GridIcon className="w-4.5 h-4.5" />}
                {item === "inbox" && <InboxIcon className="w-4.5 h-4.5" />}
                {item === "admin_help" && <HeadsetIcon className="w-4.5 h-4.5" />}
                {item === "analytics" && <ChartBarIcon className="w-4.5 h-4.5" />}
                {item === "dashboard" ? "Dashboard" : item === "inbox" ? "Inbox" : item === "admin_help" ? "Help" : "My Analytics"}
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

        <div className={activePanel === "analytics" || activePanel === "dashboard" ? "hidden" : "flex-1 flex min-h-0 min-w-0"}>
              <aside
                className={`w-full md:w-72 shrink-0 border-r border-white/10 bg-bg-navy flex flex-col min-h-0 ${
                  isMobile && mobileShowChat ? "hidden md:flex" : "flex"
                }`}
              >
                <div className="px-4 py-3 border-b border-white/5 space-y-2.5">
                  <h2 className="text-sm font-semibold text-white">{isTerminated ? "Help" : "Conversations"}</h2>
                  {(activePanel === "admin_help" || isTerminated) && (selectedProject?.support_email || selectedProject?.support_phone) && (
                    <div className="rounded-xl border border-operator/20 bg-operator-light px-3 py-2 text-xs text-operator space-y-1">
                      <div className="font-medium">Project Help Contact</div>
                      {selectedProject?.support_email && <div>Email: {selectedProject.support_email}</div>}
                      {selectedProject?.support_phone && <div>Phone: {selectedProject.support_phone}</div>}
                    </div>
                  )}
                  {!isTerminated && (
                    <div className="flex gap-1.5">
                      <SearchInput
                        tone="operator"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && onSearch()}
                        placeholder="Search messages…"
                        className="flex-1"
                      />
                      <Button tone="operator" variant="subtle" size="sm" onClick={onSearch}>
                        Search
                      </Button>
                    </div>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto">
                  {visibleConversations.map((conv) => {
                    const target = getConversationTarget(conv);
                    const isActive = conv.id === selectedConversationId;
                    const unread = conv.unread_count || 0;
                    return (
                      <button
                        key={conv.id}
                        onClick={() => {
                          setSelectedConversationId(conv.id);
                          if (isMobile) setMobileShowChat(true);
                        }}
                        className={`w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer ${isActive ? "bg-operator-light" : ""}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Avatar name={target.label} tone="neutral" size="sm" />
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-white truncate">{target.label}</div>
                              <div className="text-xs text-slate-500 truncate">{target.subtitle}</div>
                            </div>
                          </div>
                          {unread > 0 && (
                            <Badge color="blue" className="px-1.5 py-0 min-w-[1.25rem] justify-center">
                              {unread}
                            </Badge>
                          )}
                        </div>
                      </button>
                    );
                  })}
                  {visibleConversations.length === 0 && !searchResults && (
                    <EmptyState icon={<InboxIcon />} title="No conversations yet" />
                  )}
                  {searchResults !== null && (
                    <div className="px-4 py-3 border-t border-white/5">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-slate-400">Search results</span>
                        <button onClick={() => setSearchResults(null)} className="text-xs text-slate-500 hover:text-slate-400 cursor-pointer">Close</button>
                      </div>
                      <div className="max-h-40 overflow-y-auto space-y-2">
                        {searchResults.length === 0 ? <p className="text-xs text-slate-500">No matches</p> : searchResults.map((m) => (
                          <div key={m.id} className="text-xs p-2 rounded-lg bg-bg-deep border border-white/5">
                            <p className="text-slate-300 line-clamp-2">{m.content || "(attachment)"}</p>
                            <span className="text-slate-500">{formatSender(m)} · {new Date(m.created_at).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </aside>

              <section
                className={`flex-1 flex flex-col min-h-0 bg-bg-deep min-w-0 ${
                  isMobile && !mobileShowChat ? "hidden md:flex" : "flex"
                }`}
              >
                {selectedConversation ? (
                  <>
                    <div className="h-14 shrink-0 border-b border-white/10 bg-bg-navy flex items-center justify-between px-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <IconButton
                          aria-label="Back to conversations"
                          className="md:hidden"
                          onClick={() => setMobileShowChat(false)}
                        >
                          <ChevronLeftIcon />
                        </IconButton>
                        <Avatar name={getConversationTarget(selectedConversation).label} tone="operator" size="sm" />
                        <div>
                          <div className="text-sm font-medium text-white">{getConversationTarget(selectedConversation).label}</div>
                          <div className="text-xs text-slate-500">{getConversationTarget(selectedConversation).subtitle}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {(() => {
                          const t = getConversationTarget(selectedConversation);
                          const tp = t.userId ? presence[t.userId] : null;
                          if (!tp) return null;
                          return (
                            <span className={`text-xs flex items-center gap-1.5 ${tp.is_online ? "text-emerald-600" : "text-slate-500"}`}>
                              <PresenceDot online={tp.is_online} />
                              {tp.is_online ? "Online" : "Offline"}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                    {selectedConversation.type === "operator_member" && (
                      <ChatTimerBar
                        session={sessionsByConversation[selectedConversation.id] ?? null}
                        onCloseChat={onCloseChat}
                        closing={closingSession}
                      />
                    )}
                    <div
                      className="flex-1 overflow-y-auto p-4 space-y-3"
                      style={{ userSelect: 'none' }}
                      onCopy={(e) => e.preventDefault()}
                    >
                      {hasMoreOlder && (
                        <div className="flex justify-center py-2">
                          <button type="button" onClick={loadOlderMessages} disabled={loadingOlder} className="text-xs text-operator hover:underline disabled:opacity-50 cursor-pointer">
                            {loadingOlder ? "Loading…" : "Load older messages"}
                          </button>
                        </div>
                      )}
                      {messages.map((msg) => {
                        const isMe = msg.sender_user_id === currentUser.id;
                        const isBroadcast = msg.message_type === "admin_broadcast";
                        return (
                          <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                            <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 shadow-soft ${isBroadcast ? "bg-amber-400/10 border border-amber-400/30 text-amber-200" : isMe ? "bg-operator text-white" : "bg-white/[0.06] border border-white/10 text-white"}`}>
                              {!isMe && <div className={`text-xs font-medium mb-1 ${isBroadcast ? "text-amber-300" : "text-slate-400"}`}>{formatSender(msg)}{isBroadcast ? " (Broadcast)" : ""}</div>}
                              {msg.attachment_url && (
                                <div className="mb-1.5">
                                  {msg.attachment_mime?.startsWith("image/") ? (
                                    <AttachmentImage url={msg.attachment_url} token={token!} />
                                  ) : (
                                    <AttachmentLink url={msg.attachment_url} filename={msg.attachment_filename} token={token!} isMe={isMe} tone="operator" />
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
                        {(() => {
                          const typingUser = knownUsers.get(typingUserId);
                          return typingUser ? identityLabel(typingUser, `User #${typingUserId}`) : `User #${typingUserId}`;
                        })()} is typing…
                      </div>
                    )}
                    <div className="shrink-0 border-t border-white/10 bg-bg-navy p-3">
                      <div className="flex items-end gap-2">
                        <input ref={fileInputRef} type="file" className="hidden" onChange={onFileSelect} />
                        <IconButton
                          aria-label="Attach file"
                          variant="outline"
                          tone="neutral"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploading || isTerminated || isChatSessionClosed}
                        >
                          <PaperclipIcon />
                        </IconButton>
                        <Textarea
                          tone="operator"
                          value={chatInput}
                          onChange={onChatInputChange}
                          onBlur={sendTypingStop}
                          onKeyDown={onKeyDown}
                          placeholder={
                            isChatSessionClosed
                              ? "This chat has ended."
                              : isTerminated
                                ? "Help note to admin…"
                                : "Type a message…"
                          }
                          rows={1}
                          disabled={isChatSessionClosed || (isTerminated && selectedConversation?.type !== "admin_operator")}
                          className="flex-1"
                        />
                        <IconButton
                          aria-label="Send message"
                          tone="operator"
                          variant="solid"
                          onClick={onSendMessage}
                          disabled={
                            !chatInput.trim() ||
                            isChatSessionClosed ||
                            (isTerminated && selectedConversation?.type !== "admin_operator")
                          }
                        >
                          <SendIcon />
                        </IconButton>
                      </div>
                    </div>
                  </>
                ) : (
                  <EmptyState
                    icon={<ChatBubbleIcon />}
                    title={isTerminated ? "Use Help to contact admin" : "Select a conversation to start chatting"}
                    className="flex-1"
                  />
                )}
              </section>
        </div>

        {activePanel === "analytics" && token && (
          <section className="flex-1 overflow-y-auto p-6">
            <div className="max-w-6xl mx-auto">
              <h1 className="mb-5 text-lg font-semibold text-white">My Analytics</h1>
              <OperatorAnalyticsDashboard token={token} projects={projects} tone="operator" />
            </div>
          </section>
        )}

        {activePanel === "dashboard" && token && (
          <section className="flex-1 overflow-y-auto">
            <OperatorDashboardHome token={token} currentUser={currentUser} projectId={selectedProjectId} />
          </section>
        )}
      </div>
    </main>
  );
}
