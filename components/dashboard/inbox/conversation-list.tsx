"use client";

import type { PaginationStatus } from "convex/react";
import { InboxIcon, SearchIcon, SearchXIcon } from "lucide-react";
import { useId } from "react";
import {
  conversationLabel,
  type ConversationId,
  type InboxConversation,
} from "@/components/dashboard/inbox/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const relativeDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const conversationSkeletonIds = ["first", "second", "third", "fourth", "fifth"];

function conversationPreview(conversation: InboxConversation) {
  if (!conversation.lastMessage) return "No messages yet";
  switch (conversation.lastMessage.author) {
    case "owner":
      return `You: ${conversation.lastMessage.body}`;
    case "assistant":
      return `AI: ${conversation.lastMessage.body}`;
    case "visitor":
    case "system":
      return conversation.lastMessage.body;
  }
}

function handlingLabel(conversation: InboxConversation) {
  switch (conversation.handlingState) {
    case "ai_handling":
      return "AI handling";
    case "needs_human":
      return "Needs human";
    case "human_handling":
      return "Human handling";
    case "resolved":
      return "Resolved";
  }
}

function relativeTime(timestamp: number, now: number) {
  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (elapsedSeconds < 60) return "now";
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return relativeDateFormatter.format(timestamp);
}

function ConversationListSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-2 pt-0" aria-label="Loading conversations">
      {conversationSkeletonIds.map((id) => (
        <div key={id} className="flex min-h-24 flex-col gap-3 rounded-lg px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-8" />
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function ConversationListPane({
  conversations,
  hasAnyConversations,
  totalConversationCount,
  totalUnreadCount,
  selectedId,
  query,
  now,
  paginationStatus,
  attentionFilter,
  onQueryChange,
  onSelect,
  onLoadMore,
  onAttentionFilterChange,
}: {
  conversations: InboxConversation[];
  hasAnyConversations: boolean;
  totalConversationCount: number;
  totalUnreadCount: number;
  selectedId: ConversationId | null;
  query: string;
  now: number;
  paginationStatus: PaginationStatus;
  attentionFilter: "all" | "needs_human";
  onQueryChange: (value: string) => void;
  onSelect: (id: ConversationId) => void;
  onLoadMore: () => void;
  onAttentionFilterChange: (value: "all" | "needs_human") => void;
}) {
  const searchId = useId();
  const loadingFirstPage = paginationStatus === "LoadingFirstPage";
  const hasMore =
    paginationStatus === "CanLoadMore" || paginationStatus === "LoadingMore";
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <div>
          <h1 className="font-heading text-xl font-medium tracking-tight">Inbox</h1>
          <p className="text-xs text-muted-foreground">
            {loadingFirstPage
              ? "Loading conversations"
              : `${totalConversationCount}${hasMore ? "+" : ""} conversation${totalConversationCount === 1 && !hasMore ? "" : "s"}`}
          </p>
        </div>
        <Badge variant="secondary">{totalUnreadCount} new</Badge>
      </div>
      <Separator />
      <div className="shrink-0 p-3">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={searchId} className="sr-only">
              Search conversations
            </FieldLabel>
            <InputGroup className="h-10 md:h-8">
              <InputGroupInput
                id={searchId}
                name="conversation-search"
                aria-label="Search conversations"
                className="h-full"
                placeholder="Search conversations"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
              />
              <InputGroupAddon align="inline-start">
                <SearchIcon />
              </InputGroupAddon>
            </InputGroup>
          </Field>
        </FieldGroup>
        <div className="mt-2 flex gap-2" aria-label="Conversation attention filter">
          <Button
            type="button"
            size="sm"
            variant={attentionFilter === "all" ? "secondary" : "ghost"}
            aria-pressed={attentionFilter === "all"}
            onClick={() => onAttentionFilterChange("all")}
          >
            All
          </Button>
          <Button
            type="button"
            size="sm"
            variant={attentionFilter === "needs_human" ? "secondary" : "ghost"}
            aria-pressed={attentionFilter === "needs_human"}
            onClick={() => onAttentionFilterChange("needs_human")}
          >
            Needs human
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {loadingFirstPage ? (
          <ConversationListSkeleton />
        ) : conversations.length === 0 ? (
          <Empty className="min-h-64 py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                {hasAnyConversations ? <SearchXIcon /> : <InboxIcon />}
              </EmptyMedia>
              <EmptyTitle>
                {hasAnyConversations ? "No matching conversations" : "No conversations yet"}
              </EmptyTitle>
              <EmptyDescription>
                {hasAnyConversations
                  ? "Try a visitor label or a phrase from the latest message."
                  : "New visitor messages will appear here in real time."}
              </EmptyDescription>
            </EmptyHeader>
            {hasAnyConversations &&
            (paginationStatus === "CanLoadMore" ||
              paginationStatus === "LoadingMore") ? (
              <EmptyContent>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={paginationStatus === "LoadingMore"}
                  onClick={onLoadMore}
                >
                  {paginationStatus === "LoadingMore" ? (
                    <Spinner data-icon="inline-start" />
                  ) : null}
                  {paginationStatus === "LoadingMore"
                    ? "Searching older conversations…"
                    : "Search older conversations"}
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        ) : (
          <>
            <ItemGroup className="gap-1 p-2 pt-0">
              {conversations.map((conversation) => {
                const selected = conversation._id === selectedId;
                const label = conversationLabel(conversation);

                return (
                  <Item
                    key={conversation._id}
                    size="sm"
                    variant={selected ? "muted" : "default"}
                    render={
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() => onSelect(conversation._id)}
                      />
                    }
                    className={cn(
                      "min-h-[104px] cursor-pointer items-start text-left hover:bg-muted/70",
                      selected && "bg-muted",
                    )}
                  >
                    <ItemContent>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          {conversation.unreadCount > 0 ? (
                            <>
                              <span
                                aria-hidden
                                className="size-2 shrink-0 rounded-full bg-[var(--status-unread)]"
                              />
                              <span className="sr-only">
                                {conversation.unreadCount} unread
                              </span>
                            </>
                          ) : null}
                          <ItemTitle>{label}</ItemTitle>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {relativeTime(conversation.lastMessageAt, now)}
                        </span>
                      </div>
                      <ItemDescription>{conversationPreview(conversation)}</ItemDescription>
                    </ItemContent>
                    <ItemFooter>
                      <Badge
                        variant={
                          conversation.handlingState === "needs_human"
                            ? "destructive"
                            : conversation.handlingState === "ai_handling"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {handlingLabel(conversation)}
                      </Badge>
                    </ItemFooter>
                  </Item>
                );
              })}
            </ItemGroup>
            {paginationStatus === "CanLoadMore" || paginationStatus === "LoadingMore" ? (
              <div className="flex justify-center px-3 pb-4 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={paginationStatus === "LoadingMore"}
                  onClick={onLoadMore}
                >
                  {paginationStatus === "LoadingMore" ? (
                    <Spinner data-icon="inline-start" />
                  ) : null}
                  {paginationStatus === "LoadingMore" ? "Loading…" : "Load older"}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </ScrollArea>
    </div>
  );
}
