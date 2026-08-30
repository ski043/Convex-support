"use client";

import { usePreloadedAuthQuery } from "@convex-dev/better-auth/nextjs/client";
import type { FunctionReturnType } from "convex/server";
import { useMutation, type Preloaded } from "convex/react";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  FileIcon,
  FileTextIcon,
  FileType2Icon,
  RefreshCwIcon,
  ReplaceIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UploadCloudIcon,
} from "lucide-react";
import {
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

type KnowledgeDocument = FunctionReturnType<typeof api.knowledge.list>[number];
type KnowledgeDocumentId = Id<"knowledgeDocuments">;
type UploadTarget =
  | { kind: "new" }
  | { kind: "replace"; documentId: KnowledgeDocumentId; title: string };
type UploadTask = {
  file: File;
  mimeType: string;
  requestId: string;
  target: UploadTarget;
  storageId?: Id<"_storage">;
};
type UploadState =
  | { phase: "idle" }
  | { phase: "uploading"; filename: string; progress: number; target: UploadTarget }
  | { phase: "registering"; filename: string; target: UploadTarget }
  | {
      phase: "error";
      filename: string;
      message: string;
      target: UploadTarget;
      canRetry: boolean;
    };
type PendingDocumentAction = "retrying" | "deleting" | "replacing";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ACCEPTED_FILE_TYPES =
  ".pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain";
const dateTimeFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const statusDetails = {
  queued: { label: "Queued", variant: "secondary" as const, busy: true },
  processing: { label: "Processing", variant: "outline" as const, busy: true },
  ready: { label: "Ready", variant: "secondary" as const, busy: false },
  failed: { label: "Failed", variant: "destructive" as const, busy: false },
  replacing: { label: "Replacing", variant: "outline" as const, busy: true },
  deleting: { label: "Deleting", variant: "destructive" as const, busy: true },
} satisfies Record<
  KnowledgeDocument["status"],
  { label: string; variant: "secondary" | "outline" | "destructive"; busy: boolean }
>;

function formatDate(timestamp: number) {
  return `${dateTimeFormatter.format(new Date(timestamp))} UTC`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileKindLabel(kind: KnowledgeDocument["fileKind"]) {
  if (kind === "pdf") return "PDF";
  if (kind === "markdown") return "Markdown";
  return "Plain text";
}

function FileKindIcon({ kind }: { kind: KnowledgeDocument["fileKind"] }) {
  if (kind === "pdf") return <FileType2Icon className="size-5" aria-hidden />;
  if (kind === "markdown") {
    return <FileTextIcon className="size-5" aria-hidden />;
  }
  return <FileIcon className="size-5" aria-hidden />;
}

function supportedMimeType(file: File) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".pdf")) return "application/pdf";
  if (lowerName.endsWith(".md") || lowerName.endsWith(".markdown")) {
    return "text/markdown";
  }
  if (lowerName.endsWith(".txt")) return "text/plain";
  return null;
}

function knowledgeErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;

  const data = (error as Error & { data?: unknown }).data;
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  if (typeof data === "string" && data.trim()) return data.trim();

  const structuredMessage = /ConvexError:\s*(?:\{[^}]*"message"\s*:\s*")?([^"\n}]+)/i.exec(
    error.message,
  )?.[1];

  return structuredMessage?.trim() || fallback;
}

function uploadToStorage(
  uploadUrl: string,
  file: File,
  mimeType: string,
  onProgress: (progress: number) => void,
) {
  return new Promise<Id<"_storage">>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", uploadUrl);
    request.setRequestHeader("Content-Type", mimeType);
    request.responseType = "json";
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    });
    request.addEventListener("load", () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new Error("The file transfer was not accepted."));
        return;
      }
      const response = request.response as unknown;
      const storageId =
        response && typeof response === "object" && "storageId" in response
          ? (response as { storageId?: unknown }).storageId
          : undefined;
      if (typeof storageId !== "string") {
        reject(new Error("The upload completed without a storage reference."));
        return;
      }
      resolve(storageId as Id<"_storage">);
    });
    request.addEventListener("error", () => {
      reject(new Error("The file transfer was interrupted."));
    });
    request.addEventListener("abort", () => {
      reject(new Error("The file transfer was cancelled."));
    });
    request.send(file);
  });
}

