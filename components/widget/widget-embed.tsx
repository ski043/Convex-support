"use client";

import {
  useMutation,
  usePaginatedQuery_experimental,
  useQuery_experimental,
} from "convex/react";
import type {
  FunctionReference,
  PaginationOptions,
  PaginationResult,
} from "convex/server";
import {
  AlertCircleIcon,
  ChevronDownIcon,
  MessageCircleIcon,
  SendIcon,
  UserRoundIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
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
import type { Id } from "@/convex/_generated/dataModel";
import { useTypingPresence } from "@/hooks/use-typing-presence";
import {
  WIDGET_BOOTSTRAP_MESSAGE_TYPE,
  WIDGET_CLOSED_FRAME_SIZE,
  WIDGET_CONTEXT_MESSAGE_TYPE,
  WIDGET_FRAME_MESSAGE_TYPE,
  WIDGET_HUMAN_REQUEST_MESSAGE,
  WIDGET_LAUNCHER_SIZE,
  WIDGET_MESSAGE_MARKER,
  WIDGET_OPEN_FRAME_HEIGHT,
  WIDGET_OPEN_FRAME_WIDTH,
  WIDGET_READY_MESSAGE_TYPE,
  WIDGET_TOKEN_MESSAGE_TYPE,
  type WidgetPageContext,
  type WidgetPosition,
  type WidgetTheme,
  type WidgetVisitorContext,
} from "@/lib/widget-embed-contract";
import { cn } from "@/lib/utils";

type WidgetConfig = {
  displayName: string;
  greeting: string;
  theme: WidgetTheme;
  position: WidgetPosition;
};

type WidgetMessage = {
  _id: string;
  sequence: number;
  author: "visitor" | "owner" | "assistant" | "system";
  body: string;
  createdAt: number;
};

type WidgetContextInput = {
  city?: string | null;
  country?: string | null;
  timezone?: string | null;
  locale?: string | null;
  device?: string | null;
  pageUrl?: string | null;
  pageTitle?: string | null;
};

type WidgetChatApi = {
  widgetChat: {
    getConfig: FunctionReference<
      "query",
      "public",
      { workspaceId: string },
      WidgetConfig | null
    >;
    ensureSession: FunctionReference<
      "mutation",
      "public",
      {
        workspaceId: string;
        bootstrapToken: string;
        token?: string;
        context: WidgetContextInput;
      },
      { token: string }
    >;
    updateContext: FunctionReference<
      "mutation",
      "public",
      {
        workspaceId: string;
        token: string;
        context: WidgetContextInput;
      },
      null
    >;
    getAutomationState: FunctionReference<
      "query",
      "public",
      { workspaceId: string; token: string },
      { isAiTyping: boolean; handling: "ai" | "human"; needsHuman: boolean }
    >;
    listMessages: FunctionReference<
      "query",
      "public",
      {
        workspaceId: string;
        token: string;
        paginationOpts: PaginationOptions;
      },
      PaginationResult<WidgetMessage>
    >;
    sendMessage: FunctionReference<
      "mutation",
      "public",
      {
        workspaceId: string;
        token: string;
        clientMessageId: string;
        body: string;
        context: WidgetContextInput;
      },
      WidgetMessage
    >;
  };
};

type ClientMetadata = {
  timezone: string | null;
  locale: string | null;
  device: string | null;
};

type PlatformContext = {
  city: string | null;
  country: string | null;
  timezone: string | null;
};

type SessionStatus = "waiting" | "ready" | "error";

const widgetChatApi = (api as unknown as WidgetChatApi).widgetChat;

const themeColors: Record<WidgetTheme, string> = {
  blue: "#1d4f9a",
  green: "#0d5c45",
  red: "#8f2929",
  amber: "#70400c",
  zinc: "#3f3f46",
};
const widgetTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const emptyPageContext: WidgetPageContext = {
  pageUrl: null,
  pageTitle: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cleanPageContext(
  value: unknown,
  parentOrigin: string,
): WidgetPageContext | null {
  if (!isRecord(value)) return null;

  const pageUrl = value.pageUrl;
  const pageTitle = value.pageTitle;
  if (
    (pageUrl !== null && typeof pageUrl !== "string") ||
    (pageTitle !== null && typeof pageTitle !== "string") ||
    (typeof pageTitle === "string" && pageTitle.length > 160)
  ) {
    return null;
  }

  if (typeof pageUrl === "string") {
    if (pageUrl.length > 2048) return null;
    try {
      const parsed = new URL(pageUrl);
      if (
        parsed.origin !== parentOrigin ||
        `${parsed.origin}${parsed.pathname}` !== pageUrl
      ) {
        return null;
      }
    } catch {
      return null;
    }
  }

  return { pageUrl, pageTitle };
}

function validTimezone(value: string | null | undefined) {
  const timezone = value?.trim();
  if (!timezone || timezone.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    return timezone;
  } catch {
    return null;
  }
}

function validLocale(value: string | null | undefined) {
  const locale = value?.trim();
  if (!locale || locale.length > 40) return null;
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? null;
  } catch {
    return null;
  }
}

function browserName(userAgent: string) {
  if (/Edg\//.test(userAgent)) return "Edge";
  if (/OPR\/|Opera\//.test(userAgent)) return "Opera";
  if (/Firefox\//.test(userAgent)) return "Firefox";
  if (/Chrome\//.test(userAgent) && !/Chromium\//.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent) && /Version\//.test(userAgent)) return "Safari";
  return null;
}

function operatingSystem(userAgent: string) {
  if (/iPhone|iPad|iPod/.test(userAgent)) return "iOS";
  if (/Android/.test(userAgent)) return "Android";
  if (/Mac OS X/.test(userAgent)) return "macOS";
  if (/Windows NT/.test(userAgent)) return "Windows";
  if (/Linux/.test(userAgent)) return "Linux";
  return null;
}

function deviceLabel(userAgent: string) {
  const category = /iPad|Tablet/.test(userAgent)
    ? "Tablet"
    : /Mobi|Android|iPhone|iPod/.test(userAgent)
      ? "Mobile"
      : "Desktop";
  return [category, browserName(userAgent), operatingSystem(userAgent)]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 80);
}

function readClientMetadata(): ClientMetadata {
  return {
    timezone: validTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone),
    locale: validLocale(navigator.language),
    device: deviceLabel(navigator.userAgent) || null,
  };
}

function cleanPlatformContext(value: unknown): PlatformContext | null {
  if (!isRecord(value)) return null;
  const city = typeof value.city === "string" ? value.city.slice(0, 100) : null;
  const country =
    typeof value.country === "string" && /^[A-Z]{2}$/.test(value.country)
      ? value.country
      : null;
  return {
    city,
    country,
    timezone: validTimezone(
      typeof value.timezone === "string" ? value.timezone : null,
    ),
  };
}

function newClientMessageId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-");
}

function formatTime(timestamp: number) {
  try {
    return widgetTimeFormatter.format(new Date(timestamp));
  } catch {
    return "";
  }
}

function safeDisplayName(value: string | null) {
  const name = value?.trim();
  return name && name.length <= 80 ? name : null;
}

function WidgetLoading() {
  return (
    <div className="flex flex-col gap-5 p-4" aria-label="Loading conversation">
      <div className="flex items-end gap-2">
        <Skeleton className="size-7 rounded-full" />
        <Skeleton className="h-16 w-56 rounded-xl" />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-12 w-44 rounded-xl" />
      </div>
      <div className="flex items-end gap-2">
        <Skeleton className="size-7 rounded-full" />
        <Skeleton className="h-14 w-48 rounded-xl" />
      </div>
    </div>
  );
}

function WidgetFailure({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <AlertCircleIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {onRetry ? (
        <EmptyContent>
          <Button type="button" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

export function WidgetEmbed({
  workspaceId,
  parentOrigin,
  defaultOpen = false,
}: {
  workspaceId: Id<"workspaces">;
  parentOrigin: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [hostToken, setHostToken] = useState<string | null | undefined>();
  const [hostBootstrapToken, setHostBootstrapToken] = useState<string>();
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("waiting");
  const [pageContext, setPageContext] =
    useState<WidgetPageContext>(emptyPageContext);
  const [clientMetadata] = useState<ClientMetadata | undefined>(() =>
    typeof navigator === "undefined" ? undefined : readClientMetadata(),
  );
  const [platformContext, setPlatformContext] =
    useState<PlatformContext | null | undefined>();
  const sessionInFlight = useRef(false);
  const mounted = useRef(true);
  const lastSentContext = useRef("");
  const retryMessage = useRef<{ body: string; clientMessageId: string } | null>(
    null,
  );

  const configState = useQuery_experimental({
    query: widgetChatApi.getConfig,
    args: { workspaceId },
  });
  const ensureSession = useMutation(widgetChatApi.ensureSession);
  const updateContext = useMutation(widgetChatApi.updateContext);
  const sendMessage = useMutation(widgetChatApi.sendMessage);
  const automationState = useQuery_experimental({
    query: widgetChatApi.getAutomationState,
    args: sessionToken ? { workspaceId, token: sessionToken } : "skip",
  });
  const messagesState = usePaginatedQuery_experimental({
    query: widgetChatApi.listMessages,
    args: sessionToken ? { workspaceId, token: sessionToken } : "skip",
    initialNumItems: 50,
  });

  const config = configState.status === "success" ? configState.data : null;
  const position = config?.position ?? "bottomRight";
  const theme = config?.theme ?? "blue";
  const displayName = config?.displayName.trim() || "Support";
  const greeting = config?.greeting.trim() || "Hi! How can we help?";
  const configUnavailable =
    configState.status === "error" ||
    (configState.status === "success" && configState.data === null);

  const visitorContext = useMemo<WidgetVisitorContext | null>(() => {
    if (!clientMetadata || platformContext === undefined) return null;
    return {
      city: platformContext?.city ?? null,
      country: platformContext?.country ?? null,
      timezone: clientMetadata.timezone ?? platformContext?.timezone ?? null,
      locale: clientMetadata.locale,
      device: clientMetadata.device,
      pageUrl: pageContext.pageUrl,
      pageTitle: pageContext.pageTitle,
    };
  }, [clientMetadata, pageContext, platformContext]);

  const postToParent = useCallback((message: Record<string, unknown>) => {
    window.parent.postMessage(message, parentOrigin);
  }, [parentOrigin]);

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/widget-context", {
      cache: "no-store",
      credentials: "omit",
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return cleanPlatformContext(await response.json());
      })
      .then((context) => {
        if (!cancelled) setPlatformContext(context);
      })
      .catch(() => {
        if (!cancelled) setPlatformContext(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== parentOrigin || event.source !== window.parent) return;
      const data = event.data;
      if (
        !isRecord(data) ||
        data.marker !== WIDGET_MESSAGE_MARKER ||
        typeof data.type !== "string"
      ) {
        return;
      }

      if (data.type === WIDGET_BOOTSTRAP_MESSAGE_TYPE) {
        if (
          data.token !== null &&
          (typeof data.token !== "string" || !data.token || data.token.length > 4096)
        ) {
          return;
        }
        if (
          typeof data.bootstrapToken !== "string" ||
          !data.bootstrapToken ||
          data.bootstrapToken.length > 4_096
        ) {
          return;
        }
        const context = cleanPageContext(data.context, parentOrigin);
        if (!context) return;
        setHostToken(data.token);
        setHostBootstrapToken(data.bootstrapToken);
        setPageContext(context);
        return;
      }

      if (data.type === WIDGET_CONTEXT_MESSAGE_TYPE) {
        const context = cleanPageContext(data.context, parentOrigin);
        if (context) setPageContext(context);
      }
    }

    window.addEventListener("message", onMessage);
    postToParent({
      marker: WIDGET_MESSAGE_MARKER,
      type: WIDGET_READY_MESSAGE_TYPE,
    });
    return () => window.removeEventListener("message", onMessage);
  }, [parentOrigin, postToParent]);

  useEffect(() => {
    postToParent({
      marker: WIDGET_MESSAGE_MARKER,
      type: WIDGET_FRAME_MESSAGE_TYPE,
      position,
      width: open ? WIDGET_OPEN_FRAME_WIDTH : WIDGET_CLOSED_FRAME_SIZE,
      height: open ? WIDGET_OPEN_FRAME_HEIGHT : WIDGET_CLOSED_FRAME_SIZE,
    });
  }, [open, position, postToParent]);

  useEffect(() => {
    if (
      !config ||
      hostToken === undefined ||
      !hostBootstrapToken ||
      !visitorContext ||
      sessionStatus !== "waiting" ||
      sessionInFlight.current
    ) {
      return;
    }

    sessionInFlight.current = true;

    void (async () => {
      try {
        let result: { token: string };
        try {
          result = await ensureSession({
            workspaceId,
            bootstrapToken: hostBootstrapToken,
            ...(hostToken ? { token: hostToken } : {}),
            context: visitorContext,
          });
        } catch (error) {
          if (!hostToken) throw error;
          result = await ensureSession({
            workspaceId,
            bootstrapToken: hostBootstrapToken,
            context: visitorContext,
          });
        }

        if (!mounted.current) return;
        setSessionToken(result.token);
        setSessionStatus("ready");
        lastSentContext.current = JSON.stringify(visitorContext);
        postToParent({
          marker: WIDGET_MESSAGE_MARKER,
          type: WIDGET_TOKEN_MESSAGE_TYPE,
          token: result.token,
        });
      } catch {
        if (!mounted.current) return;
        setSessionStatus("error");
      } finally {
        sessionInFlight.current = false;
      }
    })();
  }, [
    ensureSession,
    config,
    hostToken,
    hostBootstrapToken,
    postToParent,
    sessionStatus,
    visitorContext,
    workspaceId,
  ]);

  useEffect(() => {
    if (!sessionToken || !visitorContext || sessionStatus !== "ready") return;
    const serialized = JSON.stringify(visitorContext);
    if (serialized === lastSentContext.current) return;
    lastSentContext.current = serialized;

    void updateContext({
      workspaceId,
      token: sessionToken,
      context: visitorContext,
    }).catch(() => {
      if (lastSentContext.current === serialized) lastSentContext.current = "";
    });
  }, [sessionStatus, sessionToken, updateContext, visitorContext, workspaceId]);

  useEffect(() => {
    if (!open || !sessionToken || !visitorContext || sessionStatus !== "ready") {
      return;
    }
    void updateContext({
      workspaceId,
      token: sessionToken,
      context: visitorContext,
    }).catch(() => undefined);
  }, [open, sessionStatus, sessionToken, updateContext, visitorContext, workspaceId]);

  async function sendCanonicalMessage(body: string, clearDraft: boolean) {
    typingPresence.clearTyping();
    if (!body || !sessionToken || sending) return;
    const clientMessageId =
      retryMessage.current?.body === body
        ? retryMessage.current.clientMessageId
        : newClientMessageId();
    retryMessage.current = { body, clientMessageId };

    setSending(true);
    setSendError(null);
    try {
      await sendMessage({
        workspaceId,
        token: sessionToken,
        clientMessageId,
        body,
        context: visitorContext ?? emptyPageContext,
      });
      retryMessage.current = null;
      if (clearDraft) setDraft("");
    } catch {
      setSendError("Your message wasn’t sent. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function submitMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendCanonicalMessage(draft.trim(), true);
  }

  const chronologicalMessages = useMemo(
    () =>
      messagesState.status === "success"
        ? [...messagesState.data].reverse()
        : [],
    [messagesState],
  );
  const typingPresence = useTypingPresence({
    enabled:
      open &&
      sessionStatus === "ready" &&
      Boolean(sessionToken) &&
      messagesState.status === "success" &&
      messagesState.data.length > 0,
    scope: sessionToken
      ? { kind: "visitor", workspaceId, token: sessionToken }
      : null,
  });
  const typingOwnerName =
    safeDisplayName(typingPresence.ownerDisplayName) ?? displayName;
  const canSend =
    Boolean(config) &&
    sessionStatus === "ready" &&
    messagesState.status === "success";
  const humanAlreadyRequested =
    automationState.status === "success" && automationState.data.needsHuman;
  const widgetStyle = {
    "--primary": themeColors[theme],
    "--ring": themeColors[theme],
  } as CSSProperties;

  let conversation: React.ReactNode;
  if (configState.status === "pending") {
    conversation = <WidgetLoading />;
  } else if (configUnavailable) {
    conversation = (
      <WidgetFailure
        title="Chat isn’t available"
        description="This support widget could not load its workspace configuration."
      />
    );
  } else if (sessionStatus === "waiting") {
    conversation = <WidgetLoading />;
  } else if (sessionStatus === "error") {
    conversation = (
      <WidgetFailure
        title="Couldn’t connect"
        description="Reload the page or try connecting again."
        onRetry={() => {
          setSessionStatus("waiting");
        }}
      />
    );
  } else if (messagesState.status === "pending") {
    conversation = <WidgetLoading />;
  } else if (messagesState.status === "error") {
    conversation = (
      <WidgetFailure
        title="Messages couldn’t load"
        description="Your conversation is still saved. Close the chat and try again."
      />
    );
  } else {
    conversation = (
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="h-full">
          <MessageScrollerViewport>
            <MessageScrollerContent className="gap-4 px-4 py-5">
              {messagesState.canLoadMore ? (
                <MessageScrollerItem messageId="load-earlier">
                  <div className="flex justify-center">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => messagesState.loadMore(50)}
                    >
                      Load earlier messages
                    </Button>
                  </div>
                </MessageScrollerItem>
              ) : null}

              <MessageScrollerItem messageId="widget-greeting">
                <Message align="start">
                  <MessageContent>
                    <MessageHeader>{displayName}</MessageHeader>
                    <Bubble variant="muted" align="start">
                      <BubbleContent>{greeting}</BubbleContent>
                    </Bubble>
                  </MessageContent>
                </Message>
              </MessageScrollerItem>

              {chronologicalMessages.length === 0 ? (
                <MessageScrollerItem messageId="empty-conversation">
                  <Empty className="min-h-36 p-3">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <MessageCircleIcon />
                      </EmptyMedia>
                      <EmptyTitle>Start a conversation</EmptyTitle>
                      <EmptyDescription>
                        Send a message and the support team can reply here.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </MessageScrollerItem>
              ) : null}

              {chronologicalMessages.map((message) => {
                if (message.author === "system") {
                  return (
                    <MessageScrollerItem
                      key={message._id}
                      messageId={message._id}
                    >
                      <Marker variant="separator">
                        <MarkerContent>{message.body}</MarkerContent>
                      </Marker>
                    </MessageScrollerItem>
                  );
                }

                const fromVisitor = message.author === "visitor";
                const align = fromVisitor ? "end" : "start";
                const senderLabel = fromVisitor
                  ? "You"
                  : message.author === "assistant"
                    ? `${displayName} · AI`
                    : displayName;
                return (
                  <MessageScrollerItem
                    key={message._id}
                    messageId={message._id}
                    scrollAnchor={fromVisitor}
                  >
                    <Message align={align}>
                      <MessageContent>
                        <MessageHeader>
                          {senderLabel}
                        </MessageHeader>
                        <Bubble
                          variant={fromVisitor ? "default" : "muted"}
                          align={align}
                        >
                          <BubbleContent>{message.body}</BubbleContent>
                        </Bubble>
                        <MessageFooter>{formatTime(message.createdAt)}</MessageFooter>
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                );
              })}

              {typingPresence.ownerTyping ? (
                <TypingIndicator
                  messageId="widget-owner-typing"
                  label={`${typingOwnerName} is typing…`}
                />
              ) : null}
              {!typingPresence.ownerTyping &&
              automationState.status === "success" &&
              automationState.data.isAiTyping ? (
                <TypingIndicator
                  messageId="widget-ai-typing"
                  label={`${displayName} AI is preparing a reply…`}
                />
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
    );
  }

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-0 flex flex-col justify-end p-4",
        position === "bottomLeft" ? "items-start" : "items-end",
      )}
      style={widgetStyle}
    >
      {open ? (
        <section
          id="marshaldesk-chat-panel"
          aria-label={`Chat with ${displayName}`}
          className="pointer-events-auto mb-3 flex h-[min(560px,calc(100dvh-100px))] w-[min(380px,calc(100vw-32px))] min-h-0 flex-col overflow-hidden overscroll-contain rounded-2xl border bg-background text-foreground"
        >
          <header className="flex min-h-16 items-center gap-3 bg-primary px-4 py-3 text-primary-foreground">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15">
              <MessageCircleIcon aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{displayName}</p>
              <p className="text-xs">Support conversation</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              aria-label="Close chat"
              onClick={() => {
                typingPresence.clearTyping();
                setOpen(false);
              }}
            >
              <ChevronDownIcon />
            </Button>
          </header>

          <div className="min-h-0 flex-1">{conversation}</div>

          <form
            className="border-t bg-background p-3"
            onSubmit={submitMessage}
          >
            <FieldGroup>
              <Field data-invalid={Boolean(sendError)}>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!canSend || sending || humanAlreadyRequested}
                    onClick={() => {
                      void sendCanonicalMessage(
                        WIDGET_HUMAN_REQUEST_MESSAGE,
                        false,
                      );
                    }}
                  >
                    <UserRoundIcon data-icon="inline-start" />
                    {humanAlreadyRequested
                      ? "Human requested"
                      : "Talk to a human"}
                  </Button>
                </div>
                <FieldLabel htmlFor="marshaldesk-message" className="sr-only">
                  Message
                </FieldLabel>
                <InputGroup className="h-11 has-disabled:opacity-100">
                  <InputGroupInput
                    id="marshaldesk-message"
                    name="marshaldesk-message"
                    value={draft}
                    maxLength={4000}
                    placeholder={canSend ? "Type your message…" : "Connecting…"}
                    autoComplete="off"
                    disabled={!canSend || sending}
                    aria-invalid={Boolean(sendError)}
                    onChange={(event) => {
                      if (
                        retryMessage.current &&
                        retryMessage.current.body !== event.target.value.trim()
                      ) {
                        retryMessage.current = null;
                      }
                      typingPresence.updateTyping(event.target.value);
                      setDraft(event.target.value);
                      if (sendError) setSendError(null);
                    }}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      type="submit"
                      size="icon-sm"
                      variant="default"
                      aria-label={sending ? "Sending message" : "Send message"}
                      disabled={!canSend || !draft.trim() || sending}
                    >
                      {sending ? (
                        <Spinner />
                      ) : (
                        <SendIcon />
                      )}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                {sendError ? (
                  <FieldDescription role="alert">{sendError}</FieldDescription>
                ) : null}
              </Field>
            </FieldGroup>
          </form>
        </section>
      ) : null}

      <Button
        type="button"
        size="icon-lg"
        aria-controls="marshaldesk-chat-panel"
        aria-expanded={open}
        aria-label={open ? "Close support chat" : "Open support chat"}
        className="pointer-events-auto size-14 rounded-full shadow-xl"
        style={{ width: WIDGET_LAUNCHER_SIZE, height: WIDGET_LAUNCHER_SIZE }}
        onClick={() => {
          if (open) typingPresence.clearTyping();
          setOpen((current) => !current);
        }}
      >
        {open ? <ChevronDownIcon /> : <MessageCircleIcon />}
      </Button>
    </div>
  );
}
