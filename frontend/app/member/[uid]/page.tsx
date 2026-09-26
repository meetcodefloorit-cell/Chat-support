"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";

import { AttachmentImage, AttachmentLink } from "@/components/AttachmentDisplay";
import { NotificationBell } from "@/components/NotificationBell";
import { PresenceDot } from "@/components/PresenceDot";
import {
  getConversations,
  getMessages,
  getMyOperator,
  getOperators,
  getPresence,
  getProjects,
  postMessage,
  searchMessages,
  uploadAttachment,
  getProjectStatus,
} from "@/lib/api";
import { clearSession, getToken, getLoginPath, getUser } from "@/lib/auth";
import { useIsMobile } from "@/hooks/useIsMobile";
import { parseError } from "@/lib/parseError";
import { buildWebSocketUrl } from "@/lib/ws";
import { Conversation, Message, Presence, Project, User } from "@/lib/types";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { SearchInput } from "@/components/ui/SearchInput";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/Skeleton";
import { ToastStack } from "@/components/ui/Toast";
import {
  ChatBubbleIcon,
  ChevronLeftIcon,
  CheckDoubleIcon,
  GridIcon,
  HistoryIcon,
  LogoutIcon,
  PaperclipIcon,
  SendIcon,
  AlertTriangleIcon,
} from "@/components/ui/icons";
import { MemberHome } from "@/components/dashboard/MemberHome";
import { MemberHistory } from "@/components/dashboard/MemberHistory";

type MemberPanel = "home" | "chat" | "history";