function KnowledgeStatus({ status }: { status: KnowledgeDocument["status"] }) {
  const details = statusDetails[status];

  return (
    <Badge variant={details.variant}>
      {details.busy ? (
        <Spinner className="size-3" aria-label={`${details.label} document`} />
      ) : status === "ready" ? (
        <CheckCircle2Icon aria-hidden />
      ) : status === "failed" ? (
        <AlertCircleIcon aria-hidden />
      ) : null}
      {details.label}
    </Badge>
  );
}

function DocumentRow({
  document,
  pendingAction,
  awaitingDeleteConfirmation,
  onReplace,
  onRetry,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  uploadBusy,
}: {
  document: KnowledgeDocument;
  pendingAction?: PendingDocumentAction;
  awaitingDeleteConfirmation: boolean;
  onReplace: (document: KnowledgeDocument) => void;
  onRetry: (documentId: KnowledgeDocumentId) => void;
  onRequestDelete: (documentId: KnowledgeDocumentId) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (documentId: KnowledgeDocumentId) => void;
  uploadBusy: boolean;
}) {
  const cleanupExhausted =
    document.status === "deleting" &&
    document.errorCode === "STORAGE_CLEANUP_RETRY_EXHAUSTED";
  const backendBusy =
    statusDetails[document.status].busy && !cleanupExhausted;
  const busy = backendBusy || pendingAction !== undefined || uploadBusy;

  return (
    <Item
      role="listitem"
      variant="outline"
      className="items-start gap-3 px-3.5 py-3.5 sm:flex-nowrap sm:items-center"
    >
      <ItemMedia
        variant="icon"
        className="flex size-10 rounded-lg bg-muted text-muted-foreground"
      >
        <FileKindIcon kind={document.fileKind} />
      </ItemMedia>
      <ItemContent className="min-w-0 basis-[320px]">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ItemTitle className="min-w-0 max-w-full">{document.title}</ItemTitle>
          <KnowledgeStatus status={document.status} />
          {document.version > 1 ? <Badge variant="outline">v{document.version}</Badge> : null}
        </div>
        <ItemDescription className="line-clamp-none break-all">
          {document.filename}
        </ItemDescription>
        {(document.status === "failed" || cleanupExhausted) &&
        document.errorMessage ? (
          <p className="mt-1 text-sm text-destructive" role="alert">
            {document.errorMessage}
          </p>
        ) : null}
        {document.status === "failed" && !document.canRetry ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Retry limit reached. Replace or delete this source to continue.
          </p>
        ) : null}
      </ItemContent>

      <div className="grid basis-full grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:ml-auto sm:basis-auto sm:grid-cols-1 sm:text-right">
        <span>
          {fileKindLabel(document.fileKind)} · {formatBytes(document.size)}
        </span>
        <time dateTime={new Date(document.updatedAt).toISOString()}>
          Updated {formatDate(document.updatedAt)}
        </time>
        {document.readyAt ? (
          <time
            className="col-span-2 sm:col-span-1"
            dateTime={new Date(document.readyAt).toISOString()}
          >
            Ready {formatDate(document.readyAt)}
          </time>
        ) : (
          <time
            className="col-span-2 sm:col-span-1"
            dateTime={new Date(document.createdAt).toISOString()}
          >
            Added {formatDate(document.createdAt)}
          </time>
        )}
      </div>

      <ItemActions className="ml-auto basis-full justify-end sm:ml-2 sm:basis-auto">
        {awaitingDeleteConfirmation ? (
          <>
            <span className="mr-auto text-xs text-muted-foreground sm:sr-only">
              Remove this source?
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={onCancelDelete}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => onConfirmDelete(document._id)}
            >
              <Trash2Icon data-icon="inline-start" />
              Delete now
            </Button>
          </>
        ) : (
          <>
            {document.canRetry ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => onRetry(document._id)}
              >
                {pendingAction === "retrying" ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <RefreshCwIcon data-icon="inline-start" />
                )}
                Retry
              </Button>
            ) : null}
            {cleanupExhausted ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pendingAction !== undefined || uploadBusy}
                onClick={() => onConfirmDelete(document._id)}
              >
                {pendingAction === "deleting" ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <RefreshCwIcon data-icon="inline-start" />
                )}
                Retry cleanup
              </Button>
            ) : null}
            {document.status === "ready" ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => onReplace(document)}
              >
                {pendingAction === "replacing" ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <ReplaceIcon data-icon="inline-start" />
                )}
                Replace
              </Button>
            ) : null}
            {!cleanupExhausted ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                aria-label={`Delete ${document.title}`}
                onClick={() => onRequestDelete(document._id)}
              >
                {pendingAction === "deleting" ? <Spinner /> : <Trash2Icon />}
              </Button>
            ) : null}
          </>
        )}
      </ItemActions>
    </Item>
  );
}

