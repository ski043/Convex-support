import { DAY, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import type { EntryId } from "@convex-dev/rag";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { requireOwnerWorkspace } from "./chatOwner";
import {
  knowledgeError,
  knowledgeNamespace,
  MAX_AUTOMATIC_INGESTION_ATTEMPTS,
  MAX_KNOWLEDGE_FILE_BYTES,
  MAX_TOTAL_INGESTION_ATTEMPTS,
  normalizeClientRequestId,
  sanitizeFailureMessage,
  sanitizeKnowledgeFilename,
  sanitizeKnowledgeTitle,
  validateKnowledgeFileSize,
  validateKnowledgeFileType,
} from "./knowledgeModel";
import { knowledgeRag } from "./knowledgeRag";
import { runCleanupAttempt } from "./knowledgeCleanup";
import {
  knowledgeFileKindValidator,
  knowledgeStatusValidator,
} from "./schema";

const processDocumentReference = makeFunctionReference<
  "action",
  { documentId: Id<"knowledgeDocuments"> },
  null
>("knowledgeNode:processDocument");

const cleanupStorageReference = makeFunctionReference<
  "mutation",
  {
    documentId: Id<"knowledgeDocuments">;
    storageId: Id<"_storage">;
    cleanupToken: string;
    attempt: number;
  },
  null
>("knowledge:cleanupStorage");

const recoverProcessingLeaseReference = makeFunctionReference<
  "mutation",
  {
    documentId: Id<"knowledgeDocuments">;
    processingToken: string;
    attempt: number;
  },
  null
>("knowledge:recoverProcessingLease");

const HOUR = 60 * MINUTE;
const PROCESSING_LEASE_MS = 30 * 60_000;
const KNOWLEDGE_UPLOAD_BYTES_PER_DAY = 100 * 1024 * 1024;
const knowledgeRateLimiter = new RateLimiter(components.rateLimiter, {
  knowledgeUploadUrl: {
    kind: "fixed window",
    rate: 40,
    period: DAY,
    capacity: 40,
  },
  knowledgeUploadCount: {
    kind: "fixed window",
    rate: 30,
    period: DAY,
    capacity: 30,
  },
  knowledgeUploadBytes: {
    kind: "fixed window",
    rate: KNOWLEDGE_UPLOAD_BYTES_PER_DAY,
    period: DAY,
    capacity: KNOWLEDGE_UPLOAD_BYTES_PER_DAY,
    start: 0,
  },
  knowledgeIngestionWorkspace: {
    kind: "token bucket",
    rate: 1,
    period: 20_000,
    capacity: 2,
  },
  knowledgeIngestionGlobal: {
    kind: "token bucket",
    rate: 12,
    period: MINUTE,
    capacity: 12,
  },
  knowledgeAutomaticRetry: {
    kind: "fixed window",
    rate: 6,
    period: HOUR,
    capacity: 6,
  },
  knowledgeManualRetry: {
    kind: "fixed window",
    rate: 8,
    period: DAY,
    capacity: 8,
  },
});

const documentListItemValidator = v.object({
  _id: v.id("knowledgeDocuments"),
  filename: v.string(),
  title: v.string(),
  mimeType: v.string(),
  fileKind: knowledgeFileKindValidator,
  size: v.number(),
  status: knowledgeStatusValidator,
  errorCode: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  canRetry: v.boolean(),
  canReplace: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
  readyAt: v.optional(v.number()),
  version: v.number(),
});

const registrationResultValidator = v.object({
  documentId: v.id("knowledgeDocuments"),
});

const processingDocumentValidator = v.union(
  v.null(),
  v.object({
    documentId: v.id("knowledgeDocuments"),
    workspaceId: v.id("workspaces"),
    storageId: v.id("_storage"),
    filename: v.string(),
    title: v.string(),
    mimeType: v.string(),
    fileKind: knowledgeFileKindValidator,
    size: v.number(),
    sha256: v.string(),
    stableKey: v.string(),
    version: v.number(),
    replacesDocumentId: v.optional(v.id("knowledgeDocuments")),
    processingToken: v.string(),
  }),
);

type RegisterUploadArgs = {
  storageId: Id<"_storage">;
  filename: string;
  mimeType: string;
  clientRequestId: string;
};

function processingToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function normalizeDeclaredMimeType(value: string) {
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!normalized || normalized.length > 100) {
    throw knowledgeError("UNSUPPORTED_FILE_TYPE", "Invalid content type.");
  }
  return normalized;
}

