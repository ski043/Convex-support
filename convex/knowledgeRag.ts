import { createOpenAI } from "@ai-sdk/openai";
import { RAG } from "@convex-dev/rag";
import { components } from "./_generated/api";
import { env } from "./_generated/server";
import { KnowledgeProcessingError } from "./knowledgeModel";

export const KNOWLEDGE_EMBEDDING_MODEL = "text-embedding-3-small" as const;
export const KNOWLEDGE_EMBEDDING_DIMENSION = 1_536;

export type KnowledgeEntryMetadata = {
  knowledgeDocumentId: string;
  workspaceId: string;
  stableKey: string;
  version: number;
  processingToken: string;
};

// A placeholder is used only to make callback-only modules safe to initialize.
// Every action that can embed or search calls requireEmbeddingConfiguration
// before the model can make a request.
const openai = createOpenAI({
  apiKey: env.OPENAI_API_KEY ?? "missing-openai-api-key",
});

export const knowledgeRag = new RAG<
  Record<never, never>,
  KnowledgeEntryMetadata
>(components.rag, {
  textEmbeddingModel: openai.embedding(KNOWLEDGE_EMBEDDING_MODEL),
  embeddingDimension: KNOWLEDGE_EMBEDDING_DIMENSION,
});

export function requireEmbeddingConfiguration() {
  if (!env.OPENAI_API_KEY) {
    throw new KnowledgeProcessingError(
      "EMBEDDING_NOT_CONFIGURED",
      "Knowledge search is not configured because OPENAI_API_KEY is missing.",
    );
  }
}