export function KnowledgeBase({
  preloadedDocuments,
  children,
}: {
  preloadedDocuments: Preloaded<typeof api.knowledge.list>;
  children?: ReactNode;
}) {
  const documents = usePreloadedAuthQuery(preloadedDocuments) ?? [];
  const generateUploadUrl = useMutation(api.knowledge.generateUploadUrl);
  const registerDocument = useMutation(api.knowledge.register);
  const replaceDocument = useMutation(api.knowledge.replace);
  const retryDocument = useMutation(api.knowledge.retry);
  const removeDocument = useMutation(api.knowledge.remove);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replacementInputRef = useRef<HTMLInputElement>(null);
  const uploadTaskRef = useRef<UploadTask | null>(null);
  const replacementTargetRef = useRef<
    Extract<UploadTarget, { kind: "replace" }> | null
  >(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>({ phase: "idle" });
  const [pendingActions, setPendingActions] = useState<
    Partial<Record<KnowledgeDocumentId, PendingDocumentAction>>
  >({});
  const [deleteConfirmationId, setDeleteConfirmationId] =
    useState<KnowledgeDocumentId | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const readyCount = documents.filter((document) => document.status === "ready").length;
  const pendingCount = documents.filter((document) =>
    statusDetails[document.status].busy,
  ).length;
  const failedCount = documents.filter((document) => document.status === "failed").length;
  const uploadBusy =
    uploadState.phase === "uploading" || uploadState.phase === "registering";

  function validateFile(
    file: File,
  ): { valid: true; mimeType: string } | { valid: false; error: string } {
    const mimeType = supportedMimeType(file);
    if (!mimeType) {
      return {
        valid: false,
        error: "Choose a PDF, Markdown (.md or .markdown), or plain-text (.txt) file.",
      };
    }
    if (file.size < 1) {
      return {
        valid: false,
        error: "This file is empty. Choose a file with readable content.",
      };
    }
    if (file.size > MAX_FILE_BYTES) {
      return { valid: false, error: "Knowledge files cannot exceed 20 MB." };
    }
    return { valid: true, mimeType };
  }

  async function registerTask(task: UploadTask) {
    if (!task.storageId) return;

    setUploadState({
      phase: "registering",
      filename: task.file.name,
      target: task.target,
    });

    if (task.target.kind === "new") {
      await registerDocument({
        storageId: task.storageId,
        filename: task.file.name,
        mimeType: task.mimeType,
        clientRequestId: task.requestId,
      });
    } else {
      await replaceDocument({
        documentId: task.target.documentId,
        storageId: task.storageId,
        filename: task.file.name,
        mimeType: task.mimeType,
        clientRequestId: task.requestId,
      });
    }

    uploadTaskRef.current = null;
    setUploadState({ phase: "idle" });
    setActionError(null);
    const target = task.target;
    if (target.kind === "replace") {
      setPendingActions((current) => {
        const next = { ...current };
        delete next[target.documentId];
        return next;
      });
    }
  }

  async function runUploadTask(task: UploadTask) {
    uploadTaskRef.current = task;
    setActionError(null);
    setUploadState({
      phase: "uploading",
      filename: task.file.name,
      progress: 0,
      target: task.target,
    });

    try {
      const uploadUrl = await generateUploadUrl({});
      task.storageId = await uploadToStorage(
        uploadUrl,
        task.file,
        task.mimeType,
        (progress) => {
          setUploadState({
            phase: "uploading",
            filename: task.file.name,
            progress,
            target: task.target,
          });
        },
      );
      await registerTask(task);
    } catch (error) {
      setUploadState({
        phase: "error",
        filename: task.file.name,
        target: task.target,
        canRetry: true,
        message: knowledgeErrorMessage(
          error,
          task.storageId
            ? "The file uploaded, but registration did not finish. Retry to complete it safely."
            : "The file could not be uploaded. Check your connection and try again.",
        ),
      });
      const target = task.target;
      if (target.kind === "replace") {
        setPendingActions((current) => {
          const next = { ...current };
          delete next[target.documentId];
          return next;
        });
      }
    }
  }

  function startFile(file: File, target: UploadTarget) {
    const validation = validateFile(file);
    if (!validation.valid) {
      uploadTaskRef.current = null;
      setUploadState({
        phase: "error",
        filename: file.name,
        message: validation.error,
        target,
        canRetry: false,
      });
      return;
    }

    const task: UploadTask = {
      file,
      mimeType: validation.mimeType,
      requestId: crypto.randomUUID(),
      target,
    };
    if (target.kind === "replace") {
      setPendingActions((current) => ({
        ...current,
        [target.documentId]: "replacing",
      }));
    }
    void runUploadTask(task);
  }

  function handleNewFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) startFile(file, { kind: "new" });
  }

  function handleReplacementFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const target = replacementTargetRef.current;
    event.target.value = "";
    replacementTargetRef.current = null;
    if (file && target) startFile(file, target);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (uploadBusy) return;
    const file = event.dataTransfer.files[0];
    if (file) startFile(file, { kind: "new" });
  }

  function chooseReplacement(document: KnowledgeDocument) {
    const target = {
      kind: "replace" as const,
      documentId: document._id,
      title: document.title,
    };
    replacementTargetRef.current = target;
    replacementInputRef.current?.click();
  }

  async function retryUpload() {
    const task = uploadTaskRef.current;
    if (!task) return;
    const target = task.target;
    if (target.kind === "replace") {
      setPendingActions((current) => ({
        ...current,
        [target.documentId]: "replacing",
      }));
    }

    try {
      if (task.storageId) {
        await registerTask(task);
      } else {
        await runUploadTask(task);
      }
    } catch (error) {
      setUploadState({
        phase: "error",
        filename: task.file.name,
        target: task.target,
        canRetry: true,
        message: knowledgeErrorMessage(
          error,
          "Registration did not finish. Retry to complete it safely.",
        ),
      });
    }
  }

  async function retryProcessing(documentId: KnowledgeDocumentId) {
    setPendingActions((current) => ({ ...current, [documentId]: "retrying" }));
    setActionError(null);
    try {
      await retryDocument({ documentId });
    } catch (error) {
      setActionError(
        knowledgeErrorMessage(error, "Processing could not be retried. Try again shortly."),
      );
    } finally {
      setPendingActions((current) => {
        const next = { ...current };
        delete next[documentId];
        return next;
      });
    }
  }

  async function deleteDocument(documentId: KnowledgeDocumentId) {
    setDeleteConfirmationId(null);
    setPendingActions((current) => ({ ...current, [documentId]: "deleting" }));
    setActionError(null);
    try {
      await removeDocument({ documentId });
    } catch (error) {
      setActionError(
        knowledgeErrorMessage(error, "This source could not be deleted. Try again shortly."),
      );
      setPendingActions((current) => {
        const next = { ...current };
        delete next[documentId];
        return next;
      });
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-8 pb-10">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            <ShieldCheckIcon className="size-4" aria-hidden />
            Grounded answers
          </div>
          <h1 className="font-heading text-3xl font-medium tracking-tight sm:text-4xl">
            Knowledge
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Give your support agent approved source material. Only documents marked ready
            can inform customer answers.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2" aria-label="Knowledge status summary">
          <div className="rounded-lg border bg-card px-3 py-2 text-center">
            <p className="text-lg font-medium">{readyCount}</p>
            <p className="text-[11px] text-muted-foreground">Ready</p>
          </div>
          <div className="rounded-lg border bg-card px-3 py-2 text-center">
            <p className="text-lg font-medium">{pendingCount}</p>
            <p className="text-[11px] text-muted-foreground">Pending</p>
          </div>
          <div className="rounded-lg border bg-card px-3 py-2 text-center">
            <p className="text-lg font-medium">{failedCount}</p>
            <p className="text-[11px] text-muted-foreground">Failed</p>
          </div>
        </div>
      </header>

      {children}

      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-(--card-spacing)">
          <CardTitle>Add a source</CardTitle>
          <CardDescription>
            Upload one selectable-text PDF, UTF-8 Markdown, or UTF-8 text file at a time.
          </CardDescription>
        </CardHeader>
        <CardContent className="py-(--card-spacing)">
          <Field data-invalid={uploadState.phase === "error"}>
            <FieldLabel>Knowledge file</FieldLabel>
            <div
              className={cn(
                "flex min-h-40 flex-col items-center justify-center gap-4 rounded-xl border border-dashed p-6 text-center transition-colors",
                isDragging && "border-primary bg-muted/60",
                uploadBusy && "opacity-70",
              )}
              onDragEnter={(event) => {
                event.preventDefault();
                if (!uploadBusy) setIsDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setIsDragging(false);
                }
              }}
              onDrop={handleDrop}
            >
              <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <UploadCloudIcon className="size-5" aria-hidden />
              </span>
              <div className="flex max-w-md flex-col gap-1">
                <p className="text-sm font-medium">
                  {uploadBusy ? "Your file is on its way" : "Drop a file here or choose one"}
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  PDF, .md, .markdown, or .txt · 20 MB maximum · scanned and encrypted PDFs are not supported
                </p>
              </div>
              <Input
                ref={fileInputRef}
                id="knowledge-file"
                name="knowledge-file"
                type="file"
                accept={ACCEPTED_FILE_TYPES}
                className="hidden"
                disabled={uploadBusy}
                tabIndex={-1}
                aria-hidden="true"
                onChange={handleNewFile}
              />
              <Input
                ref={replacementInputRef}
                id="knowledge-replacement-file"
                name="knowledge-replacement-file"
                type="file"
                accept={ACCEPTED_FILE_TYPES}
                className="hidden"
                disabled={uploadBusy}
                tabIndex={-1}
                aria-hidden="true"
                onChange={handleReplacementFile}
              />
              <Button
                type="button"
                variant="outline"
                className="h-10 sm:h-8"
                disabled={uploadBusy}
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadCloudIcon data-icon="inline-start" />
                Choose file
              </Button>
            </div>
            <FieldDescription>
              Files upload directly to private Convex storage, then process in the
              background. A source is unavailable to the agent until it reaches Ready.
            </FieldDescription>
          </Field>

          {uploadState.phase === "uploading" ? (
            <div className="mt-5 flex flex-col gap-2" aria-live="polite" aria-busy="true">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">Uploading {uploadState.filename}</span>
                <span className="shrink-0 text-muted-foreground">{uploadState.progress}%</span>
              </div>
              <progress
                className="h-2 w-full overflow-hidden rounded-full accent-primary"
                max={100}
                value={uploadState.progress}
              >
                {uploadState.progress}%
              </progress>
            </div>
          ) : uploadState.phase === "registering" ? (
            <div
              className="mt-5 flex items-center gap-2 text-sm"
              aria-live="polite"
              aria-busy="true"
            >
              <Spinner />
              Registering {uploadState.filename} and queuing processing…
            </div>
          ) : uploadState.phase === "error" ? (
            <Alert variant="destructive" className="mt-5">
              <AlertCircleIcon aria-hidden />
              <AlertTitle>
                {uploadState.target.kind === "replace"
                  ? `Replacement for ${uploadState.target.title} wasn’t started`
                  : `${uploadState.filename} wasn’t added`}
              </AlertTitle>
              <AlertDescription>{uploadState.message}</AlertDescription>
              {uploadState.canRetry ? (
                <div className="col-start-2 mt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void retryUpload()}
                  >
                    <RefreshCwIcon data-icon="inline-start" />
                    Retry
                  </Button>
                </div>
              ) : null}
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <section aria-labelledby="knowledge-sources-title" className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="knowledge-sources-title" className="font-heading text-lg font-medium">
              Sources
            </h2>
            <p className="text-sm text-muted-foreground">
              {documents.length === 1 ? "1 document" : `${documents.length} documents`}
            </p>
          </div>
          {pendingCount > 0 ? (
            <Badge variant="outline">
              <Spinner aria-label="Documents are processing" />
              {pendingCount} pending
            </Badge>
          ) : null}
        </div>

        {actionError ? (
          <Alert variant="destructive">
            <AlertCircleIcon aria-hidden />
            <AlertTitle>The source was not changed</AlertTitle>
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        ) : null}

        {documents.length === 0 ? (
          <Empty className="min-h-64 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileTextIcon />
              </EmptyMedia>
              <EmptyTitle>No knowledge sources yet</EmptyTitle>
              <EmptyDescription>
                Add product details, policies, or support guides so the agent can answer
                from material you approve.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadCloudIcon data-icon="inline-start" />
                Upload your first source
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <ItemGroup>
            {documents.map((document) => (
              <DocumentRow
                key={document._id}
                document={document}
                pendingAction={pendingActions[document._id]}
                awaitingDeleteConfirmation={deleteConfirmationId === document._id}
                onReplace={chooseReplacement}
                onRetry={(documentId) => void retryProcessing(documentId)}
                onRequestDelete={setDeleteConfirmationId}
                onCancelDelete={() => setDeleteConfirmationId(null)}
                onConfirmDelete={(documentId) => void deleteDocument(documentId)}
                uploadBusy={uploadBusy}
              />
            ))}
          </ItemGroup>
        )}
      </section>
    </div>
  );
}
