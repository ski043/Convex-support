import type { Id } from "./_generated/dataModel";
import {
  MAX_MIRROR_BATCHES_PER_RUN,
  MAX_PROVIDER_ATTEMPTS,
  buildGroundingInstructions,
  classifyProviderFailure,
  isGreeting,
  normalizeRetrievedEvidence,
  requestsHuman,
  retryDelayMs,
  type CandidateAnswer,
  type GroundedAnswerSegment,
  type RetrievedEvidence,
  validateCandidateAnswer,
} from "./aiModel";

export type RunPreflight = {
  runId: Id<"aiRuns">;
  workspaceId: Id<"workspaces">;
  conversationId: Id<"conversations">;
  triggerMessageId: Id<"messages">;
  triggerBody: string;
  epoch: number;
  attempt: number;
  status: "queued" | "running";
  agentThreadId?: string;
  errorCode?: string;
};

export type SyncResult =
  | { status: "stale" }
  | { status: "more"; syncedThroughSequence: number }
  | {
      status: "ready";
      threadId: string;
      promptMessageId: string;
      syncedThroughSequence: number;
    };

export type ClaimResult =
  | { status: "claimed"; attempt: number }
  | { status: "busy" }
  | { status: "stale" }
  | { status: "exhausted" };

export type CommitResult =
  | { status: "accepted"; messageId: Id<"messages"> }
  | { status: "stale" | "invalid_evidence" };

export type KnowledgeSearchResult = { results: RetrievedEvidence[] };

export type GenerationRequest = {
  runId: Id<"aiRuns">;
  attempt: number;
  threadId: string;
  promptMessageId: string;
  instructions: string;
};

export type HandoffRequest = {
  runId: Id<"aiRuns">;
  reason: string;
  errorCode?: string;
  errorMessage?: string;
};

export type ResponderDependencies = {
  enforceRunKillSwitch: (runId: Id<"aiRuns">) => Promise<boolean>;
  getRunPreflight: (
    runId: Id<"aiRuns">,
  ) => Promise<RunPreflight | null>;
  syncNextBatch: (runId: Id<"aiRuns">) => Promise<SyncResult>;
  searchReadyKnowledge: (
    preflight: RunPreflight,
  ) => Promise<KnowledgeSearchResult>;
  claimAttempt: (
    runId: Id<"aiRuns">,
    expectedAttempt: number,
  ) => Promise<ClaimResult>;
  prepareRetry: (args: {
    runId: Id<"aiRuns">;
    attempt: number;
    errorCode: string;
    errorMessage: string;
  }) => Promise<boolean>;
  generateCandidate: (request: GenerationRequest) => Promise<CandidateAnswer>;
  commitCandidate: (args: {
    runId: Id<"aiRuns">;
    attempt: number;
    segments: GroundedAnswerSegment[];
    evidence: RetrievedEvidence[];
  }) => Promise<CommitResult>;
  handoff: (request: HandoffRequest) => Promise<void>;
  delay: (ms: number) => Promise<void>;
};

const KNOWLEDGE_SEARCH_ATTEMPTS = 2;

async function handoff(
  dependencies: ResponderDependencies,
  runId: Id<"aiRuns">,
  reason: string,
  errorCode?: string,
  errorMessage?: string,
) {
  await dependencies.handoff({
    runId,
    reason,
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(errorMessage === undefined ? {} : { errorMessage }),
  });
}

async function searchKnowledge(
  dependencies: ResponderDependencies,
  preflight: RunPreflight,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= KNOWLEDGE_SEARCH_ATTEMPTS; attempt += 1) {
    try {
      return await dependencies.searchReadyKnowledge(preflight);
    } catch (error) {
      lastError = error;
      if (attempt < KNOWLEDGE_SEARCH_ATTEMPTS) {
        await dependencies.delay(retryDelayMs(attempt));
      }
    }
  }
  throw lastError;
}

/**
 * Pure orchestration seam for deterministic failure-path tests. All external
 * effects stay behind dependencies; the registered action supplies the real
 * Convex, Agent, and Gateway adapters.
 */
