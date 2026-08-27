import type { ReactNode } from "react";
import {
  CheckIcon,
  ClockIcon,
  GlobeIcon,
  InboxIcon,
  MapPinIcon,
  MonitorIcon,
  SearchIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const conversations = [
  {
    label: "maya@atlas.supply",
    preview: "Can I get a refund on a gift card?",
    time: "2m",
    open: true,
  },
  {
    label: "Visitor",
    preview: "You: Ireland is £6.50 and arrives in three to five days.",
    time: "1h",
    open: true,
  },
  {
    label: "sam@northfield.co",
    preview: "Where do I send the shirt back?",
    time: "4h",
    open: false,
  },
  {
    label: "Visitor",
    preview: "How long does a refund take once you have the parcel?",
    time: "Mar 4",
    open: false,
  },
] as const;

const messages = [
  { author: "Visitor", body: "Can I get a refund on a gift card?" },
  {
    author: "Assistant",
    body: "Refunds run 30 days from purchase, but I don’t know about gift cards — the policy does not mention them.",
  },
  { author: "System", body: "Maya asked to talk to a person." },
  {
    author: "You",
    body: "It isn’t in the policy, but send me the order number and I’ll sort it out.",
  },
] as const;

export function InboxStage({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "relative flex h-[42rem] flex-col overflow-hidden bg-background p-4",
        className,
      )}
    >
      <div className="mb-4 hidden shrink-0 items-center justify-between px-2 lg:flex">
        <span className="flex items-center gap-2 text-sm">
          <InboxIcon className="size-3.5" />
          Inbox
        </span>
        <AvatarCircle>L</AvatarCircle>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border bg-card">
        <ConversationPane />
        <ThreadPane />
        <VisitorPane />
      </div>
    </div>
  );
}

function ConversationPane() {
  return (
    <aside className="hidden w-[32%] min-w-52 shrink-0 flex-col border-r lg:flex">
      <div className="flex h-12 items-center px-4">
        <p className="text-xl font-medium">Inbox</p>
      </div>
      <Rule />
      <div className="p-4">
        <div className="flex h-8 items-center rounded-lg border border-input px-2 text-muted-foreground">
          <SearchIcon className="size-4" />
          <span className="px-2.5 text-sm">Search</span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2">
        {conversations.map((conversation, index) => (
          <div
            key={conversation.preview}
            className={cn(
              "flex shrink-0 flex-col gap-1.5 rounded-lg px-3 py-2.5",
              index === 0 && "bg-muted",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                {conversation.open ? (
                  <span className="size-2 shrink-0 rounded-full bg-primary" />
                ) : null}
                <span className="truncate text-sm font-medium">
                  {conversation.label}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {conversation.time}
              </span>
            </div>
            <p className="line-clamp-2 text-sm leading-normal text-muted-foreground">
              {conversation.preview}
            </p>
            <span className="w-fit rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              {conversation.open ? "Open" : "Resolved"}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}

function ThreadPane() {
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-12 items-center justify-end px-4">
        <CheckIcon className="size-4" />
      </div>
      <Rule />
      <div className="flex items-start gap-4 p-4">
        <AvatarCircle>MA</AvatarCircle>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">maya@atlas.supply</p>
          <span className="text-xs text-muted-foreground">Open conversation</span>
        </div>
        <p className="shrink-0 text-xs text-muted-foreground">4:12 PM</p>
      </div>
      <Rule />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-4 py-5">
        {messages.map((message) =>
          message.author === "System" ? (
            <div
              key={message.body}
              className="flex items-center gap-2 text-center text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border"
            >
              <span>{message.body}</span>
            </div>
          ) : (
            <ThreadMessage key={message.body} author={message.author}>
              {message.body}
            </ThreadMessage>
          ),
        )}
      </div>
      <Rule />
      <div className="flex shrink-0 flex-col gap-3 p-4">
        <div className="min-h-16 rounded-lg border border-input px-3 py-2 text-sm text-muted-foreground">
          Reply maya@atlas.supply...
        </div>
        <span className="self-end rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground opacity-50">
          Send
        </span>
      </div>
    </div>
  );
}

function VisitorPane() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-5 border-l p-4 xl:flex">
      <div className="flex items-start gap-3">
        <AvatarCircle className="size-10">MA</AvatarCircle>
        <p className="pt-1 text-sm font-medium">maya@atlas.supply</p>
      </div>
      <Rule />
      <div className="flex flex-col gap-4">
        <Snapshot icon={<MapPinIcon />} label="Location">
          Dublin, Ireland
        </Snapshot>
        <Snapshot icon={<ClockIcon />} label="Local time">
          4:12 PM
        </Snapshot>
        <Snapshot icon={<MonitorIcon />} label="Device">
          Chrome on macOS
        </Snapshot>
        <Snapshot icon={<GlobeIcon />} label="Current page">
          atlas.supply/returns
        </Snapshot>
      </div>
    </aside>
  );
}

function ThreadMessage({
  author,
  children,
}: {
  author: "Visitor" | "Assistant" | "You";
  children: ReactNode;
}) {
  const fromOwner = author === "You";
  const tone =
    author === "You"
      ? "bg-primary text-primary-foreground"
      : author === "Assistant"
        ? "bg-primary/10 text-foreground"
        : "bg-muted text-foreground";

  return (
    <div
      className={cn(
        "flex flex-col gap-2 text-sm",
        fromOwner && "items-end",
      )}
    >
      <span className="px-3 text-xs font-medium text-muted-foreground">
        {author}
      </span>
      <span className={cn("max-w-[84%] rounded-xl px-3 py-2 leading-relaxed", tone)}>
        {children}
      </span>
    </div>
  );
}

function Snapshot({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-muted-foreground [&>svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="truncate text-sm">{children}</p>
      </div>
    </div>
  );
}

function AvatarCircle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full border bg-muted text-xs text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

function Rule() {
  return <div className="h-px shrink-0 bg-border" />;
}
