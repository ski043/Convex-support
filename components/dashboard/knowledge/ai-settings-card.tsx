"use client";

import { usePreloadedAuthQuery } from "@convex-dev/better-auth/nextjs/client";
import { useMutation, type Preloaded } from "convex/react";
import {
  AlertTriangleIcon,
  BotIcon,
  CheckIcon,
  PauseCircleIcon,
  PlayCircleIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/convex/_generated/api";
import {
  saveAwareServerBaseline,
  syncUntouchedValue,
} from "@/lib/settings-form-model";
import { cn } from "@/lib/utils";

type SaveStatus = "idle" | "saving" | "saved" | "error";

function settingsErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "AI settings couldn’t be saved. Try again.";

  const data = (error as Error & { data?: unknown }).data;
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  if (typeof data === "string" && data.trim()) return data.trim();

  return "AI settings couldn’t be saved. Try again.";
}

export function AiSettingsCard({
  preloadedSettings,
}: {
  preloadedSettings: Preloaded<typeof api.aiAutomation.getAiSettings>;
}) {
  const settingsState = usePreloadedAuthQuery(preloadedSettings);
  const hasResolvedSettings = settingsState !== undefined;
  const initialSettings = settingsState ?? {
    enabled: false,
    globalAvailable: true,
    effectiveEnabled: false,
    answerModel: "openai/gpt-5.6-terra" as const,
    handoffMessage: "Thanks for your message. A human will continue here shortly.",
  };
  const configureAi = useMutation(api.aiAutomation.configureAi);
  const [enabled, setEnabled] = useState(initialSettings.enabled);
  const [handoffMessage, setHandoffMessage] = useState(
    initialSettings.handoffMessage,
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedSettings, setLastSavedSettings] = useState<{
    enabled: boolean;
    handoffMessage: string;
  } | null>(null);
  const lastServerSettings = useRef({
    enabled: initialSettings.enabled,
    handoffMessage: initialSettings.handoffMessage,
  });
  const pendingServerSettings = useRef<{
    enabled: boolean;
    handoffMessage: string;
  } | null>(null);
  const editRevision = useRef(0);
  const enabledButUnavailable =
    initialSettings.enabled && !initialSettings.globalAvailable;
  const visibleSaveStatus =
    saveStatus === "saved" &&
    (!hasResolvedSettings ||
      lastSavedSettings?.enabled !== initialSettings.enabled ||
      lastSavedSettings?.handoffMessage !== initialSettings.handoffMessage)
      ? "idle"
      : saveStatus;

  useEffect(() => {
    if (!hasResolvedSettings) return;

    const previousSettings = lastServerSettings.current;
    const pendingSettings = pendingServerSettings.current;
    const previousEnabled = saveAwareServerBaseline(
      previousSettings.enabled,
      initialSettings.enabled,
      pendingSettings?.enabled,
    );
    const previousHandoffMessage = saveAwareServerBaseline(
      previousSettings.handoffMessage,
      initialSettings.handoffMessage,
      pendingSettings?.handoffMessage,
    );

    setEnabled((current) =>
      syncUntouchedValue(
        current,
        previousEnabled,
        initialSettings.enabled,
      ),
    );
    setHandoffMessage((current) =>
      syncUntouchedValue(
        current,
        previousHandoffMessage,
        initialSettings.handoffMessage,
      ),
    );
    lastServerSettings.current = {
      enabled: initialSettings.enabled,
      handoffMessage: initialSettings.handoffMessage,
    };
  }, [
    hasResolvedSettings,
    initialSettings.enabled,
    initialSettings.handoffMessage,
  ]);

  function markEdited() {
    editRevision.current += 1;
    setSaveStatus((current) => (current === "saving" ? current : "idle"));
    setSaveError(null);
  }

  function updateEnabled(nextEnabled: boolean) {
    setEnabled(nextEnabled);
    markEdited();
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveStatus === "saving") return;

    const submittedRevision = editRevision.current;
    const submittedSettings = {
      enabled,
      handoffMessage: handoffMessage.trim(),
    };
    pendingServerSettings.current = submittedSettings;
    setSaveStatus("saving");
    setSaveError(null);
    try {
      await configureAi(submittedSettings);
      lastServerSettings.current = submittedSettings;
      setLastSavedSettings(submittedSettings);
      setHandoffMessage((current) =>
        current === handoffMessage
          ? submittedSettings.handoffMessage
          : current,
      );
      setSaveStatus(
        editRevision.current === submittedRevision ? "saved" : "idle",
      );
    } catch (error) {
      if (editRevision.current === submittedRevision) {
        setSaveStatus("error");
        setSaveError(settingsErrorMessage(error));
      } else {
        setSaveStatus("idle");
      }
    } finally {
      if (pendingServerSettings.current === submittedSettings) {
        pendingServerSettings.current = null;
      }
    }
  }

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b py-(--card-spacing)">
        <CardTitle className="flex items-center gap-2">
          <BotIcon className="size-4" aria-hidden />
          AI support
        </CardTitle>
        <CardDescription>
          Control automatic grounded replies and the fallback customers receive.
        </CardDescription>
        <CardAction>
          <Badge
            variant={
              enabledButUnavailable
                ? "destructive"
                : initialSettings.effectiveEnabled
                  ? "secondary"
                  : "outline"
            }
          >
            {enabledButUnavailable
              ? "Unavailable"
              : initialSettings.effectiveEnabled
                ? "Enabled"
                : "Paused"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="py-(--card-spacing)">
        <form className="flex flex-col gap-5" onSubmit={(event) => void handleSave(event)}>
          <FieldGroup>
            <FieldSet>
              <FieldLegend variant="label">Automatic answering</FieldLegend>
              <ToggleGroup
                value={[enabled ? "enabled" : "paused"]}
                variant="outline"
                spacing={2}
                aria-label="Automatic answering mode"
                onValueChange={(values) => {
                  const value = values[0];
                  if (value === "enabled") updateEnabled(true);
                  if (value === "paused") updateEnabled(false);
                }}
              >
                <ToggleGroupItem value="enabled">
                  <PlayCircleIcon aria-hidden />
                  Enabled
                </ToggleGroupItem>
                <ToggleGroupItem value="paused">
                  <PauseCircleIcon aria-hidden />
                  Paused
                </ToggleGroupItem>
              </ToggleGroup>
              <FieldDescription>
                When enabled, every eligible new or reopened conversation starts with AI.
                Without a ready source, it hands off instead of guessing.
              </FieldDescription>
            </FieldSet>

            <Field data-invalid={visibleSaveStatus === "error"}>
              <FieldLabel htmlFor="ai-handoff-message">Customer handoff message</FieldLabel>
              <Textarea
                id="ai-handoff-message"
                name="ai-handoff-message"
                autoComplete="off"
                value={handoffMessage}
                maxLength={4000}
                rows={3}
                aria-invalid={visibleSaveStatus === "error"}
                onChange={(event) => {
                  setHandoffMessage(event.target.value);
                  markEdited();
                }}
              />
              <FieldDescription>
                Shown when evidence is unavailable, a provider fails, or a limit requires
                a human response. {handoffMessage.length.toLocaleString()}/4,000 characters.
              </FieldDescription>
            </Field>
          </FieldGroup>

          {enabledButUnavailable ? (
            <Alert variant="destructive">
              <AlertTriangleIcon aria-hidden />
              <AlertTitle>Automatic answering is stopped globally</AlertTitle>
              <AlertDescription>
                This workspace is configured as enabled, but the operational kill switch
                is active. Customer conversations continue through human support.
              </AlertDescription>
            </Alert>
          ) : null}

          {saveError ? <FieldError>{saveError}</FieldError> : null}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Answer model: GPT-5.6 Terra through Convex AI Gateway
            </p>
            <div className="flex items-center justify-end gap-3">
              <p
                className={cn(
                  "text-xs text-muted-foreground",
                  visibleSaveStatus === "saved" && "text-[var(--status-open)]",
                  visibleSaveStatus === "error" && "text-destructive",
                )}
                aria-live="polite"
                aria-atomic="true"
              >
                {visibleSaveStatus === "saving"
                  ? "Saving…"
                  : visibleSaveStatus === "saved"
                    ? "AI settings saved."
                    : visibleSaveStatus === "error"
                      ? "Settings were not saved."
                      : "Changes apply after you save."}
              </p>
              <Button type="submit" disabled={visibleSaveStatus === "saving"}>
                {visibleSaveStatus === "saving" ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <CheckIcon data-icon="inline-start" />
                )}
                Save AI settings
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
