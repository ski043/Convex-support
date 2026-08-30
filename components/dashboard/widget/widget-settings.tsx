"use client";

import { usePreloadedAuthQuery } from "@convex-dev/better-auth/nextjs/client";
import { useMutation, useQuery, type Preloaded } from "convex/react";
import {
  AlertTriangleIcon,
  CheckIcon,
  Code2Icon,
  CopyIcon,
  Globe2Icon,
  MessageCircleIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FormEvent,
} from "react";
import { LogoMark } from "@/components/logo";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  widgetInstallSnippet,
  widgetInstallSnippetParts,
} from "@/lib/widget-snippet";
import { cn } from "@/lib/utils";

type WidgetTheme = "blue" | "green" | "red" | "amber" | "zinc";
type WidgetPosition = "bottomLeft" | "bottomRight";
type WidgetSettingsDraft = {
  displayName: string;
  greeting: string;
  theme: WidgetTheme;
  position: WidgetPosition;
};
type SaveStatus = "idle" | "saving" | "saved" | "error";
type OriginPolicy = "legacy_limited" | "enforced";
type OriginDraft = { id: string; value: string };

const defaultWidgetSettings: WidgetSettingsDraft = {
  displayName: "MarshalDesk support",
  greeting: "Hi there! How can we help today?",
  theme: "blue",
  position: "bottomRight",
};

const themeOptions = [
  { value: "blue", label: "Ocean blue", color: "bg-[#1d4f9a]" },
  { value: "green", label: "Evergreen", color: "bg-[#0d5c45]" },
  { value: "red", label: "Signal red", color: "bg-[#8f2929]" },
  { value: "amber", label: "Warm amber", color: "bg-[#70400c]" },
  { value: "zinc", label: "Graphite", color: "bg-[#3f3f46]" },
] as const;

const panelColors: Record<WidgetTheme, string> = {
  blue: "bg-[#1d4f9a]",
  green: "bg-[#0d5c45]",
  red: "bg-[#8f2929]",
  amber: "bg-[#70400c]",
  zinc: "bg-[#3f3f46]",
};

const panelColorValues: Record<WidgetTheme, string> = {
  blue: "#1d4f9a",
  green: "#0d5c45",
  red: "#8f2929",
  amber: "#70400c",
  zinc: "#3f3f46",
};

function highlightSnippetPart(part: string, index: number) {
  if (part === "<" || part === ">" || part === "</") {
    return (
      <span key={index} className="text-zinc-500">
        {part}
      </span>
    );
  }

  if (part === "script") {
    return (
      <span key={index} className="text-violet-300">
        {part}
      </span>
    );
  }

  if (part.startsWith('"') && part.endsWith('"')) {
    return (
      <span key={index} className="text-sky-300">
        {part}
      </span>
    );
  }

  return <span key={index}>{part}</span>;
}

function settingsAreEqual(a: WidgetSettingsDraft, b: WidgetSettingsDraft) {
  return (
    a.displayName === b.displayName &&
    a.greeting === b.greeting &&
    a.theme === b.theme &&
    a.position === b.position
  );
}

function subscribeToDashboardOrigin() {
  return () => {};
}

function ownerSafeError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;

  const data = (error as Error & { data?: unknown }).data;
  if (typeof data === "string" && data.trim()) return data.trim();

  const message = /ConvexError:\s*([^\n]+)/i.exec(error.message)?.[1]?.trim();

  return message || fallback;
}