export async function runResponderOrchestration(
  runId: Id<"aiRuns">,
  dependencies: ResponderDependencies,
) {
  if (!(await dependencies.enforceRunKillSwitch(runId))) {
    return;
  }
  let preflight = await dependencies.getRunPreflight(runId);
  if (!preflight || preflight.status === "running") {
    return;
  }

  let synchronized: Extract<SyncResult, { status: "ready" }> | null = null;
  for (let batch = 0; batch < MAX_MIRROR_BATCHES_PER_RUN; batch += 1) {
    const sync = await dependencies.syncNextBatch(runId);
    if (sync.status === "stale") {
      return;
    }
    if (sync.status === "ready") {
      synchronized = sync;
      break;
    }
  }
  if (!synchronized) {
    await handoff(
      dependencies,
      runId,
      "history_sync_limit",
      "history_sync_limit",
      "The conversation history is too large to synchronize safely.",
    );
    return;
  }

  preflight = await dependencies.getRunPreflight(runId);
  if (!preflight || preflight.status === "running") {
    return;
  }
  if (requestsHuman(preflight.triggerBody)) {
    await handoff(dependencies, runId, "human_requested");
    return;
  }
  if (isGreeting(preflight.triggerBody)) {
    await handoff(dependencies, runId, "greeting");
    return;
  }
  if (preflight.errorCode?.startsWith("limit_")) {
    await handoff(
      dependencies,
      runId,
      preflight.errorCode,
      preflight.errorCode,
      "Automatic answering is temporarily limited.",
    );
    return;
  }

  let searchResult: KnowledgeSearchResult;
  try {
    searchResult = await searchKnowledge(dependencies, preflight);
  } catch {
    await handoff(
      dependencies,
      runId,
      "knowledge_search_failed",
      "knowledge_search_failed",
      "Workspace knowledge could not be searched.",
    );
    return;
  }
  const evidence = normalizeRetrievedEvidence(searchResult.results);
  if (evidence.length === 0) {
    await handoff(dependencies, runId, "no_ready_or_relevant_knowledge");
    return;
  }

  const expectedAttempt = preflight.attempt;
  if (expectedAttempt >= MAX_PROVIDER_ATTEMPTS) {
    await handoff(
      dependencies,
      runId,
      "provider_retry_exhausted",
      "provider_retry_exhausted",
      "The answer provider retry budget was exhausted.",
    );
    return;
  }

  const claim = await dependencies.claimAttempt(runId, expectedAttempt);
  if (claim.status === "busy" || claim.status === "stale") {
    return;
  }
  if (claim.status === "exhausted") {
    await handoff(
      dependencies,
      runId,
      "provider_retry_exhausted",
      "provider_retry_exhausted",
      "The answer provider retry budget was exhausted.",
    );
    return;
  }

  const attempt = claim.attempt;
  try {
    const candidate = validateCandidateAnswer(
      await dependencies.generateCandidate({
        runId,
        attempt,
        threadId: synchronized.threadId,
        promptMessageId: synchronized.promptMessageId,
        instructions: buildGroundingInstructions(evidence),
      }),
      evidence,
    );
    if (!candidate.ok) {
      await handoff(
        dependencies,
        runId,
        candidate.reason,
        candidate.reason,
        "The generated answer did not pass evidence validation.",
      );
      return;
    }

    const committed = await dependencies.commitCandidate({
      runId,
      attempt,
      segments: candidate.segments,
      evidence: candidate.evidence,
    });
    if (committed.status === "invalid_evidence") {
      await handoff(
        dependencies,
        runId,
        "invalid_citation",
        "invalid_citation",
        "Retrieved citations were no longer valid at commit time.",
      );
    }
  } catch (error) {
    const failure = classifyProviderFailure(error);
    if (failure.retryable && attempt < MAX_PROVIDER_ATTEMPTS) {
      const prepared = await dependencies.prepareRetry({
        runId,
        attempt,
        errorCode: failure.code,
        errorMessage: failure.safeMessage,
      });
      if (!prepared) {
        return;
      }
      // prepareRetry transactionally schedules the next responder action.
      // Return so durability never depends on this at-most-once action.
      return;
    }
    await handoff(
      dependencies,
      runId,
      failure.retryable ? "provider_retry_exhausted" : failure.code,
      failure.code,
      failure.safeMessage,
    );
    return;
  }
}
