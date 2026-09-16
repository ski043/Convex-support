"use client";

import { useMutation, usePaginatedQuery } from "convex/react";
import { ArrowLeftIcon, BotIcon, CheckIcon, HandIcon, SendIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import {
  conversationLabel,
  type InboxConversation,
  visitorInitials,
} from "@/components/dashboard/inbox/types";
import { Thread } from "@/components/dashboard/inbox/thread";
import {
  VisitorDetailsSheet,
  VisitorPane,
} from "@/components/dashboard/inbox/visitor-pane";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import { useTypingPresence } from "@/hooks/use-typing-presence";

function automationErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const data = (error as Error & { data?: unknown }).data;
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  if (typeof data === "string" && data.trim()) return data.trim();
  return fallback;
}

function Composer({
  draft,
  visitorLabel,
  resolved,
  pending,
  error,
  onDraftChange,
  onSubmit,
}: {
  draft: string;
  visitorLabel: string;
  resolved: boolean;
  pending: boolean;
  error: string | null;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const replyId = useId();
  const disabled = resolved || pending;

  return (
    <form
      className="shrink-0 p-3 sm:p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <FieldGroup>
        <Field data-disabled={disabled || undefined} data-invalid={!!error || undefined}>
          <FieldLabel htmlFor={replyId} className="sr-only">
            Reply to {visitorLabel}
          </FieldLabel>
          <InputGroup className="h-auto">
            <InputGroupTextarea
              id={replyId}
              name="owner-reply"
              value={draft}
              rows={3}
              placeholder={
                resolved
                  ? "This conversation is resolved"
                  : `Reply to ${visitorLabel}…`
              }
              disabled={disabled}
              aria-invalid={!!error || undefined}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  onSubmit();
                }
              }}
            />
            <InputGroupAddon align="block-end" className="justify-between border-t border-border">
              <InputGroupText>⌘/Ctrl Enter</InputGroupText>
              <Button
                type="submit"
                size="sm"
                className="h-10 sm:h-7"
                disabled={disabled || !draft.trim()}
              >
                {pending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <SendIcon data-icon="inline-start" />
                )}
                {pending ? "Sending…" : "Send"}
              </Button>
            </InputGroupAddon>
          </InputGroup>
          <FieldError>{error}</FieldError>
        </Field>
      </FieldGroup>
    </form>
  );
}

export function ConversationDisplay({
  conversation,
  draft,
  presenceEnabled,
  replyPending,
  replyError,
  resolvePending,
  resolveError,
  onDraftChange,
  onSubmit,
  onResolve,
  onBack,
}: {
  conversation: InboxConversation;
  draft: string;
  presenceEnabled: boolean;
  replyPending: boolean;
  replyError: string | null;
  resolvePending: boolean;
  resolveError: string | null;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onResolve: () => void;
  onBack?: () => void;
}) {
  const takeOver = useMutation(api.aiAutomation.takeOver);
  const resumeAi = useMutation(api.aiAutomation.resumeAi);
  const [automationAction, setAutomationAction] = useState<
    "takeover" | "resume" | null
  >(null);
  const [automationError, setAutomationError] = useState<string | null>(null);
  const { results, status, loadMore } = usePaginatedQuery(
    api.inbox.listMessages,
    { conversationId: conversation._id },
    { initialNumItems: 50 },
  );
  const messages = useMemo(
    () => [...results].sort((a, b) => a.sequence - b.sequence),
    [results],
  );
  const open = conversation.status === "open";
  const typingPresence = useTypingPresence({
    enabled: presenceEnabled && open,
    scope: { kind: "owner", conversationId: conversation._id },
  });
  const label = conversationLabel(conversation);
  const location = [conversation.visitor.city, conversation.visitor.country]
    .filter(Boolean)
    .join(", ");

  async function updateAutomation(action: "takeover" | "resume") {
    if (automationAction) return;
    setAutomationAction(action);
    setAutomationError(null);
    try {
      if (action === "takeover") {
        await takeOver({ conversationId: conversation._id });
      } else {
        await resumeAi({ conversationId: conversation._id });
      }
    } catch (error) {
      setAutomationError(
        automationErrorMessage(
          error,
          action === "takeover"
            ? "AI could not be paused. Try again before replying."
            : "AI could not be resumed. Try again.",
        ),
      );
    } finally {
      setAutomationAction(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
      <section
        className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        aria-label={`Conversation with ${label}`}
      >
        <div className="flex min-h-16 shrink-0 items-center gap-3 px-3 sm:px-4">
          {onBack ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                typingPresence.clearTyping();
                onBack();
              }}
              aria-label="Back to conversations"
              className="size-10 md:hidden"
            >
              <ArrowLeftIcon />
            </Button>
          ) : null}
          <Avatar>
            <AvatarFallback>{visitorInitials(label)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-sm font-medium">{label}</h2>
              <Badge variant={open ? "secondary" : "outline"}>
                {open ? "Open" : "Resolved"}
              </Badge>
              <Badge
                variant={
                  conversation.handlingState === "needs_human"
                    ? "destructive"
                    : "outline"
                }
              >
                {conversation.handlingState === "ai_handling"
                  ? conversation.isAiTyping
                    ? "AI answering"
                    : "AI handling"
                  : conversation.handlingState === "needs_human"
                    ? "Needs human"
                    : conversation.handlingState === "human_handling"
                      ? "Human handling"
                      : "Resolved"}
              </Badge>
              {resolveError ? <Badge variant="destructive">Couldn&apos;t resolve</Badge> : null}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {automationError ?? (location || "Location unavailable")}
            </p>
          </div>
          {conversation.canTakeOver ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-10 sm:h-8"
              disabled={automationAction !== null}
              onClick={() => void updateAutomation("takeover")}
            >
              {automationAction === "takeover" ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <HandIcon data-icon="inline-start" />
              )}
              Take over
            </Button>
          ) : conversation.canResume ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-10 sm:h-8"
              disabled={automationAction !== null}
              onClick={() => void updateAutomation("resume")}
            >
              {automationAction === "resume" ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <BotIcon data-icon="inline-start" />
              )}
              Resume AI
            </Button>
          ) : null}
          <VisitorDetailsSheet conversation={conversation} />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={!open || resolvePending}
                  onClick={() => {
                    typingPresence.clearTyping();
                    onResolve();
                  }}
                  aria-label={open ? "Mark conversation resolved" : "Conversation resolved"}
                  className="size-10 sm:size-8"
                />
              }
            >
              {resolvePending ? <Spinner /> : <CheckIcon />}
            </TooltipTrigger>
            <TooltipContent>
              {resolvePending ? "Resolving…" : open ? "Mark resolved" : "Resolved"}
            </TooltipContent>
          </Tooltip>
        </div>
        <Separator />

        <div className="min-h-0 flex-1 overflow-hidden">
          <Thread
            messages={messages}
            paginationStatus={status}
            visitorTyping={typingPresence.visitorTyping}
            onLoadMore={() => loadMore(50)}
          />
        </div>

        <Separator />
        <Composer
          draft={draft}
          visitorLabel={label}
          resolved={!open}
          pending={replyPending}
          error={replyError}
          onDraftChange={(value) => {
            typingPresence.updateTyping(value);
            onDraftChange(value);
          }}
          onSubmit={() => {
            typingPresence.clearTyping();
            onSubmit();
          }}
        />
      </section>
      <VisitorPane conversation={conversation} />
    </div>
  );
}