export async function consumeRegistrationQuota(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  size: number,
  uploadedAt: number,
) {
  const key = String(workspaceId);
  const countLimit = await knowledgeRateLimiter.limit(
    ctx,
    "knowledgeUploadCount",
    { key },
  );
  if (!countLimit.ok) {
    throw knowledgeError(
      "UPLOAD_QUOTA_EXCEEDED",
      "The daily knowledge upload limit has been reached.",
    );
  }
  const registeredInReservationWindow =
    Math.floor(uploadedAt / DAY) === Math.floor(Date.now() / DAY);
  if (!registeredInReservationWindow) {
    const byteLimit = await knowledgeRateLimiter.limit(
      ctx,
      "knowledgeUploadBytes",
      { key, count: size },
    );
    if (!byteLimit.ok) {
      throw knowledgeError(
        "UPLOAD_QUOTA_EXCEEDED",
        "The daily knowledge upload byte limit has been reached.",
      );
    }
    return;
  }

  const unusedReservation = MAX_KNOWLEDGE_FILE_BYTES - size;
  if (unusedReservation > 0) {
    const current = await knowledgeRateLimiter.getValue(
      ctx,
      "knowledgeUploadBytes",
      { key },
    );
    // The component has no refund API. A bounded negative consume restores
    // only this same-window upload's unused reservation and never exceeds
    // bucket capacity.
    const refundable = Math.min(
      unusedReservation,
      Math.max(0, KNOWLEDGE_UPLOAD_BYTES_PER_DAY - current.value),
    );
    if (refundable > 0) {
      await knowledgeRateLimiter.limit(ctx, "knowledgeUploadBytes", {
        key,
        count: -refundable,
      });
    }
  }
}

async function scheduleCleanup(
  ctx: MutationCtx,
  document: Doc<"knowledgeDocuments">,
  cleanupToken: string,
  attempt: number,
  delay = 0,
) {
  await ctx.scheduler.runAfter(delay, cleanupStorageReference, {
    documentId: document._id,
    storageId: document.storageId,
    cleanupToken,
    attempt,
  });
}

async function deleteRagEntryIfPresent(
  ctx: MutationCtx,
  entryId: string,
) {
  try {
    await knowledgeRag.deleteAsync(ctx, { entryId: entryId as EntryId });
  } catch (error) {
    // RAG cleanup is best-effort here. Search results are independently gated
    // by ready knowledgeDocuments, so an upstream wording or transport change
    // must not roll back document deletion or its storage cleanup schedule.
    console.warn(`Could not delete RAG entry ${entryId}; continuing cleanup.`, error);
  }
}

async function startCleanup(
  ctx: MutationCtx,
  document: Doc<"knowledgeDocuments">,
  now: number,
  preserveRagEntryId?: string,
  skipRagDelete = false,
) {
  const cleanupToken = processingToken();
  await ctx.db.patch("knowledgeDocuments", document._id, {
    status: "deleting",
    processingToken: undefined,
    cleanupToken,
    cleanupAttempt: 0,
    errorCode: undefined,
    errorMessage: undefined,
    updatedAt: now,
  });
  if (
    !skipRagDelete &&
    document.ragEntryId &&
    document.ragEntryId !== preserveRagEntryId
  ) {
    await deleteRagEntryIfPresent(ctx, document.ragEntryId);
  }
  await scheduleCleanup(ctx, document, cleanupToken, 0);
}

async function ensureCleanupScheduled(
  ctx: MutationCtx,
  document: Doc<"knowledgeDocuments">,
) {
  if (document.cleanupToken) {
    await scheduleCleanup(
      ctx,
      document,
      document.cleanupToken,
      document.cleanupAttempt ?? 0,
    );
    return;
  }
  await startCleanup(ctx, document, Date.now(), undefined, true);
}