function OriginSecuritySettings({
  initialOrigins,
  initialPolicy,
}: {
  initialOrigins: string[];
  initialPolicy: OriginPolicy;
}) {
  const saveSecurity = useMutation(api.widgetSettings.saveSecurity);
  const recentOriginState = useQuery(api.widgetSettings.getRecentOrigins);
  const recentOrigins = recentOriginState?.origins ?? [];
  const [origins, setOrigins] = useState<OriginDraft[]>(() =>
    (initialOrigins.length > 0 ? initialOrigins : [""]).map((value, index) => ({
      id: `origin-${index}`,
      value,
    })),
  );
  const [policy, setPolicy] = useState<OriginPolicy>(initialPolicy);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const nextOriginId = useRef(origins.length);

  function updateOrigin(id: string, value: string) {
    setOrigins((current) =>
      current.map((origin) =>
        origin.id === id ? { ...origin, value } : origin,
      ),
    );
    setSaveStatus("idle");
    setSaveError(null);
  }

  function addOrigin() {
    const id = `origin-${nextOriginId.current}`;
    nextOriginId.current += 1;
    setOrigins((current) =>
      current.length >= 20
        ? current
        : [...current, { id, value: "" }],
    );
    setSaveStatus("idle");
    setSaveError(null);
  }

  function removeOrigin(id: string) {
    setOrigins((current) => {
      if (current.length === 1) return [{ ...current[0], value: "" }];
      return current.filter((origin) => origin.id !== id);
    });
    setSaveStatus("idle");
    setSaveError(null);
  }

  function addRecentOrigin(value: string) {
    const id = `origin-${nextOriginId.current}`;
    nextOriginId.current += 1;
    setOrigins((current) => {
      if (current.some((origin) => origin.value.trim() === value)) return current;
      const emptyIndex = current.findIndex((origin) => !origin.value.trim());
      if (emptyIndex >= 0) {
        return current.map((origin, index) =>
          index === emptyIndex ? { ...origin, value } : origin,
        );
      }
      if (current.length >= 20) return current;
      return [...current, { id, value }];
    });
    setSaveStatus("idle");
    setSaveError(null);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveStatus === "saving") return;

    setSaveStatus("saving");
    setSaveError(null);

    try {
      await saveSecurity({ allowedOrigins: origins.map((origin) => origin.value) });
      setPolicy("enforced");
      setSaveStatus("saved");
    } catch (error) {
      setSaveStatus("error");
      setSaveError(
        ownerSafeError(
          error,
          "We couldn’t save these origins. Check each exact origin and try again.",
        ),
      );
    }
  }

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b py-(--card-spacing)">
        <CardTitle>Allowed website origins</CardTitle>
        <CardDescription>
          Decide exactly which websites can start new support sessions.
        </CardDescription>
        <CardAction>
          <Badge variant={policy === "enforced" ? "secondary" : "destructive"}>
            {policy === "enforced" ? "Enforced" : "Action needed"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="py-(--card-spacing)">
        <form className="flex flex-col gap-5" onSubmit={(event) => void handleSave(event)}>
          <FieldGroup>
            {origins.map((origin, index) => {
              const inputId = `widget-${origin.id}`;

              return (
                <Field key={origin.id} data-invalid={saveStatus === "error"}>
                  <FieldLabel htmlFor={inputId}>
                    {index === 0 ? "Website origin" : `Website origin ${index + 1}`}
                  </FieldLabel>
                  <div className="flex items-center gap-2">
                    <Input
                      id={inputId}
                      name={`widget-origin-${index}`}
                      className="h-10 font-mono text-sm sm:h-8"
                      value={origin.value}
                      aria-invalid={saveStatus === "error"}
                      autoCapitalize="none"
                      autoComplete="url"
                      inputMode="url"
                      placeholder="https://support.example.com"
                      spellCheck={false}
                      onChange={(event) => updateOrigin(origin.id, event.target.value)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-lg"
                      className="size-10 sm:size-8"
                      aria-label={`Remove ${origin.value || `website origin ${index + 1}`}`}
                      onClick={() => removeOrigin(origin.id)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                  {index === origins.length - 1 ? (
                    <FieldDescription>
                      Use the exact <code className="font-mono">http://</code> or{" "}
                      <code className="font-mono">https://</code> origin only—no paths,
                      query strings, or wildcards. Up to 20 origins.
                    </FieldDescription>
                  ) : null}
                </Field>
              );
            })}

            {recentOrigins.length > 0 ? (
              <FieldSet>
                <FieldLegend variant="label">
                  Unverified browser-reported origins
                </FieldLegend>
                <div className="flex flex-col gap-2">
                  {recentOrigins.map((observation) => (
                    <Button
                      key={observation.origin}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-auto max-w-full justify-start py-2 text-left"
                      disabled={origins.some(
                        (candidate) =>
                          candidate.value.trim() === observation.origin,
                      )}
                      aria-label={`Add unverified origin ${observation.origin}`}
                      onClick={() => addRecentOrigin(observation.origin)}
                    >
                      <PlusIcon aria-hidden />
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-xs">
                          {observation.origin}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {observation.sessionCount} session bootstrap
                          {observation.sessionCount === 1 ? "" : "s"} · first{" "}
                          {new Date(observation.firstSeenAt).toISOString()} · last{" "}
                          {new Date(observation.lastSeenAt).toISOString()}
                        </span>
                      </span>
                    </Button>
                  ))}
                </div>
                <FieldDescription>
                  These values are self-reported by browsers and are not verified
                  installs. In legacy mode, a probe can add a value here. Compare the
                  origin and activity with your actual site configuration before adding
                  it.
                </FieldDescription>
                {recentOriginState?.isTruncated ? (
                  <FieldDescription className="text-destructive">
                    More than 20 origins have reported activity. This list shows only
                    the 20 most recent and is incomplete.
                  </FieldDescription>
                ) : null}
              </FieldSet>
            ) : policy === "legacy_limited" ? (
              <FieldDescription>
                No browser-reported origins have been recorded yet. Open the widget
                once on each installed customer site; new observations appear here
                automatically. You can also enter and verify each origin manually.
              </FieldDescription>
            ) : null}
          </FieldGroup>

          {saveError ? <FieldError>{saveError}</FieldError> : null}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="outline"
              className="h-10 sm:h-8"
              disabled={origins.length >= 20 || saveStatus === "saving"}
              onClick={addOrigin}
            >
              <PlusIcon data-icon="inline-start" />
              Add origin
            </Button>
            <div className="flex items-center justify-end gap-3">
              <p
                className={cn(
                  "text-xs text-muted-foreground",
                  saveStatus === "saved" && "text-[var(--status-open)]",
                  saveStatus === "error" && "text-destructive",
                )}
                aria-live="polite"
                aria-atomic="true"
              >
                {saveStatus === "saving"
                  ? "Validating and saving…"
                  : saveStatus === "saved"
                    ? "Origins saved and enforced."
                    : saveStatus === "error"
                      ? "Origins were not saved."
                      : policy === "legacy_limited"
                        ? "Saving immediately enables enforcement for this exact list."
                        : "Changes apply after you save; you can correct and resave the list at any time."}
              </p>
              <Button
                type="submit"
                className="h-10 sm:h-8"
                disabled={saveStatus === "saving"}
              >
                {saveStatus === "saving" ? (
                  <Spinner data-icon="inline-start" />
                ) : saveStatus === "saved" ? (
                  <CheckIcon data-icon="inline-start" />
                ) : (
                  <Globe2Icon data-icon="inline-start" />
                )}
                {saveStatus === "saving"
                  ? "Saving"
                  : policy === "legacy_limited"
                    ? "Save and enforce"
                    : "Save origins"}
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function WidgetPreview({
  displayName,
  greeting,
  theme,
  position,
}: {
  displayName: string;
  greeting: string;
  theme: WidgetTheme;
  position: WidgetPosition;
}) {
  return (
    <section aria-labelledby="widget-preview-title" className="w-full xl:sticky xl:top-6 xl:max-w-[412px]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 id="widget-preview-title" className="text-sm font-medium">
            Live preview
          </h2>
          <p className="text-xs text-muted-foreground">Updates as you customize</p>
        </div>
        <Badge variant="outline">Desktop</Badge>
      </div>

      <div className="relative h-[620px] overflow-hidden rounded-2xl border border-border bg-[#e9e7de] text-[#171717] shadow-2xl shadow-black/30 sm:h-[660px]">
        <div className="flex h-11 items-center gap-2 border-b border-black/10 bg-[#f5f3ec] px-4">
          <span className="size-2.5 rounded-full bg-black/15" />
          <span className="size-2.5 rounded-full bg-black/10" />
          <span className="size-2.5 rounded-full bg-black/10" />
          <div className="mx-auto mr-8 h-5 w-40 rounded-md bg-black/[0.06]" />
        </div>

        <div className="absolute inset-x-7 top-20 flex flex-col gap-3">
          <div className="h-4 w-32 rounded-full bg-black/[0.08]" />
          <div className="h-7 w-4/5 rounded-md bg-black/[0.1]" />
          <div className="h-3 w-full rounded-full bg-black/[0.06]" />
          <div className="h-3 w-2/3 rounded-full bg-black/[0.06]" />
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="h-24 rounded-xl border border-black/10 bg-white/45" />
            <div className="h-24 rounded-xl border border-black/10 bg-white/45" />
          </div>
        </div>

        <div
          className={cn(
            "absolute bottom-20 w-[calc(100%-32px)] max-w-[380px] overflow-hidden rounded-2xl border border-black/10 bg-[#fbfaf6] shadow-2xl shadow-black/20",
            position === "bottomLeft" ? "left-4" : "right-4",
          )}
          style={
            {
              "--muted": "#eeece5",
              "--foreground": "#282828",
              "--primary": panelColorValues[theme],
              "--primary-foreground": "#ffffff",
            } as CSSProperties
          }
        >
          <div className={cn("flex items-center gap-3 px-4 py-3.5 text-white", panelColors[theme])}>
            <span className="flex size-9 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25">
              <LogoMark className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{displayName || "MarshalDesk"}</p>
              <p className="text-xs text-white/80">A support agent will reply</p>
            </div>
            <span className="ml-auto size-2 rounded-full bg-white" aria-label="Online" />
          </div>

          <div className="flex h-[360px] flex-col bg-[#fbfaf6] p-4">
            <div className="flex flex-1 flex-col gap-3">
              <p className="max-w-[85%] text-sm font-medium leading-relaxed text-[#252525]">
                {greeting || "Hi! How can we help?"}
              </p>
              <Bubble variant="muted" className="max-w-[88%]">
                <BubbleContent>
                  Send us a message and our team will get back to you.
                </BubbleContent>
              </Bubble>
              <Bubble align="end" className="max-w-[80%] self-end">
                <BubbleContent>
                  How long does shipping take?
                </BubbleContent>
              </Bubble>
              <Bubble variant="muted" className="max-w-[90%]">
                <BubbleContent>
                  Hi! Standard shipping usually arrives in 3–5 business days.
                </BubbleContent>
              </Bubble>
            </div>
            <div className="flex h-11 items-center rounded-xl border border-black/10 bg-white px-3 text-xs text-black/60 shadow-sm">
              Type your message…
              <span className={cn("ml-auto flex size-7 items-center justify-center rounded-lg text-white", panelColors[theme])}>
                <MessageCircleIcon className="size-3.5" />
              </span>
            </div>
          </div>
        </div>

        <span
          className={cn(
            "absolute bottom-4 flex size-12 items-center justify-center rounded-full text-white shadow-xl",
            position === "bottomLeft" ? "left-4" : "right-4",
            panelColors[theme],
          )}
          aria-hidden
        >
          <MessageCircleIcon className="size-5" />
        </span>
      </div>
    </section>
  );
}

export function WidgetSettings({
  preloadedSettings,
  preloadedSecurity,
  preloadedWorkspace,
}: {
  preloadedSettings: Preloaded<typeof api.widgetSettings.get>;
  preloadedSecurity: Preloaded<typeof api.widgetSettings.getSecurity>;
  preloadedWorkspace: Preloaded<typeof api.workspaces.getCurrent>;
}) {
  const initialSettings =
    usePreloadedAuthQuery(preloadedSettings) ?? defaultWidgetSettings;
  const workspace = usePreloadedAuthQuery(preloadedWorkspace);
  const security = usePreloadedAuthQuery(preloadedSecurity) ?? {
    allowedOrigins: [],
    originPolicy: "legacy_limited" as const,
  };
  const saveSettings = useMutation(api.widgetSettings.save);
  const ensureWorkspace = useMutation(api.workspaces.ensureCurrent);
  const [settings, setSettings] = useState<WidgetSettingsDraft>(() => initialSettings);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [ensuredWorkspaceId, setEnsuredWorkspaceId] = useState<Id<"workspaces"> | null>(
    null,
  );
  const [workspaceError, setWorkspaceError] = useState(false);
  const dashboardOrigin = useSyncExternalStore(
    subscribeToDashboardOrigin,
    () => window.location.origin,
    () => null,
  );
  const saveTimer = useRef<number | undefined>(undefined);
  const idleTimer = useRef<number | undefined>(undefined);
  const copyTimer = useRef<number | undefined>(undefined);
  const lastObservedSettings = useRef<WidgetSettingsDraft>(initialSettings);
  const saveRevision = useRef(0);
  const isMounted = useRef(true);
  const workspaceId = workspace?._id ?? ensuredWorkspaceId;
  const installSnippet =
    dashboardOrigin && workspaceId
      ? widgetInstallSnippet(workspaceId, dashboardOrigin)
      : null;
  const installSnippetLines =
    dashboardOrigin && workspaceId
      ? widgetInstallSnippetParts(workspaceId, dashboardOrigin)
      : [["Preparing your install snippet…"]];

  useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, []);

  useEffect(() => {
    if (workspace) {
      return;
    }

    let cancelled = false;

    void ensureWorkspace({})
      .then((workspaceId) => {
        if (cancelled) return;
        setEnsuredWorkspaceId(workspaceId);
        setWorkspaceError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setWorkspaceError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [ensureWorkspace, workspace]);

  useEffect(() => {
    if (settingsAreEqual(settings, lastObservedSettings.current)) {
      return;
    }

    lastObservedSettings.current = settings;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (idleTimer.current) window.clearTimeout(idleTimer.current);

    const revision = ++saveRevision.current;
    const settingsToSave = settings;
    setSaveStatus("saving");

    saveTimer.current = window.setTimeout(() => {
      void saveSettings(settingsToSave)
        .then(() => {
          if (!isMounted.current || revision !== saveRevision.current) return;

          setSaveStatus("saved");
          idleTimer.current = window.setTimeout(() => setSaveStatus("idle"), 1800);
        })
        .catch(() => {
          if (!isMounted.current || revision !== saveRevision.current) return;
          setSaveStatus("error");
        });
    }, 500);

    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [saveSettings, settings]);

  function updateSetting<Key extends keyof WidgetSettingsDraft>(
    key: Key,
    value: WidgetSettingsDraft[Key],
  ) {
    setSettings((current) =>
      current[key] === value ? current : { ...current, [key]: value },
    );
  }

  async function copySnippet() {
    if (!installSnippet) return;
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    try {
      await navigator.clipboard.writeText(installSnippet);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
    copyTimer.current = window.setTimeout(() => setCopyStatus("idle"), 1800);
  }

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-8 pb-10">
      <header className="max-w-2xl">
        <h1 className="font-heading text-3xl font-medium tracking-tight sm:text-4xl">Widget</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Make the support experience feel like a natural part of your site, then publish it with one snippet.
        </p>
      </header>

      {security.originPolicy === "legacy_limited" ? (
        <Alert className="border-destructive/35 bg-destructive/10 py-3">
          <AlertTriangleIcon aria-hidden />
          <AlertTitle>New-session protection is still in legacy-limited mode</AlertTitle>
          <AlertDescription>
            Your current widget keeps working, but new sessions are not restricted to
            your websites yet. Verify the browser-reported activity below against your
            actual installations, add every customer-facing site, and save only when
            the exact list is complete.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-1 flex-col gap-8 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-(--card-spacing)">
              <CardTitle>Appearance</CardTitle>
              <CardDescription>Brand the welcome, color, and placement.</CardDescription>
              <CardAction>
                <p
                  aria-live="polite"
                  aria-atomic="true"
                  className={cn(
                    "flex min-w-16 items-center justify-end gap-1 text-xs text-muted-foreground transition-[opacity,color] duration-160 ease-[var(--ease-out)]",
                    saveStatus === "idle" && "opacity-0",
                    saveStatus === "saved" && "text-[var(--status-open)]",
                    saveStatus === "error" && "text-destructive",
                  )}
                >
                  {saveStatus === "saving" ? (
                    "Saving…"
                  ) : saveStatus === "error" ? (
                    "Couldn’t save"
                  ) : (
                    <>
                      <CheckIcon aria-hidden className="size-3.5" />
                      Saved
                    </>
                  )}
                </p>
              </CardAction>
            </CardHeader>
            <CardContent className="py-(--card-spacing)">
              <form onSubmit={(event) => event.preventDefault()}>
                <FieldGroup>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="widget-display-name">Display name</FieldLabel>
                      <Input
                        id="widget-display-name"
                        name="widget-display-name"
                        className="h-10 sm:h-8"
                        value={settings.displayName}
                        maxLength={40}
                        autoComplete="off"
                        onChange={(event) => {
                          updateSetting("displayName", event.target.value);
                        }}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="widget-greeting">Greeting</FieldLabel>
                      <Input
                        id="widget-greeting"
                        name="widget-greeting"
                        className="h-10 sm:h-8"
                        value={settings.greeting}
                        maxLength={120}
                        autoComplete="off"
                        onChange={(event) => {
                          updateSetting("greeting", event.target.value);
                        }}
                      />
                    </Field>
                  </div>

                  <FieldSet>
                    <FieldLegend variant="label">Theme</FieldLegend>
                    <div className="flex flex-wrap items-center gap-3">
                      <ToggleGroup
                        value={[settings.theme]}
                        onValueChange={(values) => {
                          const next = values[0] as WidgetTheme | undefined;
                          if (!next) return;
                          updateSetting("theme", next);
                        }}
                        spacing={2}
                        aria-label="Widget theme"
                      >
                        {themeOptions.map((option) => (
                          <ToggleGroupItem
                            key={option.value}
                            value={option.value}
                            aria-label={option.label}
                            title={option.label}
                            className="size-10 rounded-full p-0 ring-offset-2 ring-offset-card hover:bg-transparent hover:ring-2 hover:ring-foreground/30 aria-pressed:bg-transparent aria-pressed:ring-2 aria-pressed:ring-primary sm:size-8"
                          >
                            <span
                              aria-hidden
                              className={cn(
                                "size-full rounded-full border border-white/15 shadow-sm",
                                option.color,
                              )}
                            />
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                      <p className="text-sm text-muted-foreground">
                        {themeOptions.find((option) => option.value === settings.theme)?.label}
                      </p>
                    </div>
                  </FieldSet>

                  <FieldSet>
                    <FieldLegend variant="label">Position</FieldLegend>
                    <ToggleGroup
                      value={[settings.position]}
                      onValueChange={(values) => {
                        const next = values[0] as WidgetPosition | undefined;
                        if (!next) return;
                        updateSetting("position", next);
                      }}
                      className="grid w-full grid-cols-2 gap-3"
                      aria-label="Widget position"
                    >
                      {(["bottomLeft", "bottomRight"] as const).map((value) => {
                        const left = value === "bottomLeft";
                        return (
                          <ToggleGroupItem
                            key={value}
                            value={value}
                            variant="outline"
                            className="h-auto w-full flex-col items-stretch gap-2.5 p-2.5 text-left"
                          >
                            {/* Black rather than a muted surface: the card behind it
                                shifts on hover and when pressed, and the mock page
                                has to stay readable against all three. */}
                            <span className="relative block h-24 w-full overflow-hidden rounded-lg border border-border bg-background">
                              <span className="absolute inset-x-3 top-3 h-2 rounded-full bg-foreground/12" />
                              <span className="absolute left-3 top-7 h-1.5 w-1/2 rounded-full bg-foreground/8" />
                              <span
                                className={cn(
                                  "absolute bottom-2.5 flex size-9 items-center justify-center rounded-full text-white shadow-sm",
                                  left ? "left-2.5" : "right-2.5",
                                  panelColors[settings.theme],
                                )}
                              >
                                <MessageCircleIcon className="size-4" />
                              </span>
                            </span>
                            <span className="text-sm font-medium">
                              {left ? "Bottom left" : "Bottom right"}
                            </span>
                          </ToggleGroupItem>
                        );
                      })}
                    </ToggleGroup>
                  </FieldSet>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>

          <OriginSecuritySettings
            key={`${security.originPolicy}:${security.allowedOrigins.join("|")}`}
            initialOrigins={security.allowedOrigins}
            initialPolicy={security.originPolicy}
          />

          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-(--card-spacing)">
              <CardTitle>Install snippet</CardTitle>
              <CardDescription>
                Paste this before <code className="font-mono">&lt;/body&gt;</code> on your site.
              </CardDescription>
              <CardAction>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-10 sm:h-7"
                  disabled={!installSnippet}
                  onClick={() => void copySnippet()}
                >
                  {!installSnippet ? (
                    <Spinner data-icon="inline-start" />
                  ) : copyStatus === "copied" ? (
                    <CheckIcon data-icon="inline-start" />
                  ) : (
                    <CopyIcon data-icon="inline-start" />
                  )}
                  {!installSnippet
                    ? "Preparing"
                    : copyStatus === "copied"
                      ? "Copied"
                      : copyStatus === "error"
                        ? "Retry"
                        : "Copy"}
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="py-(--card-spacing)">
              <div className="overflow-hidden rounded-lg bg-zinc-950 ring-1 ring-white/10">
                <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-xs text-zinc-500">
                  <Code2Icon className="size-3.5" aria-hidden />
                  HTML
                </div>
                <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-6 text-zinc-200">
                  <code className="block min-w-max">
                    {installSnippetLines.map((parts, lineIndex) => (
                      <span key={lineIndex} className="flex gap-4">
                        <span
                          aria-hidden
                          className="w-4 shrink-0 select-none text-right text-zinc-600"
                        >
                          {lineIndex + 1}
                        </span>
                        <span className="min-w-0 whitespace-pre">
                          {parts.map((part, partIndex) =>
                            highlightSnippetPart(part, partIndex),
                          )}
                        </span>
                        {lineIndex < installSnippetLines.length - 1 ? "\n" : null}
                      </span>
                    ))}
                  </code>
                </pre>
              </div>
              <p
                className={cn(
                  "mt-3 text-xs text-muted-foreground",
                  copyStatus === "error" && "text-destructive",
                )}
                aria-live="polite"
              >
                {copyStatus === "copied"
                  ? "Snippet copied to your clipboard."
                  : copyStatus === "error"
                    ? "Clipboard access was blocked. Select and copy the snippet manually."
                    : installSnippet
                      ? `Workspace ${workspaceId} is ready to embed.`
                      : workspaceError
                        ? "We could not prepare your workspace. Refresh the page to try again."
                        : "Creating your workspace and preparing the install snippet."}
              </p>
            </CardContent>
          </Card>
        </div>

        <WidgetPreview
          displayName={settings.displayName}
          greeting={settings.greeting}
          theme={settings.theme}
          position={settings.position}
        />
      </div>
    </div>
  );
}
