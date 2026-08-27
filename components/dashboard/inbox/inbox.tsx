"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { InboxIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ConversationDisplay } from "@/components/dashboard/inbox/conversation-display";
import { ConversationListPane } from "@/components/dashboard/inbox/conversation-list";
import {
  conversationLabel,
  type ConversationId,
} from "@/components/dashboard/inbox/types";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";

function createClientMessageId() {
  return window.crypto.randomUUID();
}

function ConversationLoadingSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-label="Loading conversation">
      <div className="flex min-h-16 items-center gap-3 px-4">
        <Skeleton className="size-8 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-6 px-6 py-8">
        <Skeleton className="h-16 w-3/5 rounded-xl" />
        <Skeleton className="h-20 w-1/2 self-end rounded-xl" />
        <Skeleton className="h-14 w-2/5 rounded-xl" />
      </div>
      <div className="p-4">
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    </div>
  );
}

function EmptyInbox() {
  return (
    <Empty className="h-full min-h-80">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <InboxIcon />
        </EmptyMedia>
        <EmptyTitle>No conversations yet</EmptyTitle>
        <EmptyDescription>
          When a visitor sends a message from your widget, it will appear here.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function Inbox() {
  const {
    results: conversations,
    status: conversationStatus,
    loadMore: loadMoreConversations,
  } = usePaginatedQuery(
    api.inbox.listConversations,
    {},
    { initialNumItems: 50 },
  );
  const [selectedId, setSelectedId] = useState<ConversationId | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);
  const [viewport, setViewport] = useState<"desktop" | "mobile" | null>(null);
  const [now, setNow] = useState(Date.now);
  const [replyState, setReplyState] = useState<{
    conversationId: ConversationId | null;
    pending: boolean;
    error: string | null;
  }>({ conversationId: null, pending: false, error: null });
  const [resolveState, setResolveState] = useState<{
    conversationId: ConversationId | null;
    pending: boolean;
    error: string | null;
  }>({ conversationId: null, pending: false, error: null });
  const replyAttempt = useRef<{
    conversationId: ConversationId;
    body: string;
    clientMessageId: string;
  } | null>(null);
  const resolveAttempt = useRef<{
    conversationId: ConversationId;
    clientMessageId: string;
  } | null>(null);
  const activeConversationId = useRef<ConversationId | null>(null);
  const sendReply = useMutation(api.inbox.sendReply);
  const resolveConversation = useMutation(api.inbox.resolve);
  const markRead = useMutation(api.inbox.markRead);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const syncViewport = () =>
      setViewport(media.matches ? "desktop" : "mobile");
    syncViewport();
    media.addEventListener("change", syncViewport);
    return () => media.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    if (selectedId || !conversations[0]) return;
    const initialConversationId = conversations[0]._id;
    const timer = window.setTimeout(
      () =>
        setSelectedId(
          (current: ConversationId | null) => current ?? initialConversationId,
        ),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [conversations, selectedId]);

  useEffect(() => {
    activeConversationId.current = selectedId;
  }, [selectedId]);

  const selectedFromList = conversations.find(
    (conversation) => conversation._id === selectedId,
  );
  const selectedFromQuery = useQuery(
    api.inbox.getConversation,
    selectedId ? { conversationId: selectedId } : "skip",
  );
  const selected = selectedFromQuery ?? selectedFromList;
  const selectedUnreadCount = selected?.unreadCount ?? 0;

  useEffect(() => {
    if (!selectedId || selectedUnreadCount <= 0) return;
    void markRead({ conversationId: selectedId }).catch(() => {
      // Read state is helpful but should never block opening the conversation.
    });
  }, [markRead, selectedId, selectedUnreadCount]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return conversations;

    return conversations.filter((conversation) => {
      const preview = conversation.lastMessage?.body ?? "";
      return `${conversationLabel(conversation)} ${preview}`
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [conversations, query]);

  const totalUnreadCount = conversations.reduce(
    (total, conversation) => total + conversation.unreadCount,
    0,
  );

  function selectConversation(id: ConversationId) {
    activeConversationId.current = id;
    setSelectedId(id);
    setDraft("");
    setMobileThreadOpen(true);
    replyAttempt.current = null;
    setReplyState({ conversationId: id, pending: false, error: null });
    setResolveState((current) =>
      current.conversationId === id
        ? current
        : { conversationId: id, pending: false, error: null },
    );
  }

  function changeDraft(value: string) {
    setDraft(value);
    const attempt = replyAttempt.current;
    if (attempt && attempt.body !== value.trim()) {
      replyAttempt.current = null;
    }
    if (selectedId) {
      setReplyState({ conversationId: selectedId, pending: false, error: null });
    }
  }

  async function submitDraft() {
    const body = draft.trim();
    if (!body || !selected || selected.status !== "open") return;
    if (
      replyState.pending &&
      replyState.conversationId === selected._id
    ) {
      return;
    }

    const existingAttempt = replyAttempt.current;
    const attempt =
      existingAttempt &&
      existingAttempt.conversationId === selected._id &&
      existingAttempt.body === body
        ? existingAttempt
        : {
            conversationId: selected._id,
            body,
            clientMessageId: createClientMessageId(),
          };
    replyAttempt.current = attempt;
    setReplyState({ conversationId: selected._id, pending: true, error: null });

    try {
      await sendReply({
        conversationId: attempt.conversationId,
        clientMessageId: attempt.clientMessageId,
        body: attempt.body,
      });
      replyAttempt.current = null;
      if (activeConversationId.current === attempt.conversationId) {
        setDraft("");
      }
      setReplyState({
        conversationId: attempt.conversationId,
        pending: false,
        error: null,
      });
    } catch {
      setReplyState({
        conversationId: attempt.conversationId,
        pending: false,
        error: "Your reply wasn’t sent. Check your connection and try again.",
      });
    }
  }

  async function resolveSelectedConversation() {
    if (!selected || selected.status !== "open") return;
    if (
      resolveState.pending &&
      resolveState.conversationId === selected._id
    ) {
      return;
    }

    const existingAttempt = resolveAttempt.current;
    const attempt: {
      conversationId: ConversationId;
      clientMessageId: string;
    } =
      existingAttempt && existingAttempt.conversationId === selected._id
        ? existingAttempt
        : {
            conversationId: selected._id,
            clientMessageId: createClientMessageId(),
          };
    resolveAttempt.current = attempt;
    setResolveState({ conversationId: selected._id, pending: true, error: null });

    try {
      await resolveConversation(attempt);
      resolveAttempt.current = null;
      setResolveState({
        conversationId: attempt.conversationId,
        pending: false,
        error: null,
      });
      if (activeConversationId.current === attempt.conversationId) {
        setDraft("");
      }
    } catch {
      setResolveState({
        conversationId: attempt.conversationId,
        pending: false,
        error: "Couldn’t resolve this conversation. Try again.",
      });
    }
  }

  const listPane = (
    <ConversationListPane
      conversations={filtered}
      hasAnyConversations={conversations.length > 0}
      totalConversationCount={conversations.length}
      totalUnreadCount={totalUnreadCount}
      selectedId={selectedId}
      query={query}
      now={now}
      paginationStatus={conversationStatus}
      onQueryChange={setQuery}
      onSelect={selectConversation}
      onLoadMore={() => loadMoreConversations(50)}
    />
  );

  const renderDisplay = (presenceEnabled: boolean) =>
    selected ? (
      <ConversationDisplay
        key={selected._id}
        conversation={selected}
        draft={draft}
        presenceEnabled={presenceEnabled}
        replyPending={
          replyState.conversationId === selected._id && replyState.pending
        }
        replyError={
          replyState.conversationId === selected._id ? replyState.error : null
        }
        resolvePending={
          resolveState.conversationId === selected._id && resolveState.pending
        }
        resolveError={
          resolveState.conversationId === selected._id ? resolveState.error : null
        }
        onDraftChange={changeDraft}
        onSubmit={() => void submitDraft()}
        onResolve={() => void resolveSelectedConversation()}
        onBack={() => setMobileThreadOpen(false)}
      />
    ) : conversationStatus === "LoadingFirstPage" ? (
      <ConversationLoadingSkeleton />
    ) : (
      <EmptyInbox />
    );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card/80 shadow-2xl shadow-black/20">
      <div className="hidden h-full min-h-0 md:block">
        <ResizablePanelGroup id="inbox" orientation="horizontal" className="h-full min-h-0">
          <ResizablePanel
            id="list"
            defaultSize="34%"
            minSize="24%"
            maxSize="44%"
            className="h-full min-h-0"
          >
            {listPane}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            id="thread"
            defaultSize="66%"
            minSize="42%"
            className="h-full min-h-0"
          >
            {renderDisplay(viewport === "desktop")}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <div className="h-full min-h-0 md:hidden">
        {mobileThreadOpen && selected
          ? renderDisplay(viewport === "mobile")
          : listPane}
      </div>
    </div>
  );
}
