"use client";

import {
  Clock3Icon,
  ExternalLinkIcon,
  Globe2Icon,
  InfoIcon,
  LanguagesIcon,
  MapPinIcon,
  MonitorIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  conversationLabel,
  type InboxConversation,
  visitorInitials,
} from "@/components/dashboard/inbox/types";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type InboxVisitor = InboxConversation["visitor"];

function SnapshotRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof MapPinIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="mt-0.5 break-words text-sm text-foreground">{children}</div>
      </div>
    </div>
  );
}

function formatLocation(visitor: InboxVisitor) {
  const city = visitor.city?.trim();
  const countryCode = visitor.country?.trim();
  let country = countryCode;

  if (countryCode && /^[A-Za-z]{2}$/.test(countryCode)) {
    try {
      country = new Intl.DisplayNames(undefined, { type: "region" }).of(
        countryCode.toUpperCase(),
      );
    } catch {
      country = countryCode.toUpperCase();
    }
  }

  const parts = [city, country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "Location unavailable";
}

function parseDevice(device: string | null) {
  const value = device?.trim();
  if (!value) return "Device unavailable";

  const looksLikeUserAgent =
    /Mozilla\/|AppleWebKit\/|Chrome\/|CriOS\/|Safari\/|Firefox\/|FxiOS\/|Edg\//i.test(
      value,
    );
  if (!looksLikeUserAgent) return value;

  const browser = /Edg\//.test(value)
    ? "Edge"
    : /FxiOS|Firefox\//.test(value)
      ? "Firefox"
      : /CriOS|Chrome\//.test(value)
        ? "Chrome"
        : /Safari\//.test(value)
          ? "Safari"
          : null;
  const platform = /Android/.test(value)
    ? "Android"
    : /iPhone|iPad|iPod/.test(value)
      ? "iOS"
      : /Windows/.test(value)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(value)
          ? "macOS"
          : /Linux/.test(value)
            ? "Linux"
            : null;

  if (browser && platform) return `${browser} on ${platform}`;
  return browser ?? platform ?? "Device unavailable";
}

function sanitizedPage(pageUrl: string | null) {
  if (!pageUrl) return null;

  try {
    const url = new URL(pageUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const href = `${url.origin}${url.pathname}`;
    return { href, label: href };
  } catch {
    return null;
  }
}

function useVisitorLocalTime(timezone: string | null) {
  const [clock, setClock] = useState<{
    timezone: string;
    value: string | null;
  } | null>(null);

  useEffect(() => {
    if (!timezone) {
      return;
    }

    let validTimezone = true;
    const update = () => {
      try {
        setClock({
          timezone,
          value: new Intl.DateTimeFormat(undefined, {
            timeZone: timezone,
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
          }).format(Date.now()),
        });
      } catch {
        validTimezone = false;
        setClock({ timezone, value: null });
      }
    };

    update();
    if (!validTimezone) return;
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, [timezone]);

  return clock?.timezone === timezone ? clock.value : null;
}

function VisitorSnapshot({ conversation }: { conversation: InboxConversation }) {
  const { visitor } = conversation;
  const label = conversationLabel(conversation);
  const localTime = useVisitorLocalTime(visitor.timezone);
  const currentPage = useMemo(() => sanitizedPage(visitor.pageUrl), [visitor.pageUrl]);
  const pageTitle = visitor.pageTitle?.trim();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <Avatar size="lg">
          <AvatarFallback>{visitorInitials(label)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 pt-0.5">
          <p className="truncate text-sm font-medium">{label}</p>
          <p className="truncate text-sm text-muted-foreground">
            Last seen {new Intl.DateTimeFormat(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(visitor.lastSeenAt)}
          </p>
        </div>
      </div>
      <Separator />
      <div className="flex flex-col gap-5">
        <SnapshotRow icon={MapPinIcon} label="Location">
          {formatLocation(visitor)}
        </SnapshotRow>
        <SnapshotRow icon={Clock3Icon} label="Local time">
          {visitor.timezone && localTime
            ? `${localTime} (${visitor.timezone})`
            : "Time unavailable"}
        </SnapshotRow>
        {visitor.locale ? (
          <SnapshotRow icon={LanguagesIcon} label="Locale">
            {visitor.locale}
          </SnapshotRow>
        ) : null}
        <SnapshotRow icon={MonitorIcon} label="Device">
          {parseDevice(visitor.device)}
        </SnapshotRow>
        <SnapshotRow icon={Globe2Icon} label="Current page">
          {currentPage ? (
            <div className="flex min-w-0 flex-col gap-1">
              {pageTitle ? <span>{pageTitle}</span> : null}
              <a
                className="inline-flex min-w-0 items-center gap-1 text-muted-foreground underline underline-offset-4 hover:text-foreground"
                href={currentPage.href}
                target="_blank"
                rel="noreferrer"
              >
                <span className="truncate">{currentPage.label}</span>
                <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
              </a>
            </div>
          ) : (
            "Page unavailable"
          )}
        </SnapshotRow>
      </div>
    </div>
  );
}

export function VisitorPane({ conversation }: { conversation: InboxConversation }) {
  return (
    <aside
      className="hidden h-full min-h-0 w-72 shrink-0 overflow-y-auto border-l border-border p-4 xl:block"
      aria-label="Visitor details"
    >
      <VisitorSnapshot conversation={conversation} />
    </aside>
  );
}

export function VisitorDetailsSheet({
  conversation,
}: {
  conversation: InboxConversation;
}) {
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="View visitor details"
            className="size-10 xl:hidden"
          />
        }
      >
        <InfoIcon />
      </SheetTrigger>
      <SheetContent side="right" className="w-[min(90vw,360px)]">
        <SheetHeader>
          <SheetTitle>Visitor details</SheetTitle>
          <SheetDescription>
            Context last observed on the visitor&apos;s site.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          <VisitorSnapshot conversation={conversation} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
