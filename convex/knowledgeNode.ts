"use node";

import { isRateLimitError } from "@convex-dev/rate-limiter";
import type { OnComplete } from "@convex-dev/rag";
import {
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { extractKnowledgeChunks } from "./knowledgeExtract";
import {
  classifyProcessingFailure,
  KnowledgeProcessingError,
  knowledgeNamespace,
} from "./knowledgeModel";
import {
  knowledgeRag,
  requireEmbeddingConfiguration,
} from "./knowledgeRag";

type ProcessingDocument = {
  documentId: Id<"knowledgeDocuments">;
  workspaceId: Id<"workspaces">;
  storageId: Id<"_storage">;
  filename: string;
  title: string;
  mimeType: string;
  fileKind: "pdf" | "markdown" | "text";
  size: number;
  sha256: string;
  stableKey: string;
  version: number;
  replacesDocumentId?: Id<"knowledgeDocuments">;
  processingToken: string;
};

export function knowledgeRagKey(
  document: Pick<
    ProcessingDocument,
    "stableKey" | "version" | "replacesDocumentId"
  >,
) {
  return document.replacesDocumentId
    ? `${document.stableKey}:version:${document.version}`
    : document.stableKey;
}

const beginProcessingReference = makeFunctionReference<
  "mutation",
  { documentId: Id<"knowledgeDocuments"> },
  ProcessingDocument | null
>("knowledge:beginProcessing") as unknown as FunctionReference<
  "mutation",
  "internal",
  { documentId: Id<"knowledgeDocuments"> },
  ProcessingDocument | null
>;

const deferProcessingReference = makeFunctionReference<
  "mutation",
  { documentId: Id<"knowledgeDocuments">; retryAfter: number },
  null
>("knowledge:deferProcessing") as unknown as FunctionReference<
  "mutation",
  "internal",
  { documentId: Id<"knowledgeDocuments">; retryAfter: number },
  null
>;

const handleProcessingFailureReference = makeFunctionReference<
  "mutation",
  {
    documentId: Id<"knowledgeDocuments">;
    processingToken: string;
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
  },
  null
>("knowledge:handleProcessingFailure") as unknown as FunctionReference<
  "mutation",
  "internal",
  {
    documentId: Id<"knowledgeDocuments">;
    processingToken: string;
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
  },
  null
>;

const completeExistingEntryReference = makeFunctionReference<
  "mutation",
  {
    documentId: Id<"knowledgeDocuments">;
    processingToken: string;
    ragEntryId: string;
    replacedRagEntryId: string | null;
  },
  null
>("knowledge:completeExistingEntry") as unknown as FunctionReference<
  "mutation",
  "internal",
  {
    documentId: Id<"knowledgeDocuments">;
    processingToken: string;
    ragEntryId: string;
    replacedRagEntryId: string | null;
  },
  null
>;

const ragOnCompleteReference = makeFunctionReference<"mutation">(
  "knowledge:ragOnComplete",
) as unknown as OnComplete;

function rateLimitRetryAfter(error: unknown) {
  if (isRateLimitError(error)) return error.data.retryAfter;
  if (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof error.data === "object" &&
    error.data !== null &&
    "kind" in error.data &&
    error.data.kind === "RateLimited" &&
    "retryAfter" in error.data &&
    typeof error.data.retryAfter === "number"
  ) {
    return error.data.retryAfter;
  }
  return null;
}

export async function matchesStoredSha256(
  bytes: Uint8Array,
  expectedSha256: string,
) {
  const ownedBytes = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", ownedBytes.buffer);
  const digestBytes = new Uint8Array(digest);
  const hex = Array.from(digestBytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const base64 = Buffer.from(digestBytes).toString("base64");

  // Convex documents `_storage.sha256` as hex, while hosted deployments can
  // currently return the same digest as padded Base64. Registration persists
  // Convex's value verbatim, so processing must accept both representations.
  return expectedSha256 === hex || expectedSha256 === base64;
}

export const processDocument = internalAction({
  args: { documentId: v.id("knowledgeDocuments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    let document: ProcessingDocument | null;
    try {
      document = await ctx.runMutation(beginProcessingReference, args);
    } catch (error) {
      const retryAfter = rateLimitRetryAfter(error);
      if (retryAfter === null) throw error;
      await ctx.runMutation(deferProcessingReference, {
        documentId: args.documentId,
        retryAfter,
      });
      return null;
    }
    if (!document) return null;

    try {
      requireEmbeddingConfiguration();
      const blob = await ctx.storage.get(document.storageId);
      if (!blob) {
        throw new KnowledgeProcessingError(
          "STORED_FILE_MISSING",
          "The uploaded file is no longer available. Upload it again.",
        );
      }
      if (blob.size !== document.size) {
        throw new KnowledgeProcessingError(
          "FILE_CONTENT_MISMATCH",
          "The stored file size no longer matches its registered metadata.",
        );
      }
      const actualMimeType = blob.type.split(";", 1)[0]?.trim().toLowerCase();
      if (actualMimeType !== document.mimeType) {
        throw new KnowledgeProcessingError(
          "FILE_CONTENT_MISMATCH",
          "The stored file content type no longer matches its registered metadata.",
        );
      }

      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (!(await matchesStoredSha256(bytes, document.sha256))) {
        throw new KnowledgeProcessingError(
          "FILE_CONTENT_MISMATCH",
          "The stored file hash no longer matches its registered metadata.",
        );
      }
      const chunks = await extractKnowledgeChunks(document.fileKind, bytes);
      const result = await knowledgeRag.add(ctx, {
        namespace: knowledgeNamespace(document.workspaceId),
        // A replacement must not reuse the live version's RAG key: RAG swaps
        // matching keys before onComplete, which would create a search gap if
        // this processing lease then went stale.
        key: knowledgeRagKey(document),
        title: document.title,
        contentHash: document.sha256,
        metadata: {
          knowledgeDocumentId: String(document.documentId),
          workspaceId: String(document.workspaceId),
          stableKey: document.stableKey,
          version: document.version,
          processingToken: document.processingToken,
        },
        chunks,
        onComplete: ragOnCompleteReference,
      });

      // Deduplication by stable key + content hash does not invoke onComplete.
      if (result.status === "ready" && !result.created) {
        await ctx.runMutation(completeExistingEntryReference, {
          documentId: document.documentId,
          processingToken: document.processingToken,
          ragEntryId: result.entryId,
          replacedRagEntryId: result.replacedEntry?.entryId ?? null,
        });
      }
    } catch (error) {
      const failure = classifyProcessingFailure(error);
      await ctx.runMutation(handleProcessingFailureReference, {
        documentId: document.documentId,
        processingToken: document.processingToken,
        errorCode: failure.code,
        errorMessage: failure.message,
        retryable: failure.retryable,
      });
    }
    return null;
  },
});