async function registerUpload(
  ctx: MutationCtx,
  args: RegisterUploadArgs,
  replacing: Doc<"knowledgeDocuments"> | null,
) {
  const workspace = await requireOwnerWorkspace(ctx);
  const clientRequestId = normalizeClientRequestId(args.clientRequestId);
  const filename = sanitizeKnowledgeFilename(args.filename);
  const declaredMimeType = normalizeDeclaredMimeType(args.mimeType);

  const idempotent = await ctx.db
    .query("knowledgeDocuments")
    .withIndex("by_clientRequestId", (q) =>
      q.eq("clientRequestId", clientRequestId),
    )
    .unique();
  if (idempotent) {
    if (
      idempotent.workspaceId !== workspace._id ||
      idempotent.storageId !== args.storageId ||
      idempotent.filename !== filename ||
      idempotent.mimeType !== declaredMimeType ||
      idempotent.replacesDocumentId !== replacing?._id
    ) {
      throw knowledgeError(
        "IDEMPOTENCY_CONFLICT",
        "clientRequestId was already used for a different upload.",
      );
    }
    return { documentId: idempotent._id };
  }

  const storageAliases = await ctx.db
    .query("knowledgeDocuments")
    .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
    .take(2);
  if (storageAliases.length > 0) {
    throw knowledgeError(
      "STORAGE_ALREADY_REGISTERED",
      "This uploaded file is already registered as a knowledge document.",
    );
  }

  let stableKey = `document:${clientRequestId}`;
  let version = 1;
  let replacesDocumentId: Id<"knowledgeDocuments"> | undefined;
  if (replacing) {
    if (
      replacing.workspaceId !== workspace._id ||
      replacing.status !== "ready"
    ) {
      throw knowledgeError(
        "DOCUMENT_NOT_REPLACEABLE",
        "Only a ready document in this workspace can be replaced.",
      );
    }
    const versions = await ctx.db
      .query("knowledgeDocuments")
      .withIndex("by_workspaceId_and_stableKey_and_version", (q) =>
        q
          .eq("workspaceId", workspace._id)
          .eq("stableKey", replacing.stableKey),
      )
      .order("desc")
      .take(25);
    const currentReady = versions.find((document) => document.status === "ready");
    if (
      versions[0]?._id !== replacing._id ||
      currentReady?._id !== replacing._id
    ) {
      throw knowledgeError(
        "DOCUMENT_NOT_REPLACEABLE",
        "A newer replacement already exists for this document.",
      );
    }
    stableKey = replacing.stableKey;
    version = (versions[0]?.version ?? replacing.version) + 1;
    replacesDocumentId = replacing._id;
  }

  const storedFile = await ctx.db.system.get("_storage", args.storageId);
  if (!storedFile) {
    throw knowledgeError("UPLOAD_NOT_FOUND", "Uploaded file not found.");
  }
  validateKnowledgeFileSize(storedFile.size);
  const { fileKind, mimeType } = validateKnowledgeFileType(
    filename,
    storedFile.contentType,
  );
  if (declaredMimeType !== mimeType) {
    throw knowledgeError(
      "CONTENT_TYPE_MISMATCH",
      "The uploaded file content type does not match its registration metadata.",
    );
  }

  await consumeRegistrationQuota(
    ctx,
    workspace._id,
    storedFile.size,
    storedFile._creationTime,
  );
  const now = Date.now();
  const documentId = await ctx.db.insert("knowledgeDocuments", {
    workspaceId: workspace._id,
    storageId: args.storageId,
    clientRequestId,
    stableKey,
    version,
    ...(replacesDocumentId === undefined ? {} : { replacesDocumentId }),
    filename,
    title: sanitizeKnowledgeTitle(undefined, filename),
    mimeType,
    fileKind,
    size: storedFile.size,
    sha256: storedFile.sha256,
    status: replacing ? "replacing" : "queued",
    attempt: 0,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, processDocumentReference, { documentId });
  return { documentId };
}

export const list = query({
  args: {},
  returns: v.array(documentListItemValidator),
  handler: async (ctx) => {
    const workspace = await requireOwnerWorkspace(ctx);
    const documents = await ctx.db
      .query("knowledgeDocuments")
      .withIndex("by_workspaceId_and_createdAt", (q) =>
        q.eq("workspaceId", workspace._id),
      )
      .order("desc")
      .take(100);
    const latestVersionByStableKey = new Map<string, number>();
    for (const document of documents) {
      latestVersionByStableKey.set(
        document.stableKey,
        Math.max(
          latestVersionByStableKey.get(document.stableKey) ?? 0,
          document.version,
        ),
      );
    }
    return documents.map((document) => ({
      _id: document._id,
      filename: document.filename,
      title: document.title,
      mimeType: document.mimeType,
      fileKind: document.fileKind,
      size: document.size,
      status: document.status,
      ...(document.errorCode === undefined
        ? {}
        : { errorCode: document.errorCode }),
      ...(document.errorMessage === undefined
        ? {}
        : { errorMessage: document.errorMessage }),
      canRetry:
        document.status === "failed" &&
        document.attempt < MAX_TOTAL_INGESTION_ATTEMPTS,
      canReplace:
        document.status === "ready" &&
        latestVersionByStableKey.get(document.stableKey) === document.version,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      ...(document.readyAt === undefined ? {} : { readyAt: document.readyAt }),
      version: document.version,
    }));
  },
});

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const workspace = await requireOwnerWorkspace(ctx);
    const issuanceLimit = await knowledgeRateLimiter.limit(
      ctx,
      "knowledgeUploadUrl",
      { key: String(workspace._id) },
    );
    if (!issuanceLimit.ok) {
      throw knowledgeError(
        "UPLOAD_URL_QUOTA_EXCEEDED",
        "The daily upload URL limit has been reached.",
      );
    }
    const byteReservation = await knowledgeRateLimiter.limit(
      ctx,
      "knowledgeUploadBytes",
      {
        key: String(workspace._id),
        count: MAX_KNOWLEDGE_FILE_BYTES,
      },
    );
    if (!byteReservation.ok) {
      throw knowledgeError(
        "UPLOAD_QUOTA_EXCEEDED",
        "The daily knowledge upload byte limit has been reached.",
      );
    }
    return await ctx.storage.generateUploadUrl();
  },
});