export default function MemberWorkspace() {
  const router = useRouter();
  const params = useParams();
  const uid = params.uid as string;
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalWsCloseRef = useRef(false);
  const refreshWorkspaceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshingWorkspaceRef = useRef(false);
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

  const [knownUsersRaw, setKnownUsersRaw] = useState<User[]>([]);
  const [myOperator, setMyOperator] = useState<User | null>(null);
  const [presence, setPresence] = useState<Record<number, Presence>>({});
  const [isTerminated, setIsTerminated] = useState(false);

  const [chatInput, setChatInput] = useState("");
  const [error, setError] = useState<string | null>(null);
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
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const [activePanel, setActivePanel] = useState<MemberPanel>("home");

  const selectedProject = useMemo(() => projects.find((p) => p.id === selectedProjectId) || null, [projects, selectedProjectId]);
  const visibleConversations = useMemo(() => conversations, [conversations]);
  const selectedConversation = useMemo(() => visibleConversations.find((c) => c.id === selectedConversationId) || null, [visibleConversations, selectedConversationId]);

  const knownUsers = useMemo(() => {
    const map = new Map<number, User>();
    if (currentUser) map.set(currentUser.id, currentUser);
    knownUsersRaw.forEach((u) => map.set(u.id, u));
    return map;
  }, [currentUser, knownUsersRaw]);

  const scrollToBottom = () => { setTimeout(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, 50); };

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

    const nextProject = data[0] ?? null;
    setSelectedProjectId(nextProject ? nextProject.id : null);
    if (!nextProject) {
      setConversations([]);
      setSelectedConversationId(null);
      setMessages([]);
      setKnownUsersRaw([]);
      setMyOperator(null);
      setPresence({});
      setIsTerminated(false);
    }
  }, [token, selectedProjectId]);

  const loadProjectData = useCallback(async () => {
    if (!token || !selectedProjectId) return;
    if (!initialLoadDoneRef.current) setDataLoading(true);
    try {
      const [convRes, operatorRes, presenceRes, statusRes] = await Promise.all([
        getConversations(token, selectedProjectId),
        getOperators(token, selectedProjectId),
        getPresence(token, selectedProjectId),
        getProjectStatus(token, selectedProjectId),
      ]);
      setIsTerminated(statusRes.status === "terminated" || statusRes.status === "TERMINATED");

      const sortedConversations = sortConversationsByActivity(convRes);
      setConversations(sortedConversations);
      setSelectedConversationId((prev) => {
        if (prev != null && sortedConversations.some((c) => c.id === prev)) return prev;
        return sortedConversations.length > 0 ? sortedConversations[0].id : null;
      });
      setKnownUsersRaw(operatorRes);
      const pMap: Record<number, Presence> = {};
      presenceRes.forEach((item) => { pMap[item.user_id] = item; });
      setPresence(pMap);

      try {
        const op = await getMyOperator(token, selectedProjectId);
        setMyOperator(op);
      } catch {
        setMyOperator(null);
      }
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
  }, [token, selectedProjectId, sortConversationsByActivity, loadProjects]);

  const loadConversationMessages = useCallback(async () => {
    if (!token || !selectedProjectId || !selectedConversationId) { setMessages([]); setHasMoreOlder(false); return; }
    const reqId = ++loadConversationMessagesReqIdRef.current;
    setMessages([]);
    setHasMoreOlder(false);
    let data: Message[] = [];
    try {
      data = await getMessages(token, selectedProjectId, selectedConversationId, 50, 0);
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
    } catch (e) {
      if (reqId !== loadConversationMessagesReqIdRef.current) return;
      const msg = parseError(e);
      const normalized = msg.toLowerCase();
      if (normalized.includes("project not found") || normalized.includes("no access to this project")) {
        await loadProjects();
        await loadProjectData();
        return;
      }
      if (normalized.includes("conversation not found") || msg.includes("404") || normalized.includes("not found")) {
        await loadProjectData();
        setSelectedConversationId(null);
        return;
      }
      setError(msg);
    }
    if (reqId !== loadConversationMessagesReqIdRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ event: "join", conversation_id: selectedConversationId }));
      const myId = currentUser?.id;
      if (myId) {
        data.filter((m) => m.sender_user_id !== myId).forEach((m) => {
          wsRef.current?.send(JSON.stringify({ event: "read_update", conversation_id: selectedConversationId, message_id: m.id }));
        });
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
  useEffect(() => { selectedConvRef.current = selectedConversationId; }, [selectedConversationId]);
  useEffect(() => { selectedProjectIdRef.current = selectedProjectId; }, [selectedProjectId]);

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

  const scheduleWorkspaceRefresh = useCallback(() => {
    if (refreshWorkspaceTimerRef.current) return;
    refreshWorkspaceTimerRef.current = setTimeout(async () => {
      refreshWorkspaceTimerRef.current = null;
      if (refreshingWorkspaceRef.current) return;
      refreshingWorkspaceRef.current = true;
      try {
        await loadProjectDataRef.current();
        if (selectedConvRef.current != null) {
          await loadConversationMessagesRef.current();
        }
      } catch {
        // ignore transient refresh failures from burst events
      } finally {
        refreshingWorkspaceRef.current = false;
      }
    }, 180);
  }, []);

  const connectSocket = useCallback(() => {
    if (!token || !selectedProjectId) return;
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
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
              setMessages((prev) => prev.map((m) => {
                if (m.id !== d.message_id) return m;
                const ids = m.read_by_user_ids || [];
                if (ids.includes(d.user_id)) return m;
                return { ...m, read_by_user_ids: [...ids, d.user_id] };
              }));
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
            list.forEach((item) => { map[item.user_id] = item; });
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
                  ? { ...c, unread_count: 0, last_message_at: null }
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
            scheduleWorkspaceRefresh();
          } else if (payload.event === "project:refresh") {
            setTypingUserId(null);
            setSearchResults(null);
            scheduleWorkspaceRefresh();
          } else if (payload.event === "error") {
            const pending = wsPendingSendRef.current;
            if (pending && pending.conversationId === selectedConvRef.current) {
              setChatInput((prev) => (prev.trim() ? prev : pending.content));
              wsPendingSendRef.current = null;
            }
            scheduleWorkspaceRefresh();
          } else if (payload.event === "notification:count") {
            setWsNotifKey((k) => k + 1);
          }
        } catch {}
      };
      socket.onerror = () => { wsRef.current = null; };
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
          scheduleWorkspaceRefresh();
          return;
        }
        wsRef.current = null;
        if (intentionalWsCloseRef.current || !token || !selectedProjectId) return;
        const pending = wsPendingSendRef.current;
        if (pending && pending.conversationId === selectedConvRef.current) {
          setChatInput((prev) => (prev.trim() ? prev : pending.content));
          wsPendingSendRef.current = null;
        }
        scheduleWorkspaceRefresh();
        setWsReconnecting(true);
        const delay = Math.min(8000, 750 * Math.pow(2, reconnectAttemptsRef.current));
        reconnectAttemptsRef.current += 1;
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          connectSocket();
        }, delay);
      };
    } catch { wsRef.current = null; }
  }, [token, selectedProjectId, router, currentUser?.id, scheduleWorkspaceRefresh, sortConversationsByActivity]);

  useEffect(() => {
    if (!/^\d{6,16}$/.test(uid ?? "")) {
      router.replace("/member/login");
      return;
    }
    const user = getUser();
    const savedToken = getToken();
    if (!user || !savedToken || user.role !== "MEMBER" || user.uid !== uid) {
      router.replace("/member/login");
      return;
    }
    setCurrentUser(user);
    setToken(savedToken);
  }, [router, uid]);

  useEffect(() => { if (token) loadProjects().catch((e) => setError(parseError(e))); }, [token, loadProjects]);
  useEffect(() => { if (token && selectedProjectId) { loadProjectData().catch((e) => setError(parseError(e))); } }, [token, selectedProjectId, loadProjectData]);
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
        if (refreshWorkspaceTimerRef.current) {
          clearTimeout(refreshWorkspaceTimerRef.current);
          refreshWorkspaceTimerRef.current = null;
        }
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }
      };
    }
  }, [token, selectedProjectId, connectSocket]);
  useEffect(() => { loadConversationMessages().catch((e) => setError(parseError(e))); }, [loadConversationMessages]);
  useEffect(() => {
    if (!token || !selectedProjectId) return;
    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      scheduleWorkspaceRefresh();
    }, 2000);
    return () => clearInterval(interval);
  }, [token, selectedProjectId, scheduleWorkspaceRefresh]);

  // Reset conversation state when switching projects
  useEffect(() => {
    setSelectedConversationId(null);
    setMessages([]);
    setSearchResults(null);
  }, [selectedProjectId]);

  useEffect(() => { setTypingUserId(null); setSearchResults(null); }, [selectedConversationId]);

  useEffect(() => {
    if (selectedConversationId == null) return;
    if (!visibleConversations.some((conv) => conv.id === selectedConversationId)) {
      setSelectedConversationId(null);
      setMessages([]);
      setHasMoreOlder(false);
      if (isMobile) setMobileView("list");
    }
  }, [visibleConversations, selectedConversationId, isMobile]);

  useEffect(() => {
    if (selectedConversationId != null) return;
    if (visibleConversations.length === 0) return;
    setSelectedConversationId(visibleConversations[0].id);
  }, [selectedConversationId, visibleConversations]);

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
      typingTimeoutRef.current = setTimeout(() => { sendTypingStop(); typingTimeoutRef.current = null; }, 3000);
    }
  };

  const getConversationTarget = (conv: Conversation): { userId: number | null; label: string } => {
    const op = knownUsers.get(conv.operator_id);
    return { userId: conv.operator_id, label: op?.name || `Operator #${conv.operator_id}` };
  };

  const formatSender = (msg: Message): string => {
    if (currentUser && msg.sender_user_id === currentUser.id) return "You";
    const known = knownUsers.get(msg.sender_user_id);
    if (known) return known.name;
    if (msg.sender_role === "ADMIN") return "Admin";
    if (msg.sender_role === "OPERATOR") return `Operator #${msg.sender_user_id}`;
    return `User #${msg.sender_user_id}`;
  };

  const onSendMessage = async () => {
    if (!token || !selectedProjectId || !selectedConversationId || !chatInput.trim()) return;
    sendTypingStop();
    if (typingTimeoutRef.current) { clearTimeout(typingTimeoutRef.current); typingTimeoutRef.current = null; }
    const content = chatInput.trim();
    setChatInput("");
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsPendingSendRef.current = { conversationId: selectedConversationId, content };
        wsRef.current.send(JSON.stringify({ event: "message", conversation_id: selectedConversationId, content }));
      } else {
        const message = await postMessage(token, selectedProjectId, selectedConversationId, content);
        setMessages((prev) => [...prev, message]); scrollToBottom();
      }
    } catch (e) {
      setChatInput((prev) => (prev.trim() ? prev : content));
      wsPendingSendRef.current = null;
      setError(parseError(e));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSendMessage(); } };

  const onFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token || !selectedProjectId || !selectedConversationId) return;
    e.target.value = "";
    setUploading(true); setError(null);
    try {
      const msg = await uploadAttachment(token, selectedProjectId, selectedConversationId, file);
      setMessages((prev) => [...prev, msg]); scrollToBottom();
    } catch (err) { setError(parseError(err)); } finally { setUploading(false); }
  };

  const onSearch = async () => {
    if (!token || !selectedProjectId || !searchQuery.trim()) return;
    try {
      const results = await searchMessages(token, selectedProjectId, searchQuery.trim());
      setSearchResults(results);
    } catch (err) { setError(parseError(err)); }
  };
  const onLogout = () => { clearSession(); router.replace("/member/login"); };

  useEffect(() => {
    if (!isMobile) setMobileView("list");
  }, [isMobile]);

  if (!currentUser) {
    return (
      <main className="h-screen flex items-center justify-center bg-bg-deep">
        <LoadingState label="Loading…" />
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

      <header className="h-16 shrink-0 border-b border-white/10 bg-bg-navy flex items-center justify-between px-4">
        <div className="flex items-center gap-3 min-w-0">
          <IconButton
            aria-label="Home"
            className="md:hidden"
            onClick={() => setActivePanel("home")}
          >
            <GridIcon />
          </IconButton>
          {selectedProject?.logo_url ? (
            <img src={selectedProject.logo_url} alt={selectedProject.name} className="h-10 w-10 rounded-lg object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-member to-member-dark flex items-center justify-center text-white">
              <ChatBubbleIcon className="w-5 h-5" />
            </div>
          )}
          <span className="font-semibold text-lg text-white truncate">
            {selectedProject?.name || "Member Panel"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {selectedProjectId && token && (
            <NotificationBell
              token={token}
              projectId={selectedProjectId}
              wsMessageKey={wsNotifKey}
              onNotificationClick={(refId) => {
                if (refId) {
                  setSelectedConversationId(refId);
                  if (isMobile) setMobileView("chat");
                }
              }}
            />
          )}
          <div className="flex items-center gap-2 text-sm">
            <PresenceDot online={true} />
            <span className="text-slate-300 font-medium hidden sm:inline">{currentUser.name}</span>
            <Badge color="violet">MEMBER</Badge>
            <span className="text-xs text-slate-500 bg-white/[0.08] px-1.5 py-0.5 rounded font-mono hidden sm:inline">{uid}</span>
          </div>
        </div>
      </header>

      {isTerminated && (
        <div className="shrink-0 bg-danger-light border-b border-danger/20 text-red-200 text-sm px-4 py-3 text-center font-medium flex items-center justify-center gap-2">
          <AlertTriangleIcon className="h-4 w-4 shrink-0" />
          Your account has been terminated from this project. You can view history but cannot interact.
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Section nav sidebar */}
        <aside className="w-52 shrink-0 border-r border-white/10 bg-bg-navy flex flex-col z-40 hidden md:flex">
          <nav className="flex-1 p-3 space-y-1">
            {(["home", "chat", "history"] as MemberPanel[]).map((item) => (
              <button
                key={item}
                onClick={() => setActivePanel(item)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  activePanel === item ? "bg-member-light text-member" : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                {item === "home" && <GridIcon className="w-4.5 h-4.5" />}
                {item === "chat" && <ChatBubbleIcon className="w-4.5 h-4.5" />}
                {item === "history" && <HistoryIcon className="w-4.5 h-4.5" />}
                {item === "home" ? "Home" : item === "chat" ? "Chat" : "My History"}
              </button>
            ))}
          </nav>
          <div className="p-3 border-t border-white/5">
            <Button variant="ghost" tone="danger" fullWidth className="justify-start" leftIcon={<LogoutIcon />} onClick={onLogout}>
              Logout
            </Button>
          </div>
        </aside>

        {activePanel === "home" && (
          <section className="flex-1 overflow-y-auto">
            <MemberHome
              currentUser={currentUser}
              project={selectedProject}
              myOperator={myOperator}
              conversations={conversations}
              onStartConversation={() => {
                setActivePanel("chat");
                if (isMobile) setMobileView("chat");
                const target = conversations.find((c) => c.type === "operator_member") || conversations[0];
                if (target) setSelectedConversationId(target.id);
              }}
              onOpenConversation={(id) => {
                setActivePanel("chat");
                setSelectedConversationId(id);
                if (isMobile) setMobileView("chat");
              }}
              onGoToHistory={() => setActivePanel("history")}
            />
          </section>
        )}

        {activePanel === "history" && (
          <section className="flex-1 overflow-y-auto">
            <MemberHistory
              conversations={conversations}
              onOpenConversation={(id) => {
                setActivePanel("chat");
                setSelectedConversationId(id);
                if (isMobile) setMobileView("chat");
              }}
            />
          </section>
        )}

        {activePanel !== "chat" ? null : (
        <>
        {/* Conversation list sidebar */}
        <aside
          className={`w-full md:w-72 shrink-0 border-r border-white/10 bg-bg-navy flex flex-col min-h-0 ${
            isMobile && mobileView === "chat" ? "hidden md:flex" : "flex"
          }`}
        >
          <div className="px-4 py-3 border-b border-white/5 space-y-2.5">
            <h2 className="text-sm font-semibold text-white">Your Conversations</h2>
            {myOperator && (
              <div className="flex items-center gap-2.5 px-2.5 py-2 bg-member-light rounded-xl">
                <Avatar name={myOperator.name} tone="member" size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-member-dark truncate">Your Operator</div>
                  <div className="text-xs text-member truncate">{myOperator.name}</div>
                </div>
                {presence[myOperator.id] && <PresenceDot online={presence[myOperator.id].is_online} />}
              </div>
            )}
            <div className="flex gap-1.5">
              <SearchInput
                tone="member"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onSearch()}
                placeholder="Search messages…"
                className="flex-1"
              />
              <Button tone="member" variant="subtle" size="sm" onClick={onSearch}>
                Search
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {visibleConversations.map((conv) => {
              const target = getConversationTarget(conv);
              const tp = target.userId ? presence[target.userId] : null;
              return (
                <button
                  key={conv.id}
                  onClick={() => {
                    setSelectedConversationId(conv.id);
                    setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, unread_count: 0 } : c)));
                    if (isMobile) setMobileView("chat");
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-white/5 transition-colors cursor-pointer ${selectedConversationId === conv.id ? "bg-member-light" : "hover:bg-white/5"}`}
                >
                  <div className="relative shrink-0">
                    <Avatar name={target.label} tone="neutral" size="sm" />
                    {tp && <PresenceDot online={tp.is_online} className="absolute -bottom-0.5 -right-0.5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-white truncate flex items-center gap-2">
                      {target.label}
                      {(conv.unread_count || 0) > 0 && (
                        <Badge color="violet" className="px-1.5 py-0 min-w-[1.25rem] justify-center">
                          {conv.unread_count}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 truncate">Support Chat</div>
                  </div>
                </button>
              );
            })}
            {visibleConversations.length === 0 && !searchResults && (
              <EmptyState
                icon={<ChatBubbleIcon />}
                title="No conversations yet"
                description="Your operator will reach out to you."
              />
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

        {/* Chat area */}
        <section
          className={`flex-1 flex flex-col min-h-0 bg-bg-deep min-w-0 ${
            isMobile && mobileView === "list" ? "hidden md:flex" : "flex"
          }`}
        >
          {selectedConversation ? (
            <>
              <div className="h-14 shrink-0 border-b border-white/10 bg-bg-navy flex items-center justify-between px-4">
                <div className="flex items-center gap-3 min-w-0">
                  <IconButton
                    aria-label="Back to conversations"
                    className="md:hidden"
                    onClick={() => setMobileView("list")}
                  >
                    <ChevronLeftIcon />
                  </IconButton>
                  <Avatar name={getConversationTarget(selectedConversation).label} tone="member" size="sm" />
                  <div>
                    <div className="text-sm font-medium text-white">{getConversationTarget(selectedConversation).label}</div>
                    <div className="text-xs text-slate-500">Support Chat</div>
                  </div>
                </div>
                {(() => { const t = getConversationTarget(selectedConversation); const tp = t.userId ? presence[t.userId] : null; if (!tp) return null; return <span className={`text-xs flex items-center gap-1.5 ${tp.is_online ? "text-success" : "text-slate-500"}`}><PresenceDot online={tp.is_online} />{tp.is_online ? "Online" : "Offline"}</span>; })()}
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {hasMoreOlder && (
                  <div className="flex justify-center py-2">
                    <button type="button" onClick={loadOlderMessages} disabled={loadingOlder} className="text-xs text-member hover:underline disabled:opacity-50 cursor-pointer">
                      {loadingOlder ? "Loading…" : "Load older messages"}
                    </button>
                  </div>
                )}
                {messages.map((msg) => {
                  const isMe = msg.sender_user_id === currentUser.id;
                  const isBroadcast = msg.message_type === "admin_broadcast";
                  return (
                    <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 shadow-soft ${isBroadcast ? "bg-amber-400/10 border border-amber-400/30 text-amber-200" : isMe ? "bg-member text-white" : "bg-white/[0.06] border border-white/10 text-white"}`}>
                        {!isMe && <div className={`text-xs font-medium mb-1 ${isBroadcast ? "text-amber-300" : "text-slate-400"}`}>{formatSender(msg)}{isBroadcast ? " (Announcement)" : ""}</div>}
                        {msg.attachment_url && (
                          <div className="mb-1.5">
                            {msg.attachment_mime?.startsWith("image/") ? (
                              <AttachmentImage url={msg.attachment_url} token={token} />
                            ) : (
                              <AttachmentLink url={msg.attachment_url} filename={msg.attachment_filename} token={token} isMe={isMe} tone="member" />
                            )}
                          </div>
                        )}
                        {msg.content && <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>}
                        <div className={`text-[10px] mt-1 flex items-center gap-1.5 ${isMe ? "text-white/70" : isBroadcast ? "text-amber-400" : "text-slate-500"}`}>
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          {isMe && (() => {
                            const otherIds = (msg.read_by_user_ids || []).filter((id) => id !== currentUser.id);
                            return otherIds.length > 0 ? <CheckDoubleIcon className="h-3.5 w-3.5 opacity-90" /> : null;
                          })()}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {messages.length === 0 && (
                  <div className="flex items-center justify-center h-full text-sm text-slate-500">No messages yet</div>
                )}
                <div ref={messagesEndRef} />
              </div>
              {typingUserId && typingUserId !== currentUser?.id && (
                <div className="shrink-0 px-4 py-1 text-xs text-slate-400 italic">
                  {knownUsers.get(typingUserId)?.name || `Operator`} is typing…
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
                    disabled={uploading || isTerminated}
                  >
                    <PaperclipIcon />
                  </IconButton>
                  <Textarea
                    tone="member"
                    value={chatInput}
                    onChange={onChatInputChange}
                    onBlur={sendTypingStop}
                    onKeyDown={onKeyDown}
                    placeholder={isTerminated ? "You cannot send messages." : "Type a message…"}
                    disabled={isTerminated}
                    rows={1}
                    className="flex-1"
                  />
                  <IconButton
                    aria-label="Send message"
                    tone="member"
                    variant="solid"
                    onClick={onSendMessage}
                    disabled={!chatInput.trim() || isTerminated}
                  >
                    <SendIcon />
                  </IconButton>
                </div>
              </div>
            </>
          ) : (
            <EmptyState
              icon={<ChatBubbleIcon />}
              title="Select a conversation to chat"
              className="flex-1"
            />
          )}
        </section>
        </>
        )}
      </div>
    </main>
  );
}
