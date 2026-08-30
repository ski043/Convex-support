import {
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalQuery } from "./_generated/server";
import { EVIDENCE_VECTOR_SCORE_THRESHOLD } from "./aiModel";
import { knowledgeError, knowledgeNamespace } from "./knowledgeModel";
import {
  knowledgeRag,
  requireEmbeddingConfiguration,
} from "./knowledgeRag";

type ReadyDocument = {
  knowledgeDocumentId: Id<"knowledgeDocuments">;
  ragEntryId: string;
  documentTitle: string;
};

type CitationResult = {
  citationId: string;
  knowledgeDocumentId: Id<"knowledgeDocuments">;
  ragEntryId: string;
  chunkOrder: number;
  documentTitle: string;
  pageNumber?: number;
  heading?: string;
  excerpt: string;
  score: number;
};

const getReadyDocumentsReference = makeFunctionReference<
  "query",
  { workspaceId: Id<"workspaces">; ragEntryIds: string[] },
  ReadyDocument[]
>("knowledgeInternal:getReadyDocumentsByRagIds") as unknown as FunctionReference<
  "query",
  "internal",
  { workspaceId: Id<"workspaces">; ragEntryIds: string[] },
  ReadyDocument[]
>;

const citationResultValidator = v.object({
  citationId: v.string(),
  knowledgeDocumentId: v.id("knowledgeDocuments"),
  ragEntryId: v.string(),
  chunkOrder: v.number(),
  documentTitle: v.string(),
  pageNumber: v.optional(v.number()),
  heading: v.optional(v.string()),
  excerpt: v.string(),
  score: v.number(),
});

export const getReadyDocumentsByRagIds = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    ragEntryIds: v.array(v.string()),
  },
  returns: v.array(
    v.object({
      knowledgeDocumentId: v.id("knowledgeDocuments"),
      ragEntryId: v.string(),
      documentTitle: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    if (args.ragEntryIds.length > 20) {
      throw knowledgeError("INVALID_SEARCH", "Too many evidence entries requested.");
    }
    const documents: ReadyDocument[] = [];
    for (const ragEntryId of new Set(args.ragEntryIds)) {
      const candidates = await ctx.db
        .query("knowledgeDocuments")
        .withIndex("by_ragEntryId", (q) => q.eq("ragEntryId", ragEntryId))
        .take(10);
      const ready = candidates.find(
        (document) =>
          document.workspaceId === args.workspaceId &&
          document.status === "ready" &&
          document.ragEntryId === ragEntryId,
      );
      if (ready) {
        documents.push({
          knowledgeDocumentId: ready._id,
          ragEntryId,
          documentTitle: ready.title,
        });
      }
    }
    return documents;
  },
});

function metadataPageNumber(metadata: Record<string, unknown> | undefined) {
  const value = metadata?.pageNumber;
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function metadataHeading(metadata: Record<string, unknown> | undefined) {
  const value = metadata?.heading;
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 200)
    : undefined;
}

function evidenceExcerpt(content: Array<{ text: string }>) {
  return content
    .map((chunk) => chunk.text)
    .join("\n\n")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_200);
}

export const searchReadyForAi = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    query: v.string(),
    limit: v.number(),
  },
  returns: v.object({ results: v.array(citationResultValidator) }),
  handler: async (ctx, args) => {
    const normalizedQuery = args.query.trim();
    if (!normalizedQuery || normalizedQuery.length > 4_000) {
      throw knowledgeError(
        "INVALID_SEARCH",
        "Knowledge search text must be between 1 and 4000 characters.",
      );
    }
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 20) {
      throw knowledgeError(
        "INVALID_SEARCH",
        "Knowledge search limit must be an integer between 1 and 20.",
      );
    }

    requireEmbeddingConfiguration();
    const search = await knowledgeRag.search(ctx, {
      namespace: knowledgeNamespace(args.workspaceId),
      query: normalizedQuery,
      limit: args.limit,
      chunkContext: { before: 0, after: 0 },
      searchType: "hybrid",
      vectorScoreThreshold: EVIDENCE_VECTOR_SCORE_THRESHOLD,
    });
    if (search.results.length === 0) return { results: [] };

    const readyDocuments = await ctx.runQuery(getReadyDocumentsReference, {
      workspaceId: args.workspaceId,
      ragEntryIds: search.results.map((result) => result.entryId),
    });
    const byRagEntryId = new Map(
      readyDocuments.map((document) => [document.ragEntryId, document]),
    );
    const results: CitationResult[] = [];
    for (const result of search.results) {
      const document = byRagEntryId.get(result.entryId);
      if (!document) continue;
      const excerpt = evidenceExcerpt(result.content);
      if (!excerpt) continue;
      const metadata = result.content.find((chunk) => chunk.metadata)?.metadata as
        | Record<string, unknown>
        | undefined;
      const pageNumber = metadataPageNumber(metadata);
      const heading = metadataHeading(metadata);
      results.push({
        citationId: `${result.entryId}:${result.order}`,
        knowledgeDocumentId: document.knowledgeDocumentId,
        ragEntryId: result.entryId,
        chunkOrder: result.order,
        documentTitle: document.documentTitle,
        ...(pageNumber === undefined ? {} : { pageNumber }),
        ...(heading === undefined ? {} : { heading }),
        excerpt,
        score: Number.isFinite(result.score) ? result.score : 0,
      });
      if (results.length >= args.limit) break;
    }
    return { results };
  },
});