export const register = mutation({
  args: {
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    clientRequestId: v.string(),
  },
  returns: registrationResultValidator,
  handler: async (ctx, args) => await registerUpload(ctx, args, null),
});

export const replace = mutation({
  args: {
    documentId: v.id("knowledgeDocuments"),
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    clientRequestId: v.string(),
  },
  returns: registrationResultValidator,
  handler: async (ctx, args) => {
    const replacing = await ctx.db.get("knowledgeDocuments", args.documentId);
    if (!replacing) {
      throw knowledgeError("DOCUMENT_NOT_FOUND", "Knowledge document not found.");
    }
    return await registerUpload(ctx, args, replacing);
  },
});

export const retry = mutation({
  args: { documentId: v.id("knowledgeDocuments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workspace = await requireOwnerWorkspace(ctx);
    const document = await ctx.db.get("knowledgeDocuments", args.documentId);
    if (!document || document.workspaceId !== workspace._id) {
      throw knowledgeError("DOCUMENT_NOT_FOUND", "Knowledge document not found.");
    }
    if (document.status !== "failed") {
      throw knowledgeError(
        "DOCUMENT_NOT_RETRYABLE",
        "Only failed documents can be retried.",
      );
    }
    if (document.attempt >= MAX_TOTAL_INGESTION_ATTEMPTS) {
      throw knowledgeError(
        "RETRY_LIMIT_EXCEEDED",
        "This document has reached the maximum number of processing attempts.",
      );
    }
    const newestVersion = await ctx.db
      .query("knowledgeDocuments")
      .withIndex("by_workspaceId_and_stableKey_and_version", (q) =>
        q
          .eq("workspaceId", workspace._id)
          .eq("stableKey", document.stableKey),
      )
      .order("desc")
      .first();
    if (newestVersion?._id !== document._id) {
      throw knowledgeError(
        "DOCUMENT_NOT_RETRYABLE",
        "A newer version already exists for this document.",
      );
    }
    const retryLimit = await knowledgeRateLimiter.limit(
      ctx,
      "knowledgeManualRetry",
      { key: String(workspace._id) },
    );
    if (!retryLimit.ok) {
      throw knowledgeError(
        "RETRY_RATE_LIMITED",
        "The daily knowledge retry limit has been reached.",
      );
    }
    await ctx.db.patch("knowledgeDocuments", document._id, {
      status: document.replacesDocumentId ? "replacing" : "queued",
      processingToken: undefined,
      errorCode: undefined,
      errorMessage: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, processDocumentReference, {
      documentId: document._id,
    });
    return null;
  },
});

export const remove = mutation({
  args: { documentId: v.id("knowledgeDocuments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workspace = await requireOwnerWorkspace(ctx);
    const document = await ctx.db.get("knowledgeDocuments", args.documentId);
    if (!document || document.workspaceId !== workspace._id) {
      throw knowledgeError("DOCUMENT_NOT_FOUND", "Knowledge document not found.");
    }
    await startCleanup(
      ctx,
      document,
      Date.now(),
      undefined,
      document.status === "deleting",
    );
    return null;
  },
});

export const beginProcessing = internalMutation({
  args: { documentId: v.id("knowledgeDocuments") },
  returns: processingDocumentValidator,
  handler: async (ctx, args) => {
    const document = await ctx.db.get("knowledgeDocuments", args.documentId);
    if (
      !document ||
      (document.status !== "queued" && document.status !== "replacing")
    ) {
      return null;
    }
    if (document.attempt >= MAX_TOTAL_INGESTION_ATTEMPTS) {
      await ctx.db.patch("knowledgeDocuments", document._id, {
        status: "failed",
        errorCode: "RETRY_LIMIT_EXCEEDED",
        errorMessage: "The maximum number of processing attempts was reached.",
        updatedAt: Date.now(),
      });
      return null;
    }

    await knowledgeRateLimiter.limit(ctx, "knowledgeIngestionWorkspace", {
      key: String(document.workspaceId),
      throws: true,
    });
    await knowledgeRateLimiter.limit(ctx, "knowledgeIngestionGlobal", {
      key: "global",
      throws: true,
    });

    const token = processingToken();
    await ctx.db.patch("knowledgeDocuments", document._id, {
      status: "processing",
      attempt: document.attempt + 1,
      processingToken: token,
      errorCode: undefined,
      errorMessage: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(PROCESSING_LEASE_MS, recoverProcessingLeaseReference, {
      documentId: document._id,
      processingToken: token,
      attempt: document.attempt + 1,
    });
    return {
      documentId: document._id,
      workspaceId: document.workspaceId,
      storageId: document.storageId,
      filename: document.filename,
      title: document.title,
      mimeType: document.mimeType,
      fileKind: document.fileKind,
      size: document.size,
      sha256: document.sha256,
      stableKey: document.stableKey,
      version: document.version,
      ...(document.replacesDocumentId === undefined
        ? {}
        : { replacesDocumentId: document.replacesDocumentId }),
      processingToken: token,
    };
  },
});

export const deferProcessing = internalMutation({
  args: {
    documentId: v.id("knowledgeDocuments"),
    retryAfter: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const document = await ctx.db.get("knowledgeDocuments", args.documentId);
    if (
      !document ||
      (document.status !== "queued" && document.status !== "replacing")
    ) {
      return null;
    }
    const delay = Math.min(60_000, Math.max(250, Math.ceil(args.retryAfter)));
    await ctx.scheduler.runAfter(delay, processDocumentReference, {
      documentId: document._id,
    });
    return null;
  },
});

async function failProcessing(
  ctx: MutationCtx,
  document: Doc<"knowledgeDocuments">,
  args: {
    processingToken: string;
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
  },
) {
  if (
    document.status !== "processing" ||
    document.processingToken !== args.processingToken
  ) {
    return;
  }

  if (
    args.retryable &&
    document.attempt < MAX_AUTOMATIC_INGESTION_ATTEMPTS
  ) {
    const retryLimit = await knowledgeRateLimiter.limit(
      ctx,
      "knowledgeAutomaticRetry",
      { key: String(document.workspaceId) },
    );
    if (retryLimit.ok) {
      await ctx.db.patch("knowledgeDocuments", document._id, {
        status: document.replacesDocumentId ? "replacing" : "queued",
        processingToken: undefined,
        errorCode: args.errorCode,
        errorMessage: sanitizeFailureMessage(args.errorMessage),
        updatedAt: Date.now(),
      });
      const delay = Math.min(30_000, 1_000 * 2 ** (document.attempt - 1));
      await ctx.scheduler.runAfter(delay, processDocumentReference, {
        documentId: document._id,
      });
      return;
    }
  }

  await ctx.db.patch("knowledgeDocuments", document._id, {
    status: "failed",
    processingToken: undefined,
    errorCode: args.errorCode,
    errorMessage: sanitizeFailureMessage(args.errorMessage),
    updatedAt: Date.now(),
  });
}

export const handleProcessingFailure = internalMutation({
  args: {
    documentId: v.id("knowledgeDocuments"),
    processingToken: v.string(),
    errorCode: v.string(),
    errorMessage: v.string(),
    retryable: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const document = await ctx.db.get("knowledgeDocuments", args.documentId);
    if (!document) return null;
    await failProcessing(ctx, document, args);
    return null;
  },
});

export const recoverProcessingLease = internalMutation({
  args: {
    documentId: v.id("knowledgeDocuments"),
    processingToken: v.string(),
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const document = await ctx.db.get("knowledgeDocuments", args.documentId);
    if (
      !document ||
      document.status !== "processing" ||
      document.processingToken !== args.processingToken ||
      document.attempt !== args.attempt
    ) {
      return null;
    }
    await failProcessing(ctx, document, {
      processingToken: args.processingToken,
      errorCode: "PROCESSING_LEASE_EXPIRED",
      errorMessage:
        "The document processing worker did not complete before its lease expired.",
      retryable: true,
    });
    return null;
  },
});

async function commitReadyEntry(
  ctx: MutationCtx,
  document: Doc<"knowledgeDocuments">,
  processingTokenValue: string,
  ragEntryId: string,
  replacedRagEntryId: string | null,
) {
  const replacedDocument = document.replacesDocumentId
    ? await ctx.db.get("knowledgeDocuments", document.replacesDocumentId)
    : null;
  if (
    document.status !== "processing" ||
    document.processingToken !== processingTokenValue
  ) {
    if (replacedDocument?.ragEntryId !== ragEntryId) {
      await deleteRagEntryIfPresent(ctx, ragEntryId);
    }
    return;
  }

  const now = Date.now();
  await ctx.db.patch("knowledgeDocuments", document._id, {
    status: "ready",
    ragEntryId,
    processingToken: undefined,
    errorCode: undefined,
    errorMessage: undefined,
    readyAt: now,
    updatedAt: now,
  });

  if (
    replacedDocument &&
    replacedDocument.workspaceId === document.workspaceId &&
    replacedDocument.stableKey === document.stableKey &&
    replacedDocument.status === "ready"
  ) {
    await startCleanup(ctx, replacedDocument, now, ragEntryId);
  }
  if (
    replacedRagEntryId &&
    replacedRagEntryId !== ragEntryId &&
    replacedRagEntryId !== replacedDocument?.ragEntryId
  ) {
    await deleteRagEntryIfPresent(ctx, replacedRagEntryId);
  }
}

export const completeExistingEntry = internalMutation({
  args: {
    documentId: v.id("knowledgeDocuments"),
    processingToken: v.string(),
    ragEntryId: v.string(),
    replacedRagEntryId: v.union(v.null(), v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const document = await ctx.db.get("knowledgeDocuments", args.documentId);
    if (!document) {
      return null;
    }
    await commitReadyEntry(
      ctx,
      document,
      args.processingToken,
      args.ragEntryId,
      args.replacedRagEntryId,
    );
    return null;
  },
});

export const ragOnComplete = knowledgeRag.defineOnComplete<DataModel>(
  async (ctx, args) => {
    const metadata = args.entry.metadata;
    const documentId = metadata
      ? ctx.db.normalizeId(
          "knowledgeDocuments",
          metadata.knowledgeDocumentId,
        )
      : null;
    if (!metadata || !documentId) {
      await deleteRagEntryIfPresent(ctx, args.entry.entryId);
      return;
    }
    const document = await ctx.db.get("knowledgeDocuments", documentId);
    if (!document) {
      await deleteRagEntryIfPresent(ctx, args.entry.entryId);
      return;
    }
    const metadataIsValid =
      metadata.workspaceId === String(document.workspaceId) &&
      metadata.stableKey === document.stableKey &&
      metadata.version === document.version &&
      args.namespace.namespace === knowledgeNamespace(document.workspaceId) &&
      metadata.processingToken === document.processingToken;
    if (!metadataIsValid) {
      await deleteRagEntryIfPresent(ctx, args.entry.entryId);
      await failProcessing(ctx, document, {
        processingToken: metadata.processingToken,
        errorCode: "INGESTION_STATE_MISMATCH",
        errorMessage: "Document processing state did not match the indexed entry.",
        retryable: false,
      });
      return;
    }
    if (document.status === "deleting") {
      await deleteRagEntryIfPresent(ctx, args.entry.entryId);
      await ensureCleanupScheduled(ctx, document);
      return;
    }
    if (args.error) {
      await deleteRagEntryIfPresent(ctx, args.entry.entryId);
      await failProcessing(ctx, document, {
        processingToken: metadata.processingToken,
        errorCode: "EMBEDDING_FAILED",
        errorMessage: "The document could not be embedded. You can retry it.",
        retryable: true,
      });
      return;
    }
    if (args.entry.status !== "ready") {
      await deleteRagEntryIfPresent(ctx, args.entry.entryId);
      await failProcessing(ctx, document, {
        processingToken: metadata.processingToken,
        errorCode: "INGESTION_SUPERSEDED",
        errorMessage: "This processing attempt was superseded by a newer version.",
        retryable: false,
      });
      return;
    }
    await commitReadyEntry(
      ctx,
      document,
      metadata.processingToken,
      args.entry.entryId,
      args.replacedEntry?.entryId ?? null,
    );
  },
);

export const cleanupStorage = internalMutation({
  args: {
    documentId: v.id("knowledgeDocuments"),
    storageId: v.id("_storage"),
    cleanupToken: v.string(),
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const document = await ctx.db.get("knowledgeDocuments", args.documentId);
    if (
      !document ||
      document.storageId !== args.storageId ||
      document.status !== "deleting" ||
      document.cleanupToken !== args.cleanupToken ||
      (document.cleanupAttempt ?? 0) !== args.attempt
    ) {
      return null;
    }
    await runCleanupAttempt(args.attempt, {
      deleteStorage: async () => await ctx.storage.delete(args.storageId),
      deleteDocument: async () =>
        await ctx.db.delete("knowledgeDocuments", document._id),
      recordFailure: async ({ nextAttempt, exhausted }) => {
        await ctx.db.patch("knowledgeDocuments", document._id, {
          cleanupAttempt: nextAttempt,
          errorCode: exhausted
            ? "STORAGE_CLEANUP_RETRY_EXHAUSTED"
            : "STORAGE_CLEANUP_FAILED",
          errorMessage: exhausted
            ? "Storage cleanup needs another manual delete attempt."
            : "Storage cleanup will retry automatically.",
          updatedAt: Date.now(),
        });
      },
      scheduleRetry: async ({ nextAttempt, delayMs }) =>
        await scheduleCleanup(
          ctx,
          document,
          args.cleanupToken,
          nextAttempt,
          delayMs,
        ),
    });
    return null;
  },
});
