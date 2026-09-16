"use client";

import { useQuery, type PaginationStatus } from "convex/react";
import { BookOpenIcon, ChevronDownIcon, MessageSquareTextIcon } from "lucide-react";
import { Fragment, useState } from "react";
import type { InboxMessage } from "@/components/dashboard/inbox/types";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Marker, MarkerContent } from "@/components/ui/marker";
import {
  Message,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { TypingIndicator } from "@/components/ui/typing-indicator";
import { api } from "@/convex/_generated/api";

const messageTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const messageDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "long",
  day: "numeric",
});
const messageDateWithYearFormatter = new Intl.DateTimeFormat(undefined, {
  month: "long",
  day: "numeric",
  year: "numeric",
});

function EvidenceDisclosure({ messageId }: { messageId: InboxMessage["_id"] }) {
  const [open, setOpen] = useState(false);
  const citations = useQuery(
    api.inbox.listCitations,
    open ? { messageId } : "skip",
  );
  const regionId = `evidence-${messageId}`;

  return (
    <div className="mt-1 max-w-xl">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((value) => !value)}
      >
        <BookOpenIcon data-icon="inline-start" />
        Evidence for this AI reply
        <ChevronDownIcon
          data-icon="inline-end"
          className={
            open
              ? "rotate-180 transition-transform motion-reduce:transition-none"
              : "transition-transform motion-reduce:transition-none"
          }
        />
      </Button>
      {open ? (
        <div
          id={regionId}
          className="mt-2 space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-xs"
          aria-live="polite"
        >
          {citations === undefined ? (
            <p className="text-muted-foreground">Loading evidence…</p>
          ) : citations.length === 0 ? (
            <p className="text-muted-foreground">
              This message is a handoff acknowledgement and has no cited source.
            </p>
          ) : (
            citations.map((citation) => (
              <article
                key={`${citation.segmentIndex ?? "legacy"}:${citation.documentTitle}:${citation.pageNumber ?? ""}:${citation.heading ?? ""}:${citation.excerpt}`}
                className="space-y-2"
              >
                <p className="font-medium text-foreground">
                  {citation.segmentIndex === undefined
                    ? "Source"
                    : `Answer segment ${citation.segmentIndex + 1}`}
                  {" · "}
                  {citation.documentTitle}
                  {citation.pageNumber ? ` · page ${citation.pageNumber}` : ""}
                  {citation.heading ? ` · ${citation.heading}` : ""}
                </p>
                {citation.segmentText ? (
                  <p className="leading-relaxed text-foreground">
                    {citation.segmentText}
                  </p>
                ) : null}
                {citation.supportingQuote ? (
                  <blockquote className="border-l-2 border-primary/40 pl-2 leading-relaxed text-muted-foreground">
                    Exact source match: “{citation.supportingQuote}”
                  </blockquote>
                ) : (
                  <p className="leading-relaxed text-muted-foreground">
                    {citation.excerpt}
                  </p>
                )}
                {citation.supportingQuote &&
                citation.excerpt !== citation.supportingQuote ? (
                  <details className="text-muted-foreground">
                    <summary className="cursor-pointer">Source context</summary>
                    <p className="mt-1 leading-relaxed">{citation.excerpt}</p>
                  </details>
                ) : null}
              </article>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function dateKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dateLabel(timestamp: number) {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return (date.getFullYear() === today.getFullYear()
    ? messageDateFormatter
    : messageDateWithYearFormatter
  ).format(date);
}

function messageTime(timestamp: number) {
  return messageTimeFormatter.format(timestamp);
}

function messagePresentation(
  author: Exclude<InboxMessage["author"], "system">,
) {
  switch (author) {
    case "visitor":
      return {
        align: "start" as const,
        header: "Visitor",
        scrollAnchor: false,
        variant: "muted" as const,
      };
    case "owner":
      return {
        align: "end" as const,
        header: "You",
        scrollAnchor: true,
        variant: "default" as const,
      };
    case "assistant":
      return {
        align: "start" as const,
        header: "AI assistant",
        scrollAnchor: false,
        variant: "muted" as const,
      };
  }
}

function ThreadLoading() {
  return (
    <>
      <MessageScrollerItem messageId="loading-visitor">
        <Message align="start">
          <MessageContent>
            <MessageHeader>Visitor</MessageHeader>
            <Bubble variant="muted">
              <BubbleContent className="flex w-56 flex-col gap-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      </MessageScrollerItem>
      <MessageScrollerItem messageId="loading-owner">
        <Message align="end">
          <MessageContent>
            <MessageHeader>You</MessageHeader>
            <Bubble align="end">
              <BubbleContent className="flex w-44 flex-col gap-2">
                <Skeleton className="h-3 w-full bg-primary-foreground/30" />
                <Skeleton className="h-3 w-2/3 bg-primary-foreground/30" />
              </BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    </>
  );
}

export function Thread({
  messages,
  paginationStatus,
  visitorTyping,
  onLoadMore,
}: {
  messages: InboxMessage[];
  paginationStatus: PaginationStatus;
  visitorTyping: boolean;
  onLoadMore: () => void;
}) {
  const loadingFirstPage = paginationStatus === "LoadingFirstPage";
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="h-full">
        <MessageScrollerViewport>
          <MessageScrollerContent className="gap-5 px-4 py-5 sm:px-6">
            {paginationStatus === "CanLoadMore" || paginationStatus === "LoadingMore" ? (
              <MessageScrollerItem messageId="load-older-messages">
                <div className="flex justify-center">
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
                    {paginationStatus === "LoadingMore"
                      ? "Loading earlier messages…"
                      : "Load earlier messages"}
                  </Button>
                </div>
              </MessageScrollerItem>
            ) : null}
            {loadingFirstPage ? <ThreadLoading /> : null}
            {!loadingFirstPage && messages.length === 0 ? (
              <MessageScrollerItem messageId="empty-thread">
                <Empty className="min-h-64">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <MessageSquareTextIcon />
                    </EmptyMedia>
                    <EmptyTitle>No messages yet</EmptyTitle>
                    <EmptyDescription>
                      The visitor&apos;s messages will appear here in real time.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </MessageScrollerItem>
            ) : null}
            {messages.map((message, index) => {
              const currentDate = dateKey(message.createdAt);
              const showDate =
                index === 0 || dateKey(messages[index - 1].createdAt) !== currentDate;

              const dateMarker = showDate ? (
                <MessageScrollerItem
                  key={`date-${currentDate}`}
                  messageId={`date-${currentDate}`}
                >
                  <Marker variant="separator">
                    <MarkerContent>{dateLabel(message.createdAt)}</MarkerContent>
                  </Marker>
                </MessageScrollerItem>
              ) : null;

              if (message.author === "system") {
                return (
                  <Fragment key={message._id}>
                    {dateMarker}
                    <MessageScrollerItem messageId={message._id}>
                      <Marker variant="separator">
                        <MarkerContent>{message.body}</MarkerContent>
                      </Marker>
                    </MessageScrollerItem>
                  </Fragment>
                );
              }

              const presentation = messagePresentation(message.author);

              return (
                <Fragment key={message._id}>
                  {dateMarker}
                  <MessageScrollerItem
                    messageId={message._id}
                    scrollAnchor={presentation.scrollAnchor}
                  >
                    <Message align={presentation.align}>
                      <MessageContent>
                        <MessageHeader>{presentation.header}</MessageHeader>
                        <Bubble
                          variant={presentation.variant}
                          align={presentation.align}
                        >
                          <BubbleContent>{message.body}</BubbleContent>
                        </Bubble>
                        <MessageFooter>{messageTime(message.createdAt)}</MessageFooter>
                        {message.author === "assistant" ? (
                          <EvidenceDisclosure messageId={message._id} />
                        ) : null}
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                </Fragment>
              );
            })}
            {visitorTyping ? (
              <TypingIndicator
                messageId="inbox-visitor-typing"
                label="Visitor is typing…"
              />
            ) : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
