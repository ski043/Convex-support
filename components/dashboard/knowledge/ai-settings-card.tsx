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
import { syncUntouchedValue } from "@/lib/settings-form-model";
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
  const initialSettings = usePreloadedAuthQuery(preloadedSettings) ?? {
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
  const lastServerSettings = useRef({
    enabled: initialSettings.enabled,
    handoffMessage: initialSettings.handoffMessage,
  });
  const enabledButUnavailable =
    initialSettings.enabled && !initialSettings.globalAvailable;

  useEffect(() => {
    const previousSettings = lastServerSettings.current;

    setEnabled((current) =>
      syncUntouchedValue(
        current,
        previousSettings.enabled,
        initialSettings.enabled,
      ),
    );
    setHandoffMessage((current) =>
      syncUntouchedValue(
        current,
        previousSettings.handoffMessage,
        initialSettings.handoffMessage,
      ),
    );
    lastServerSettings.current = {
      enabled: initialSettings.enabled,
      handoffMessage: initialSettings.handoffMessage,
    };
  }, [initialSettings.enabled, initialSettings.handoffMessage]);

  function updateEnabled(nextEnabled: boolean) {
    setEnabled(nextEnabled);
    setSaveStatus("idle");
    setSaveError(null);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveStatus === "saving") return;

    setSaveStatus("saving");
    setSaveError(null);
    try {
      await configureAi({ enabled, handoffMessage });
      setHandoffMessage((current) => current.trim());
      setSaveStatus("saved");
    } catch (error) {
      setSaveStatus("error");
      setSaveError(settingsErrorMessage(error));
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

            <Field data-invalid={saveStatus === "error"}>
              <FieldLabel htmlFor="ai-handoff-message">Customer handoff message</FieldLabel>
              <Textarea
                id="ai-handoff-message"
                name="ai-handoff-message"
                autoComplete="off"
                value={handoffMessage}
                maxLength={4000}
                rows={3}
                aria-invalid={saveStatus === "error"}
                onChange={(event) => {
                  setHandoffMessage(event.target.value);
                  setSaveStatus("idle");
                  setSaveError(null);
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
                  saveStatus === "saved" && "text-[var(--status-open)]",
                  saveStatus === "error" && "text-destructive",
                )}
                aria-live="polite"
                aria-atomic="true"
              >
                {saveStatus === "saving"
                  ? "Saving…"
                  : saveStatus === "saved"
                    ? "AI settings saved."
                    : saveStatus === "error"
                      ? "Settings were not saved."
                      : "Changes apply after you save."}
              </p>
              <Button type="submit" disabled={saveStatus === "saving"}>
                {saveStatus === "saving" ? (
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
