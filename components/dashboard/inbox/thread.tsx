"use client";

import type { PaginationStatus } from "convex/react";
import { MessageSquareTextIcon } from "lucide-react";
import { Fragment } from "react";
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
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(date);
}

function messageTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
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

              const fromOwner = message.author === "owner";
              const align = fromOwner ? "end" : "start";

              return (
                <Fragment key={message._id}>
                  {dateMarker}
                  <MessageScrollerItem
                    messageId={message._id}
                    scrollAnchor={fromOwner}
                  >
                    <Message align={align}>
                      <MessageContent>
                        <MessageHeader>{fromOwner ? "You" : "Visitor"}</MessageHeader>
                        <Bubble
                          variant={fromOwner ? "default" : "muted"}
                          align={align}
                        >
                          <BubbleContent>{message.body}</BubbleContent>
                        </Bubble>
                        <MessageFooter>{messageTime(message.createdAt)}</MessageFooter>
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
