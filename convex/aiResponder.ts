"use node";

import { makeFunctionReference } from "convex/server";
import { tool } from "ai";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { createRunAgent } from "./aiAgent";
import {
  ANSWER_REASONING_EFFORT,
  PROVIDER_TIMEOUT_MS,
  candidateAnswerSchema,
  type GroundedAnswerSegment,
  type RetrievedEvidence,
} from "./aiModel";
import {
  runResponderOrchestration,
  type ClaimResult,
  type CommitResult,
  type KnowledgeSearchResult,
  type RunPreflight,
  type SyncResult,
} from "./aiResponderOrchestration";

const getRunPreflightReference = makeFunctionReference<
  "mutation",
  { runId: Id<"aiRuns"> },
  RunPreflight | null
>("aiAutomation:getRunPreflight");

const enforceRunKillSwitchReference = makeFunctionReference<
  "mutation",
  { runId: Id<"aiRuns"> },
  boolean
>("aiAutomation:enforceRunKillSwitch");

const syncNextBatchReference = makeFunctionReference<
  "mutation",
  { runId: Id<"aiRuns"> },
  SyncResult
>("aiAutomation:syncNextBatch");

const claimAttemptReference = makeFunctionReference<
  "mutation",
  { runId: Id<"aiRuns">; expectedAttempt: number },
  ClaimResult
>("aiAutomation:claimAttempt");

const prepareRetryReference = makeFunctionReference<
  "mutation",
  {
    runId: Id<"aiRuns">;
    attempt: number;
    errorCode: string;
    errorMessage: string;
  },
  boolean
>("aiAutomation:prepareRetry");

const commitCandidateReference = makeFunctionReference<
  "mutation",
  {
    runId: Id<"aiRuns">;
    attempt: number;
    segments: GroundedAnswerSegment[];
    evidence: RetrievedEvidence[];
  },
  CommitResult
>("aiAutomation:commitCandidate");

const handoffRunReference = makeFunctionReference<
  "mutation",
  {
    runId: Id<"aiRuns">;
    reason: string;
    errorCode?: string;
    errorMessage?: string;
  },
  | { status: "handed_off"; messageId: Id<"messages"> }
  | {
      status: "responded";
      messageId: Id<"messages">;
      consecutiveFailures: number;
    }
  | { status: "stale" }
>("aiAutomation:handoffRun");

/**
 * Isolated knowledge adapter contract. The knowledge workstream owns this
 * internal action and must derive the RAG namespace from workspaceId.
 */
const searchReadyKnowledgeReference = makeFunctionReference<
  "action",
  { workspaceId: Id<"workspaces">; query: string; limit: number },
  KnowledgeSearchResult
>("knowledgeInternal:searchReadyForAi");

const submitGroundedAnswer = tool({
  description:
    "Submit the final extractive support answer with an exact evidence quote and citation for every segment.",
  inputSchema: candidateAnswerSchema,
  strict: true,
});

function malformedToolSubmission(message: string) {
  const error = new Error(message);
  error.name = "NoObjectGeneratedError";
  return error;
}

export const run = internalAction({
  args: { runId: v.id("aiRuns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await runResponderOrchestration(args.runId, {
      enforceRunKillSwitch: async (runId) =>
        await ctx.runMutation(enforceRunKillSwitchReference, { runId }),
      getRunPreflight: async (runId) =>
        await ctx.runMutation(getRunPreflightReference, { runId }),
      syncNextBatch: async (runId) =>
        await ctx.runMutation(syncNextBatchReference, { runId }),
      searchReadyKnowledge: async (preflight) =>
        await ctx.runAction(searchReadyKnowledgeReference, {
          workspaceId: preflight.workspaceId,
          query: preflight.triggerBody,
          limit: 10,
        }),
      claimAttempt: async (runId, expectedAttempt) =>
        await ctx.runMutation(claimAttemptReference, {
          runId,
          expectedAttempt,
        }),
      prepareRetry: async (retry) =>
        await ctx.runMutation(prepareRetryReference, retry),
      generateCandidate: async (request) => {
        const agent = createRunAgent(request.runId, request.attempt);
        const result = await agent.generateText(
          ctx,
          { threadId: request.threadId },
          {
            promptMessageId: request.promptMessageId,
            instructions: request.instructions,
            tools: { submitGroundedAnswer },
            toolChoice: {
              type: "tool",
              toolName: "submitGroundedAnswer",
            },
            providerOptions: {
              convexGateway: {
                reasoningEffort: ANSWER_REASONING_EFFORT,
                strictJsonSchema: true,
              },
            },
            maxRetries: 0,
            maxOutputTokens: 1_600,
            abortSignal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
          },
          {
            contextOptions: { recentMessages: 100 },
            storageOptions: { saveMessages: "none" },
          },
        );
        const submission = result.toolCalls.find(
          (call) => call.toolName === "submitGroundedAnswer",
        );
        if (!submission) {
          throw malformedToolSubmission(
            "The answer provider did not submit a grounded answer.",
          );
        }
        const parsed = candidateAnswerSchema.safeParse(submission.input);
        if (!parsed.success) {
          throw malformedToolSubmission(
            "The answer provider submission did not match schema.",
          );
        }
        return parsed.data;
      },
      commitCandidate: async (candidate) =>
        await ctx.runMutation(commitCandidateReference, candidate),
      handoff: async (request) => {
        await ctx.runMutation(handoffRunReference, request);
      },
      delay: async (ms) =>
        await new Promise<void>((resolve) => setTimeout(resolve, ms)),
    });
    return null;
  },
});
