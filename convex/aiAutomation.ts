import { DAY, HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  env,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  ensureAgentThread,
  mirrorCanonicalMessage,
} from "./aiAgent";
import {
  ANSWER_MODEL,
  MAX_QUEUED_DISPATCH_RECOVERIES,
  MAX_GROUNDED_SEGMENT_LENGTH,
  MAX_GROUNDED_SEGMENTS,
  MAX_MIRROR_BATCH_SIZE,
  MAX_PROVIDER_ATTEMPTS,
  QUEUED_DISPATCH_RECOVERY_DELAY_MS,
  RUN_RECOVERY_DELAY_MS,
  containsPromptInjection,
  groundedAnswerSegmentValidator,
  normalizeGroundedText,
  normalizeRetrievedEvidence,
  retrievedEvidenceValidator,
  retryDelayMs,
  type RetrievedEvidence,
} from "./aiModel";
import { chatError } from "./chatModel";
import { requireOwnedConversation, requireOwnerWorkspace } from "./chatOwner";

const runResponderReference = makeFunctionReference<
  "action",
  { runId: Id<"aiRuns"> },
  null
>("aiResponder:run");

const recoverRunReference = makeFunctionReference<
  "mutation",
  { runId: Id<"aiRuns">; attempt: number },
  null
>("aiAutomation:recoverRun");

const recoverQueuedDispatchReference = makeFunctionReference<
  "mutation",
  {
    runId: Id<"aiRuns">;
    epoch: number;
    expectedAttempt: number;
    expectedRecoveryCount: number;
  },
  null
>("aiAutomation:recoverQueuedDispatch");

const reconcileMirrorsReference = makeFunctionReference<
  "mutation",
  { conversationId: Id<"conversations">; throughSequence: number },
  null
>("aiAutomation:reconcileMirrors");

const invalidateDisabledWorkspaceRunsReference = makeFunctionReference<
  "mutation",
  {
    workspaceId: Id<"workspaces">;
    status: "queued" | "running";
  },
  null
>("aiAutomation:invalidateDisabledWorkspaceRuns");

const invalidateDisabledWorkspaceStatesReference = makeFunctionReference<
  "mutation",
  { workspaceId: Id<"workspaces"> },
  null
>("aiAutomation:invalidateDisabledWorkspaceStates");

const LEGACY_DEFAULT_HANDOFF_MESSAGE =
  "I’m not confident I can answer that from the available information. A human will continue here.";
const DEFAULT_HANDOFF_MESSAGE =
  "I’m sorry, I still can’t help with that. Let me connect you to a human.";
const RETRY_MESSAGE =
  "I couldn’t find a confident answer yet. Could you rephrase that or add a little more detail?";
const GREETING_MESSAGE = "Hi! How can I help?";
const MAX_CONSECUTIVE_AI_FAILURES = 3;
const RETRYABLE_HANDOFF_REASONS = new Set([
  "no_ready_or_relevant_knowledge",
  "model_declined",
  "empty_answer",
  "answer_too_long",
  "missing_citation",
  "invalid_citation",
  "missing_supporting_quote",
  "invalid_supporting_quote",
  "ungrounded_segment",
  "unsafe_supporting_quote",
  "malformed_output",
]);

const MAX_WORKSPACE_CONCURRENT_RUNS = 4;
const DAILY_WORKSPACE_TOKEN_CEILING = 2_000_000;
const MONTHLY_WORKSPACE_TOKEN_CEILING = 20_000_000;
const RESERVED_TOKENS_PER_GENERATION = 8_000;
const DISABLE_INVALIDATION_BATCH_SIZE = 25;

async function scheduleQueuedResponder(
  ctx: MutationCtx,
  args: {
    runId: Id<"aiRuns">;
    epoch: number;
    expectedAttempt: number;
    expectedRecoveryCount: number;
    actionDelayMs: number;
  },
) {
  await ctx.scheduler.runAfter(args.actionDelayMs, runResponderReference, {
    runId: args.runId,
  });
  await ctx.scheduler.runAfter(
    args.actionDelayMs + QUEUED_DISPATCH_RECOVERY_DELAY_MS,
    recoverQueuedDispatchReference,
    {
      runId: args.runId,
      epoch: args.epoch,
      expectedAttempt: args.expectedAttempt,
      expectedRecoveryCount: args.expectedRecoveryCount,
    },
  );
}

const generationRateLimiter = new RateLimiter(components.rateLimiter, {
  aiWorkspaceGenerationRequests: {
    kind: "fixed window",
    rate: 60,
    period: HOUR,
  },
  aiGlobalGenerationRequests: {
    kind: "token bucket",
    rate: 1_000,
    period: HOUR,
    capacity: 1_000,
    shards: 10,
  },
  aiWorkspaceTokenReservations: {
    kind: "fixed window",
    rate: DAILY_WORKSPACE_TOKEN_CEILING,
    period: DAY,
    capacity: DAILY_WORKSPACE_TOKEN_CEILING,
  },
});

function isGloballyEnabled() {
  return env.AI_AUTOMATION_ENABLED !== "false";
}

function resolvedHandoffMessage(message: string | undefined) {
  if (!message || message === LEGACY_DEFAULT_HANDOFF_MESSAGE) {
    return DEFAULT_HANDOFF_MESSAGE;
  }
  return message;
}

async function effectiveAiSettings(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
) {
  const settings = await ctx.db
    .query("workspaceAiSettings")
    .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
    .unique();
  return {
    configured: settings !== null,
    enabled: Boolean(settings?.enabled && isGloballyEnabled()),
    handoffMessage: resolvedHandoffMessage(settings?.handoffMessage),
  };
}

async function getOrCreateConversationState(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  now: number,
) {
  const existing = await ctx.db
    .query("aiConversationStates")
    .withIndex("by_conversationId", (q) =>
      q.eq("conversationId", conversation._id),
    )
    .unique();
  if (existing) {
    if (existing.workspaceId !== conversation.workspaceId) {
      throw new Error("Conversation automation workspace is inconsistent.");
    }
    return existing;
  }

  const settings = await effectiveAiSettings(ctx, conversation.workspaceId);
  const stateId = await ctx.db.insert("aiConversationStates", {
    workspaceId: conversation.workspaceId,
    conversationId: conversation._id,
    mode: settings.enabled ? "ai" : "disabled",
    attention: settings.enabled ? "none" : "needs_human",
    generationEpoch: 0,
    consecutiveAiFailures: 0,
    syncedThroughSequence: 0,
    createdAt: now,
    updatedAt: now,
  });
  const state = await ctx.db.get("aiConversationStates", stateId);
  if (!state) {
    throw new Error("Conversation automation state could not be created.");
  }
  return state;
}

async function discardActiveRun(
  ctx: MutationCtx,
  state: Doc<"aiConversationStates">,
  now: number,
  code: string,
) {
  if (!state.activeRunId) {
    return;
  }
  const active = await ctx.db.get("aiRuns", state.activeRunId);
  if (
    active &&
    active.conversationId === state.conversationId &&
    (active.status === "queued" || active.status === "running")
  ) {
    await ctx.db.patch("aiRuns", active._id, {
      status: "discarded",
      errorCode: code,
      errorMessage: "The run was superseded by newer conversation state.",
      finishedAt: now,
      updatedAt: now,
    });
  }
}

async function transitionActiveRunToDisabled(
  ctx: MutationCtx,
  run: Doc<"aiRuns">,
  state: Doc<"aiConversationStates"> | null,
  now: number,
  errorMessage: string,
) {
  if (run.status === "queued" || run.status === "running") {
    await ctx.db.patch("aiRuns", run._id, {
      status: "discarded",
      errorCode: "automation_disabled",
      errorMessage,
      finishedAt: now,
      updatedAt: now,
    });
  }
  if (
    state &&
    state.activeRunId === run._id &&
    state.generationEpoch === run.epoch
  ) {
    await ctx.db.patch("aiConversationStates", state._id, {
      mode: "disabled",
      attention: "needs_human",
      generationEpoch: state.generationEpoch + 1,
      activeRunId: undefined,
      handoffReason: "automation_disabled",
      updatedAt: now,
    });
  }
}

async function invalidateDisabledWorkspaceRunBatch(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  status: "queued" | "running",
) {
  const runs = await ctx.db
    .query("aiRuns")
    .withIndex("by_workspaceId_and_status", (q) =>
      q.eq("workspaceId", workspaceId).eq("status", status),
    )
    .take(DISABLE_INVALIDATION_BATCH_SIZE);
  const now = Date.now();
  for (const run of runs) {
    const state = await ctx.db
      .query("aiConversationStates")
      .withIndex("by_conversationId", (q) =>
        q.eq("conversationId", run.conversationId),
      )
      .unique();
    await transitionActiveRunToDisabled(
      ctx,
      run,
      state,
      now,
      "AI automation was disabled for this workspace.",
    );
  }
  if (runs.length === DISABLE_INVALIDATION_BATCH_SIZE) {
    await ctx.scheduler.runAfter(0, invalidateDisabledWorkspaceRunsReference, {
      workspaceId,
      status,
    });
  }
}

async function invalidateDisabledWorkspaceStateBatch(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
) {
  const states = await ctx.db
    .query("aiConversationStates")
    .withIndex("by_workspaceId_and_mode", (q) =>
      q.eq("workspaceId", workspaceId).eq("mode", "ai"),
    )
    .take(DISABLE_INVALIDATION_BATCH_SIZE);
  const now = Date.now();
  for (const state of states) {
    const run = state.activeRunId
      ? await ctx.db.get("aiRuns", state.activeRunId)
      : null;
    const runBelongsToState =
      run &&
      run.workspaceId === state.workspaceId &&
      run.conversationId === state.conversationId;
    if (runBelongsToState) {
      await transitionActiveRunToDisabled(
        ctx,
        run,
        state,
        now,
        "AI automation was disabled for this workspace.",
      );
      if (run.epoch === state.generationEpoch) {
        continue;
      }
    }
    await ctx.db.patch("aiConversationStates", state._id, {
      mode: "disabled",
      attention: state.activeRunId ? "needs_human" : state.attention,
      generationEpoch: state.generationEpoch + 1,
      activeRunId: undefined,
      handoffReason: state.activeRunId
        ? "automation_disabled"
        : state.handoffReason,
      updatedAt: now,
    });
  }
  if (states.length === DISABLE_INVALIDATION_BATCH_SIZE) {
    await ctx.scheduler.runAfter(0, invalidateDisabledWorkspaceStatesReference, {
      workspaceId,
    });
  }
}

async function applyGenerationLimits(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
) {
  try {
    const [workspaceRequests, globalRequests, tokenReservation] =
      await Promise.all([
        generationRateLimiter.limit(ctx, "aiWorkspaceGenerationRequests", {
          key: workspaceId,
        }),
        generationRateLimiter.limit(ctx, "aiGlobalGenerationRequests"),
        generationRateLimiter.limit(ctx, "aiWorkspaceTokenReservations", {
          key: workspaceId,
          count: RESERVED_TOKENS_PER_GENERATION,
        }),
      ]);
    if (!workspaceRequests.ok) return "limit_workspace_requests";
    if (!globalRequests.ok) return "limit_global_requests";
    if (!tokenReservation.ok) return "limit_workspace_tokens";
  } catch (error) {
    console.error("AI rate limiter failed closed", error);
    return "limit_system_unavailable";
  }

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const [daily, monthly, queued, running] = await Promise.all([
    ctx.db
      .query("workspaceAiUsage")
      .withIndex("by_workspaceId_and_period", (q) =>
        q.eq("workspaceId", workspaceId).eq("period", day),
      )
      .unique(),
    ctx.db
      .query("workspaceAiUsage")
      .withIndex("by_workspaceId_and_period", (q) =>
        q.eq("workspaceId", workspaceId).eq("period", month),
      )
      .unique(),
    ctx.db
      .query("aiRuns")
      .withIndex("by_workspaceId_and_status", (q) =>
        q.eq("workspaceId", workspaceId).eq("status", "queued"),
      )
      .take(MAX_WORKSPACE_CONCURRENT_RUNS + 1),
    ctx.db
      .query("aiRuns")
      .withIndex("by_workspaceId_and_status", (q) =>
        q.eq("workspaceId", workspaceId).eq("status", "running"),
      )
      .take(MAX_WORKSPACE_CONCURRENT_RUNS + 1),
  ]);
  if ((daily?.totalTokens ?? 0) >= DAILY_WORKSPACE_TOKEN_CEILING) {
    return "limit_daily_tokens";
  }
  if ((monthly?.totalTokens ?? 0) >= MONTHLY_WORKSPACE_TOKEN_CEILING) {
    return "limit_monthly_tokens";
  }
  if (queued.length + running.length >= MAX_WORKSPACE_CONCURRENT_RUNS) {
    return "limit_workspace_concurrency";
  }
  return null;
}

export type QueueVisitorResult =
  | { queued: true; runId: Id<"aiRuns">; epoch: number }
  | { queued: false; reason: "disabled" | "human_mode" | "resolved" };

/**
 * Call after the canonical visitor message and conversation projection are
 * written. Scheduling is transactional with those writes.
 */
export async function queueVisitorMessageInTransaction(
  ctx: MutationCtx,
  args: {
    conversationId: Id<"conversations">;
    messageId: Id<"messages">;
    reopened: boolean;
    forceAi?: boolean;
  },
): Promise<QueueVisitorResult> {
  const now = Date.now();
  const conversation = await ctx.db.get("conversations", args.conversationId);
  const trigger = await ctx.db.get("messages", args.messageId);
  if (
    !conversation ||
    !trigger ||
    trigger.conversationId !== conversation._id ||
    trigger.workspaceId !== conversation.workspaceId ||
    trigger.author !== "visitor"
  ) {
    throw new Error("AI runs require a canonical visitor trigger message.");
  }
  if (conversation.status !== "open") {
    return { queued: false, reason: "resolved" };
  }

  const settings = await effectiveAiSettings(ctx, conversation.workspaceId);
  if (!settings.configured) {
    // Migration-safe default: existing widgets remain human-only until the
    // owner explicitly saves AI settings for this workspace.
    return { queued: false, reason: "disabled" };
  }
  const state = await getOrCreateConversationState(ctx, conversation, now);

  if (state.mode === "human" && !args.reopened && !args.forceAi) {
    return { queued: false, reason: "human_mode" };
  }

  if (!settings.enabled) {
    await discardActiveRun(ctx, state, now, "automation_disabled");
    let acknowledgementSequence: number | null = null;
    if (state.handoffReason !== "automation_disabled") {
      const clientMessageId = `ai-disabled:${trigger._id}`;
      const existing = await ctx.db
        .query("messages")
        .withIndex("by_clientMessageId", (q) =>
          q.eq("clientMessageId", clientMessageId),
        )
        .unique();
      if (existing) {
        if (
          existing.workspaceId !== conversation.workspaceId ||
          existing.conversationId !== conversation._id ||
          existing.kind !== "handoff"
        ) {
          throw new Error("Disabled handoff idempotency key is inconsistent.");
        }
        acknowledgementSequence = existing.sequence;
      } else {
        const body =
          settings.handoffMessage.trim().slice(0, 4_000) ||
          DEFAULT_HANDOFF_MESSAGE;
        const acknowledgementId = await ctx.db.insert("messages", {
          workspaceId: conversation.workspaceId,
          conversationId: conversation._id,
          sequence: conversation.lastMessageSequence + 1,
          author: "assistant",
          body,
          clientMessageId,
          kind: "handoff",
          createdAt: now,
        });
        const acknowledgement = await ctx.db.get("messages", acknowledgementId);
        if (!acknowledgement) {
          throw new Error("Disabled handoff acknowledgement was not created.");
        }
        acknowledgementSequence = acknowledgement.sequence;
        await ctx.db.patch("conversations", conversation._id, {
          hasMessages: true,
          updatedAt: now,
          lastMessageAt: now,
          lastMessageAuthor: "assistant",
          lastMessageBody: body,
          lastMessageSequence: acknowledgement.sequence,
        });
      }
    }
    await ctx.db.patch("aiConversationStates", state._id, {
      mode: "disabled",
      attention: "needs_human",
      generationEpoch: state.generationEpoch + 1,
      activeRunId: undefined,
      handoffReason: "automation_disabled",
      updatedAt: now,
    });
    if (acknowledgementSequence !== null) {
      await ctx.scheduler.runAfter(0, reconcileMirrorsReference, {
        conversationId: conversation._id,
        throughSequence: acknowledgementSequence,
      });
    }
    return { queued: false, reason: "disabled" };
  }

  if (
    state.activeRunId &&
    !args.reopened &&
    !args.forceAi
  ) {
    const currentRun = await ctx.db.get("aiRuns", state.activeRunId);
    if (
      currentRun?.triggerMessageId === trigger._id &&
      (currentRun.status === "queued" || currentRun.status === "running")
    ) {
      return {
        queued: true,
        runId: currentRun._id,
        epoch: currentRun.epoch,
      };
    }
  }

  await discardActiveRun(ctx, state, now, "superseded");
  const limitReason = await applyGenerationLimits(
    ctx,
    conversation.workspaceId,
  );
  const epoch = state.generationEpoch + 1;
  const runId = await ctx.db.insert("aiRuns", {
    workspaceId: conversation.workspaceId,
    conversationId: conversation._id,
    triggerMessageId: trigger._id,
    epoch,
    status: "queued",
    model: ANSWER_MODEL,
    attempt: 0,
    dispatchRecoveryCount: 0,
    ...(limitReason === null
      ? {}
      : {
          errorCode: limitReason,
          errorMessage: "Automatic answering is temporarily limited.",
        }),
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch("aiConversationStates", state._id, {
    mode: "ai",
    attention: "none",
    generationEpoch: epoch,
    activeRunId: runId,
    handoffReason: undefined,
    ...(args.reopened ? { consecutiveAiFailures: 0 } : {}),
    updatedAt: now,
  });
  await scheduleQueuedResponder(ctx, {
    runId,
    epoch,
    expectedAttempt: 0,
    expectedRecoveryCount: 0,
    actionDelayMs: 0,
  });
  return { queued: true, runId, epoch };
}

export const queueVisitorMessage = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    messageId: v.id("messages"),
    reopened: v.boolean(),
  },
  returns: v.union(
    v.object({
      queued: v.literal(true),
      runId: v.id("aiRuns"),
      epoch: v.number(),
    }),
    v.object({
      queued: v.literal(false),
      reason: v.union(
        v.literal("disabled"),
        v.literal("human_mode"),
        v.literal("resolved"),
      ),
    }),
  ),
  handler: async (ctx, args) =>
    await queueVisitorMessageInTransaction(ctx, args),
});

export async function invalidateForOwnerTakeoverInTransaction(
  ctx: MutationCtx,
  conversationId: Id<"conversations">,
) {
  const conversation = await ctx.db.get("conversations", conversationId);
  if (!conversation) {
    throw chatError("CONVERSATION_NOT_FOUND", "Conversation not found.");
  }
  const state = await ctx.db
    .query("aiConversationStates")
    .withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId))
    .unique();
  if (!state) {
    return null;
  }
  const now = Date.now();
  await discardActiveRun(ctx, state, now, "owner_takeover");
  await ctx.db.patch("aiConversationStates", state._id, {
    mode: "human",
    attention: "none",
    generationEpoch: state.generationEpoch + 1,
    activeRunId: undefined,
    handoffReason: undefined,
    updatedAt: now,
  });
  return null;
}

export async function invalidateForResolveInTransaction(
  ctx: MutationCtx,
  conversationId: Id<"conversations">,
) {
  const state = await ctx.db
    .query("aiConversationStates")
    .withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId))
    .unique();
  if (!state) {
    return null;
  }
  const now = Date.now();
  await discardActiveRun(ctx, state, now, "conversation_resolved");
  await ctx.db.patch("aiConversationStates", state._id, {
    mode: "human",
    attention: "none",
    generationEpoch: state.generationEpoch + 1,
    activeRunId: undefined,
    handoffReason: undefined,
    updatedAt: now,
  });
  return null;
}

async function mirrorBatch(
  ctx: MutationCtx,
  initialState: Doc<"aiConversationStates">,
  throughSequence: number,
) {
  const threadId = await ensureAgentThread(ctx, initialState);
  let state = { ...initialState, agentThreadId: threadId };
  const messages = await ctx.db
    .query("messages")
    .withIndex("by_conversationId_and_sequence", (q) =>
      q
        .eq("conversationId", state.conversationId)
        .gt("sequence", state.syncedThroughSequence)
        .lte("sequence", throughSequence),
    )
    .order("asc")
    .take(MAX_MIRROR_BATCH_SIZE);

  for (const message of messages) {
    await mirrorCanonicalMessage(ctx, state, threadId, message);
    state = { ...state, syncedThroughSequence: message.sequence };
  }
  return {
    state,
    threadId,
    done: state.syncedThroughSequence >= throughSequence,
  };
}

/**
 * Call after inserting an owner/system canonical message. Human delivery stays
 * available even if the component mirror needs asynchronous reconciliation.
 */
export async function mirrorCanonicalMessageInTransaction(
  ctx: MutationCtx,
  messageId: Id<"messages">,
) {
  const message = await ctx.db.get("messages", messageId);
  if (!message) {
    throw new Error("Canonical message not found for Agent reconciliation.");
  }
  const state = await ctx.db
    .query("aiConversationStates")
    .withIndex("by_conversationId", (q) =>
      q.eq("conversationId", message.conversationId),
    )
    .unique();
  if (!state || state.syncedThroughSequence >= message.sequence) {
    return null;
  }

  try {
    const result = await mirrorBatch(ctx, state, message.sequence);
    if (!result.done) {
      await ctx.scheduler.runAfter(0, reconcileMirrorsReference, {
        conversationId: message.conversationId,
        throughSequence: message.sequence,
      });
    }
  } catch (error) {
    console.error("Agent mirror deferred", error);
    await ctx.scheduler.runAfter(0, reconcileMirrorsReference, {
      conversationId: message.conversationId,
      throughSequence: message.sequence,
    });
  }
  return null;
}

export const reconcileMirrors = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    throughSequence: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("aiConversationStates")
      .withIndex("by_conversationId", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .unique();
    if (!state || state.syncedThroughSequence >= args.throughSequence) {
      return null;
    }
    const result = await mirrorBatch(ctx, state, args.throughSequence);
    if (!result.done) {
      await ctx.scheduler.runAfter(0, reconcileMirrorsReference, args);
    }
    return null;
  },
});

export const syncNextBatch = internalMutation({
  args: { runId: v.id("aiRuns") },
  returns: v.union(
    v.object({ status: v.literal("stale") }),
    v.object({
      status: v.literal("more"),
      syncedThroughSequence: v.number(),
    }),
    v.object({
      status: v.literal("ready"),
      threadId: v.string(),
      promptMessageId: v.string(),
      syncedThroughSequence: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("aiRuns", args.runId);
    if (!run || (run.status !== "queued" && run.status !== "running")) {
      return { status: "stale" as const };
    }
    const [state, conversation, trigger] = await Promise.all([
      ctx.db
        .query("aiConversationStates")
        .withIndex("by_conversationId", (q) =>
          q.eq("conversationId", run.conversationId),
        )
        .unique(),
      ctx.db.get("conversations", run.conversationId),
      ctx.db.get("messages", run.triggerMessageId),
    ]);
    if (
      !state ||
      !conversation ||
      !trigger ||
      conversation.status !== "open" ||
      state.mode !== "ai" ||
      state.activeRunId !== run._id ||
      state.generationEpoch !== run.epoch ||
      trigger.author !== "visitor"
    ) {
      return { status: "stale" as const };
    }

    const result = await mirrorBatch(ctx, state, trigger.sequence);
    if (!result.done) {
      return {
        status: "more" as const,
        syncedThroughSequence: result.state.syncedThroughSequence,
      };
    }
    const link = await ctx.db
      .query("messageAgentLinks")
      .withIndex("by_messageId", (q) => q.eq("messageId", trigger._id))
      .unique();
    if (!link || link.agentThreadId !== result.threadId) {
      throw new Error("Trigger message was not mirrored to its Agent thread.");
    }
    return {
      status: "ready" as const,
      threadId: result.threadId,
      promptMessageId: link.agentMessageId,
      syncedThroughSequence: result.state.syncedThroughSequence,
    };
  },
});

export const getRunPreflight = internalMutation({
  args: { runId: v.id("aiRuns") },
  returns: v.union(
    v.null(),
    v.object({
      runId: v.id("aiRuns"),
      workspaceId: v.id("workspaces"),
      conversationId: v.id("conversations"),
      triggerMessageId: v.id("messages"),
      triggerBody: v.string(),
      epoch: v.number(),
      attempt: v.number(),
      status: v.union(v.literal("queued"), v.literal("running")),
      agentThreadId: v.optional(v.string()),
      errorCode: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("aiRuns", args.runId);
    if (!run || (run.status !== "queued" && run.status !== "running")) {
      return null;
    }
    const [state, conversation, trigger] = await Promise.all([
      ctx.db
        .query("aiConversationStates")
        .withIndex("by_conversationId", (q) =>
          q.eq("conversationId", run.conversationId),
        )
        .unique(),
      ctx.db.get("conversations", run.conversationId),
      ctx.db.get("messages", run.triggerMessageId),
    ]);
    const settings = await effectiveAiSettings(ctx, run.workspaceId);
    const newerMessages =
      conversation && trigger
        ? await ctx.db
            .query("messages")
            .withIndex("by_conversationId_and_sequence", (q) =>
              q
                .eq("conversationId", run.conversationId)
                .gt("sequence", trigger.sequence),
            )
            .order("asc")
            .take(51)
        : [];
    if (!settings.enabled) {
      await transitionActiveRunToDisabled(
        ctx,
        run,
        state,
        Date.now(),
        "AI automation was disabled before responder preflight.",
      );
      return null;
    }
    if (
      !state ||
      !conversation ||
      !trigger ||
      conversation.status !== "open" ||
      state.workspaceId !== run.workspaceId ||
      state.mode !== "ai" ||
      state.activeRunId !== run._id ||
      state.generationEpoch !== run.epoch ||
      trigger.workspaceId !== run.workspaceId ||
      trigger.author !== "visitor" ||
      newerMessages.length > 50 ||
      newerMessages.some((message) => message.author === "visitor")
    ) {
      return null;
    }
    return {
      runId: run._id,
      workspaceId: run.workspaceId,
      conversationId: run.conversationId,
      triggerMessageId: run.triggerMessageId,
      triggerBody: trigger.body,
      epoch: run.epoch,
      attempt: run.attempt,
      status: run.status,
      agentThreadId: state.agentThreadId,
      errorCode: run.errorCode,
    };
  },
});

export const claimAttempt = internalMutation({
  args: { runId: v.id("aiRuns"), expectedAttempt: v.number() },
  returns: v.union(
    v.object({ status: v.literal("claimed"), attempt: v.number() }),
    v.object({ status: v.literal("busy") }),
    v.object({ status: v.literal("stale") }),
    v.object({ status: v.literal("exhausted") }),
  ),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("aiRuns", args.runId);
    if (!run || run.attempt !== args.expectedAttempt) {
      return { status: "stale" as const };
    }
    const state = await ctx.db
      .query("aiConversationStates")
      .withIndex("by_conversationId", (q) =>
        q.eq("conversationId", run.conversationId),
      )
      .unique();
    if (
      !state ||
      state.mode !== "ai" ||
      state.activeRunId !== run._id ||
      state.generationEpoch !== run.epoch
    ) {
      return { status: "stale" as const };
    }
    const settings = await effectiveAiSettings(ctx, run.workspaceId);
    if (!settings.enabled) {
      const now = Date.now();
      await ctx.db.patch("aiRuns", run._id, {
        status: "discarded",
        errorCode: "automation_disabled",
        errorMessage: "AI automation was disabled before provider execution.",
        finishedAt: now,
        updatedAt: now,
      });
      await ctx.db.patch("aiConversationStates", state._id, {
        mode: "disabled",
        attention: "needs_human",
        generationEpoch: state.generationEpoch + 1,
        activeRunId: undefined,
        handoffReason: "automation_disabled",
        updatedAt: now,
      });
      return { status: "stale" as const };
    }
    if (run.status === "running") {
      return { status: "busy" as const };
    }
    if (run.status !== "queued") {
      return { status: "stale" as const };
    }
    if (run.attempt >= MAX_PROVIDER_ATTEMPTS) {
      return { status: "exhausted" as const };
    }
    const attempt = run.attempt + 1;
    const now = Date.now();
    await ctx.db.patch("aiRuns", run._id, {
      status: "running",
      attempt,
      startedAt: run.startedAt ?? now,
      errorCode: undefined,
      errorMessage: undefined,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(RUN_RECOVERY_DELAY_MS, recoverRunReference, {
      runId: run._id,
      attempt,
    });
    return { status: "claimed" as const, attempt };
  },
});

export const prepareRetry = internalMutation({
  args: {
    runId: v.id("aiRuns"),
    attempt: v.number(),
    errorCode: v.string(),
    errorMessage: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("aiRuns", args.runId);
    const state = run
      ? await ctx.db
          .query("aiConversationStates")
          .withIndex("by_conversationId", (q) =>
            q.eq("conversationId", run.conversationId),
          )
          .unique()
      : null;
    if (
      !run ||
      !state ||
      run.status !== "running" ||
      run.attempt !== args.attempt ||
      state.activeRunId !== run._id ||
      state.generationEpoch !== run.epoch ||
      state.mode !== "ai"
    ) {
      return false;
    }
    await ctx.db.patch("aiRuns", run._id, {
      status: "queued",
      dispatchRecoveryCount: 0,
      errorCode: args.errorCode,
      errorMessage: args.errorMessage,
      updatedAt: Date.now(),
    });
    await scheduleQueuedResponder(ctx, {
      runId: run._id,
      epoch: run.epoch,
      expectedAttempt: run.attempt,
      expectedRecoveryCount: 0,
      actionDelayMs: retryDelayMs(args.attempt),
    });
    return true;
  },
});

async function handoffQueuedDispatchExhaustion(
  ctx: MutationCtx,
  run: Doc<"aiRuns">,
  state: Doc<"aiConversationStates">,
  conversation: Doc<"conversations">,
  handoffMessage: string,
) {
  const body =
    handoffMessage.trim().slice(0, 4_000) || DEFAULT_HANDOFF_MESSAGE;
  const now = Date.now();
  const messageId = await ctx.db.insert("messages", {
    workspaceId: run.workspaceId,
    conversationId: run.conversationId,
    sequence: conversation.lastMessageSequence + 1,
    author: "assistant",
    body,
    clientMessageId: deterministicInternalMessageId("handoff", run._id),
    kind: "handoff",
    aiRunId: run._id,
    createdAt: now,
  });
  const canonicalMessage = await ctx.db.get("messages", messageId);
  if (!canonicalMessage) {
    throw new Error("Dispatch recovery handoff message could not be read back.");
  }
  await mirrorCanonicalMessageInTransaction(ctx, messageId);
  await ctx.db.patch("conversations", conversation._id, {
    hasMessages: true,
    updatedAt: now,
    lastMessageAt: now,
    lastMessageAuthor: "assistant",
    lastMessageBody: body,
    lastMessageSequence: canonicalMessage.sequence,
  });
  await ctx.db.patch("aiRuns", run._id, {
    status: "handed_off",
    errorCode: "dispatch_recovery_exhausted",
    errorMessage:
      "The responder could not start after bounded recovery attempts.",
    finishedAt: now,
    updatedAt: now,
  });
  await ctx.db.patch("aiConversationStates", state._id, {
    mode: "human",
    attention: "needs_human",
    activeRunId: undefined,
    handoffReason: "dispatch_recovery_exhausted",
    updatedAt: now,
  });
}

export const recoverQueuedDispatch = internalMutation({
  args: {
    runId: v.id("aiRuns"),
    epoch: v.number(),
    expectedAttempt: v.number(),
    expectedRecoveryCount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (
      !Number.isInteger(args.epoch) ||
      !Number.isInteger(args.expectedAttempt) ||
      !Number.isInteger(args.expectedRecoveryCount) ||
      args.expectedAttempt < 0 ||
      args.expectedRecoveryCount < 0
    ) {
      return null;
    }
    const run = await ctx.db.get("aiRuns", args.runId);
    if (
      !run ||
      run.status !== "queued" ||
      run.epoch !== args.epoch ||
      run.attempt !== args.expectedAttempt ||
      (run.dispatchRecoveryCount ?? 0) !== args.expectedRecoveryCount
    ) {
      return null;
    }
    const [state, conversation, trigger] = await Promise.all([
      ctx.db
        .query("aiConversationStates")
        .withIndex("by_conversationId", (q) =>
          q.eq("conversationId", run.conversationId),
        )
        .unique(),
      ctx.db.get("conversations", run.conversationId),
      ctx.db.get("messages", run.triggerMessageId),
    ]);
    const settings = await effectiveAiSettings(ctx, run.workspaceId);
    if (!settings.enabled) {
      await transitionActiveRunToDisabled(
        ctx,
        run,
        state,
        Date.now(),
        "AI automation was disabled while recovering a queued responder.",
      );
      return null;
    }
    if (
      !state ||
      !conversation ||
      !trigger ||
      conversation.status !== "open" ||
      state.workspaceId !== run.workspaceId ||
      state.mode !== "ai" ||
      state.activeRunId !== run._id ||
      state.generationEpoch !== run.epoch ||
      trigger.workspaceId !== run.workspaceId ||
      trigger.conversationId !== run.conversationId ||
      trigger.author !== "visitor"
    ) {
      return null;
    }

    if (args.expectedRecoveryCount >= MAX_QUEUED_DISPATCH_RECOVERIES) {
      await handoffQueuedDispatchExhaustion(
        ctx,
        run,
        state,
        conversation,
        settings.handoffMessage,
      );
      return null;
    }

    const nextRecoveryCount = args.expectedRecoveryCount + 1;
    await ctx.db.patch("aiRuns", run._id, {
      dispatchRecoveryCount: nextRecoveryCount,
      updatedAt: Date.now(),
    });
    await scheduleQueuedResponder(ctx, {
      runId: run._id,
      epoch: run.epoch,
      expectedAttempt: run.attempt,
      expectedRecoveryCount: nextRecoveryCount,
      actionDelayMs: 0,
    });
    return null;
  },
});

export const recoverRun = internalMutation({
  args: { runId: v.id("aiRuns"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("aiRuns", args.runId);
    if (
      !run ||
      run.status !== "running" ||
      run.attempt !== args.attempt
    ) {
      return null;
    }
    const state = await ctx.db
      .query("aiConversationStates")
      .withIndex("by_conversationId", (q) =>
        q.eq("conversationId", run.conversationId),
      )
      .unique();
    if (
      !state ||
      state.mode !== "ai" ||
      state.activeRunId !== run._id ||
      state.generationEpoch !== run.epoch
    ) {
      return null;
    }
    const settings = await effectiveAiSettings(ctx, run.workspaceId);
    if (!settings.enabled) {
      await transitionActiveRunToDisabled(
        ctx,
        run,
        state,
        Date.now(),
        "AI automation was disabled while recovering a generation run.",
      );
      return null;
    }
    await ctx.db.patch("aiRuns", run._id, {
      status: "queued",
      dispatchRecoveryCount: 0,
      errorCode: "run_recovered",
      errorMessage: "The generation worker stopped before completion.",
      updatedAt: Date.now(),
    });
    await scheduleQueuedResponder(ctx, {
      runId: run._id,
      epoch: run.epoch,
      expectedAttempt: run.attempt,
      expectedRecoveryCount: 0,
      actionDelayMs: 0,
    });
    return null;
  },
});

export const enforceRunKillSwitch = internalMutation({
  args: { runId: v.id("aiRuns") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("aiRuns", args.runId);
    if (!run) {
      return false;
    }
    const settings = await effectiveAiSettings(ctx, run.workspaceId);
    if (settings.enabled) {
      return true;
    }
    const state = await ctx.db
      .query("aiConversationStates")
      .withIndex("by_conversationId", (q) =>
        q.eq("conversationId", run.conversationId),
      )
      .unique();
    await transitionActiveRunToDisabled(
      ctx,
      run,
      state,
      Date.now(),
      "AI automation was disabled before completion.",
    );
    return false;
  },
});

export const invalidateDisabledWorkspaceRuns = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    status: v.union(v.literal("queued"), v.literal("running")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const settings = await effectiveAiSettings(ctx, args.workspaceId);
    if (settings.enabled) return null;
    await invalidateDisabledWorkspaceRunBatch(
      ctx,
      args.workspaceId,
      args.status,
    );
    return null;
  },
});

export const invalidateDisabledWorkspaceStates = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const settings = await effectiveAiSettings(ctx, args.workspaceId);
    if (settings.enabled) return null;
    await invalidateDisabledWorkspaceStateBatch(ctx, args.workspaceId);
    return null;
  },
});

export const recordUsage = internalMutation({
  args: {
    runId: v.id("aiRuns"),
    attempt: v.number(),
    provider: v.string(),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    totalTokens: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("aiRuns", args.runId);
    if (!run || args.attempt < 1 || args.attempt > run.attempt) {
      throw new Error("Usage does not belong to a valid run attempt.");
    }
    const existing = await ctx.db
      .query("aiUsageRecords")
      .withIndex("by_runId_and_attempt", (q) =>
        q.eq("runId", run._id).eq("attempt", args.attempt),
      )
      .unique();
    if (existing) {
      if (
        existing.workspaceId !== run.workspaceId ||
        existing.conversationId !== run.conversationId ||
        existing.provider !== args.provider ||
        existing.model !== args.model ||
        existing.inputTokens !== args.inputTokens ||
        existing.outputTokens !== args.outputTokens ||
        existing.totalTokens !== args.totalTokens
      ) {
        throw new Error("Usage replay differs from the recorded run attempt.");
      }
      return null;
    }

    const now = Date.now();
    await ctx.db.insert("aiUsageRecords", {
      workspaceId: run.workspaceId,
      conversationId: run.conversationId,
      runId: run._id,
      attempt: args.attempt,
      provider: args.provider,
      model: args.model,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      totalTokens: args.totalTokens,
      createdAt: now,
    });
    await ctx.db.patch("aiRuns", run._id, {
      inputTokens: (run.inputTokens ?? 0) + args.inputTokens,
      outputTokens: (run.outputTokens ?? 0) + args.outputTokens,
      totalTokens: (run.totalTokens ?? 0) + args.totalTokens,
      updatedAt: now,
    });

    const day = new Date(now).toISOString().slice(0, 10);
    for (const period of [day, day.slice(0, 7)]) {
      const aggregate = await ctx.db
        .query("workspaceAiUsage")
        .withIndex("by_workspaceId_and_period", (q) =>
          q.eq("workspaceId", run.workspaceId).eq("period", period),
        )
        .unique();
      if (aggregate) {
        await ctx.db.patch("workspaceAiUsage", aggregate._id, {
          requests: aggregate.requests + 1,
          inputTokens: aggregate.inputTokens + args.inputTokens,
          outputTokens: aggregate.outputTokens + args.outputTokens,
          totalTokens: aggregate.totalTokens + args.totalTokens,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("workspaceAiUsage", {
          workspaceId: run.workspaceId,
          period,
          requests: 1,
          inputTokens: args.inputTokens,
          outputTokens: args.outputTokens,
          totalTokens: args.totalTokens,
          updatedAt: now,
        });
      }
    }
    return null;
  },
});

function deterministicInternalMessageId(
  kind: "answer" | "handoff" | "retry" | "greeting",
  runId: string,
) {
  return `ai-${kind}:${runId}`;
}

async function guardedRunState(ctx: MutationCtx, runId: Id<"aiRuns">) {
  const run = await ctx.db.get("aiRuns", runId);
  if (!run) return null;
  const [state, conversation, trigger] = await Promise.all([
    ctx.db
      .query("aiConversationStates")
      .withIndex("by_conversationId", (q) =>
        q.eq("conversationId", run.conversationId),
      )
      .unique(),
    ctx.db.get("conversations", run.conversationId),
    ctx.db.get("messages", run.triggerMessageId),
  ]);
  const settings = await effectiveAiSettings(ctx, run.workspaceId);
  if (!settings.enabled) {
    await transitionActiveRunToDisabled(
      ctx,
      run,
      state,
      Date.now(),
      "AI automation was disabled before the run could commit.",
    );
    return null;
  }
  const newerMessages =
    conversation && trigger
      ? await ctx.db
          .query("messages")
          .withIndex("by_conversationId_and_sequence", (q) =>
            q
              .eq("conversationId", run.conversationId)
              .gt("sequence", trigger.sequence),
          )
          .order("asc")
          .take(51)
      : [];
  if (
    !state ||
    !conversation ||
    !trigger ||
    conversation.status !== "open" ||
    state.workspaceId !== run.workspaceId ||
    state.mode !== "ai" ||
    state.activeRunId !== run._id ||
    state.generationEpoch !== run.epoch ||
    trigger.workspaceId !== run.workspaceId ||
    trigger.conversationId !== run.conversationId ||
    trigger.author !== "visitor" ||
    newerMessages.length > 50 ||
    newerMessages.some((message) => message.author === "visitor") ||
    state.syncedThroughSequence !== conversation.lastMessageSequence ||
    state.syncedThroughSequence < trigger.sequence ||
    !state.agentThreadId
  ) {
    return null;
  }
  return {
    run,
    state,
    conversation,
    trigger,
    agentThreadId: state.agentThreadId,
  };
}

export const commitCandidate = internalMutation({
  args: {
    runId: v.id("aiRuns"),
    attempt: v.number(),
    segments: v.array(groundedAnswerSegmentValidator),
    evidence: v.array(retrievedEvidenceValidator),
  },
  returns: v.union(
    v.object({ status: v.literal("accepted"), messageId: v.id("messages") }),
    v.object({ status: v.literal("stale") }),
    v.object({ status: v.literal("invalid_evidence") }),
  ),
  handler: async (ctx, args) => {
    const guarded = await guardedRunState(ctx, args.runId);
    if (
      !guarded ||
      guarded.run.status !== "running" ||
      guarded.run.attempt !== args.attempt
    ) {
      return { status: "stale" as const };
    }
    if (
      args.segments.length === 0 ||
      args.segments.length > MAX_GROUNDED_SEGMENTS ||
      args.evidence.length === 0 ||
      args.evidence.length > 10
    ) {
      return { status: "invalid_evidence" as const };
    }

    const normalizedEvidence = normalizeRetrievedEvidence(args.evidence);
    if (normalizedEvidence.length !== args.evidence.length) {
      return { status: "invalid_evidence" as const };
    }
    const seenCitationIds = new Set<string>();
    const canonicalEvidence: Array<
      RetrievedEvidence & { documentTitle: string }
    > = [];
    for (const evidence of normalizedEvidence) {
      if (seenCitationIds.has(evidence.citationId)) {
        return { status: "invalid_evidence" as const };
      }
      seenCitationIds.add(evidence.citationId);
      const document = await ctx.db.get(
        "knowledgeDocuments",
        evidence.knowledgeDocumentId,
      );
      if (
        !document ||
        document.workspaceId !== guarded.run.workspaceId ||
        document.status !== "ready" ||
        document.ragEntryId !== evidence.ragEntryId
      ) {
        return { status: "invalid_evidence" as const };
      }
      canonicalEvidence.push({ ...evidence, documentTitle: document.title });
    }

    const canonicalEvidenceById = new Map(
      canonicalEvidence.map((evidence) => [evidence.citationId, evidence]),
    );
    const usedCitationIds = new Set<string>();
    const groundedSegments = args.segments.map((segment) => {
      const text = normalizeGroundedText(segment.text);
      const citationId = segment.citationId.trim();
      const supportingQuote = normalizeGroundedText(segment.supportingQuote);
      const evidence = canonicalEvidenceById.get(citationId);
      if (
        !text ||
        !supportingQuote ||
        text.length > MAX_GROUNDED_SEGMENT_LENGTH ||
        text !== supportingQuote ||
        containsPromptInjection(supportingQuote) ||
        !evidence ||
        !evidence.excerpt.includes(supportingQuote)
      ) {
        return null;
      }
      usedCitationIds.add(citationId);
      return { text, citationId, supportingQuote, evidence };
    });
    if (
      groundedSegments.some((segment) => segment === null) ||
      usedCitationIds.size !== canonicalEvidence.length
    ) {
      return { status: "invalid_evidence" as const };
    }

    const answer = groundedSegments
      .map((segment) => segment!.text)
      .join("\n\n");
    if (!answer || answer.length > 4_000) {
      return { status: "invalid_evidence" as const };
    }

    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      workspaceId: guarded.run.workspaceId,
      conversationId: guarded.run.conversationId,
      sequence: guarded.conversation.lastMessageSequence + 1,
      author: "assistant",
      body: answer,
      clientMessageId: deterministicInternalMessageId("answer", guarded.run._id),
      kind: "ai_answer",
      aiRunId: guarded.run._id,
      createdAt: now,
    });

    for (const [segmentIndex, groundedSegment] of groundedSegments.entries()) {
      if (!groundedSegment) {
        throw new Error("Grounded segment validation became inconsistent.");
      }
      const { evidence } = groundedSegment;
      await ctx.db.insert("aiCitations", {
        workspaceId: guarded.run.workspaceId,
        conversationId: guarded.run.conversationId,
        messageId,
        knowledgeDocumentId: evidence.knowledgeDocumentId,
        ragEntryId: evidence.ragEntryId,
        chunkOrder: evidence.chunkOrder,
        documentTitle: evidence.documentTitle,
        ...(evidence.pageNumber === undefined
          ? {}
          : { pageNumber: evidence.pageNumber }),
        ...(evidence.heading === undefined ? {} : { heading: evidence.heading }),
        excerpt: evidence.excerpt,
        citationId: groundedSegment.citationId,
        segmentIndex,
        segmentText: groundedSegment.text,
        supportingQuote: groundedSegment.supportingQuote,
        score: evidence.score,
        createdAt: now,
      });
    }

    const canonicalMessage = await ctx.db.get("messages", messageId);
    if (!canonicalMessage) {
      throw new Error("Accepted AI message could not be read back.");
    }
    await mirrorCanonicalMessage(
      ctx,
      guarded.state,
      guarded.agentThreadId,
      canonicalMessage,
    );
    await ctx.db.patch("conversations", guarded.conversation._id, {
      hasMessages: true,
      updatedAt: now,
      lastMessageAt: now,
      lastMessageAuthor: "assistant",
      lastMessageBody: answer,
      lastMessageSequence: canonicalMessage.sequence,
    });
    await ctx.db.patch("aiRuns", guarded.run._id, {
      status: "accepted",
      finishedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch("aiConversationStates", guarded.state._id, {
      activeRunId: undefined,
      attention: "none",
      consecutiveAiFailures: 0,
      syncedThroughSequence: canonicalMessage.sequence,
      updatedAt: now,
    });
    return { status: "accepted" as const, messageId };
  },
});

export const handoffRun = internalMutation({
  args: {
    runId: v.id("aiRuns"),
    reason: v.string(),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ status: v.literal("handed_off"), messageId: v.id("messages") }),
    v.object({
      status: v.literal("responded"),
      messageId: v.id("messages"),
      consecutiveFailures: v.number(),
    }),
    v.object({ status: v.literal("stale") }),
  ),
  handler: async (ctx, args) => {
    const guarded = await guardedRunState(ctx, args.runId);
    if (!guarded) {
      const run = await ctx.db.get("aiRuns", args.runId);
      if (run && (run.status === "queued" || run.status === "running")) {
        await ctx.db.patch("aiRuns", run._id, {
          status: "discarded",
          errorCode: "stale_run",
          errorMessage: "The conversation changed before handoff.",
          finishedAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      return { status: "stale" as const };
    }
    const settings = await effectiveAiSettings(ctx, guarded.run.workspaceId);
    const isGreetingResponse = args.reason === "greeting";
    const currentFailures = guarded.state.consecutiveAiFailures ?? 0;
    const consecutiveFailures = isGreetingResponse
      ? currentFailures
      : currentFailures + 1;
    const shouldRetry =
      !isGreetingResponse &&
      RETRYABLE_HANDOFF_REASONS.has(args.reason) &&
      consecutiveFailures < MAX_CONSECUTIVE_AI_FAILURES;
    const shouldHandoff = !isGreetingResponse && !shouldRetry;
    const body = isGreetingResponse
      ? GREETING_MESSAGE
      : shouldRetry
        ? RETRY_MESSAGE
        : settings.handoffMessage.trim().slice(0, 4_000) ||
          DEFAULT_HANDOFF_MESSAGE;
    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      workspaceId: guarded.run.workspaceId,
      conversationId: guarded.run.conversationId,
      sequence: guarded.conversation.lastMessageSequence + 1,
      author: "assistant",
      body,
      clientMessageId: deterministicInternalMessageId(
        isGreetingResponse ? "greeting" : shouldRetry ? "retry" : "handoff",
        guarded.run._id,
      ),
      kind: shouldHandoff ? "handoff" : "ai_answer",
      aiRunId: guarded.run._id,
      createdAt: now,
    });
    const canonicalMessage = await ctx.db.get("messages", messageId);
    if (!canonicalMessage) {
      throw new Error("Handoff message could not be read back.");
    }
    await mirrorCanonicalMessage(
      ctx,
      guarded.state,
      guarded.agentThreadId,
      canonicalMessage,
    );
    await ctx.db.patch("conversations", guarded.conversation._id, {
      hasMessages: true,
      updatedAt: now,
      lastMessageAt: now,
      lastMessageAuthor: "assistant",
      lastMessageBody: body,
      lastMessageSequence: canonicalMessage.sequence,
    });
    await ctx.db.patch("aiRuns", guarded.run._id, {
      status: shouldHandoff ? "handed_off" : "accepted",
      errorCode: args.errorCode,
      errorMessage: args.errorMessage,
      finishedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch("aiConversationStates", guarded.state._id, {
      mode: shouldHandoff ? "human" : "ai",
      attention: shouldHandoff ? "needs_human" : "none",
      activeRunId: undefined,
      handoffReason: shouldHandoff ? args.reason : undefined,
      consecutiveAiFailures: isGreetingResponse
        ? currentFailures
        : consecutiveFailures,
      syncedThroughSequence: canonicalMessage.sequence,
      updatedAt: now,
    });
    return shouldHandoff
      ? { status: "handed_off" as const, messageId }
      : {
          status: "responded" as const,
          messageId,
          consecutiveFailures: isGreetingResponse
            ? currentFailures
            : consecutiveFailures,
        };
  },
});

export const takeOver = mutation({
  args: { conversationId: v.id("conversations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOwnedConversation(ctx, args.conversationId);
    await invalidateForOwnerTakeoverInTransaction(ctx, args.conversationId);
    return null;
  },
});

export const resumeAi = mutation({
  args: { conversationId: v.id("conversations") },
  returns: v.object({ queued: v.boolean() }),
  handler: async (ctx, args) => {
    const { conversation } = await requireOwnedConversation(
      ctx,
      args.conversationId,
    );
    if (conversation.status !== "open") {
      throw chatError(
        "CONVERSATION_RESOLVED",
        "Resolved conversations cannot resume AI.",
      );
    }
    const settings = await effectiveAiSettings(ctx, conversation.workspaceId);
    if (!settings.enabled) {
      throw chatError("AI_DISABLED", "AI automation is disabled.");
    }
    if (conversation.lastMessageAuthor === "visitor") {
      const trigger = await ctx.db
        .query("messages")
        .withIndex("by_conversationId_and_sequence", (q) =>
          q
            .eq("conversationId", conversation._id)
            .eq("sequence", conversation.lastMessageSequence),
        )
        .unique();
      if (trigger?.author === "visitor") {
        const result = await queueVisitorMessageInTransaction(ctx, {
          conversationId: conversation._id,
          messageId: trigger._id,
          reopened: false,
          forceAi: true,
        });
        return { queued: result.queued };
      }
    }

    const now = Date.now();
    const state = await getOrCreateConversationState(ctx, conversation, now);
    await discardActiveRun(ctx, state, now, "owner_resumed_ai");
    await ctx.db.patch("aiConversationStates", state._id, {
      mode: "ai",
      attention: "none",
      generationEpoch: state.generationEpoch + 1,
      activeRunId: undefined,
      handoffReason: undefined,
      consecutiveAiFailures: 0,
      updatedAt: now,
    });
    return { queued: false };
  },
});

export const configureAi = mutation({
  args: { enabled: v.boolean(), handoffMessage: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workspace = await requireOwnerWorkspace(ctx);
    const handoffMessage = args.handoffMessage.trim();
    if (!handoffMessage || handoffMessage.length > 4_000) {
      throw chatError(
        "INVALID_AI_SETTINGS",
        "Handoff message must be between 1 and 4000 characters.",
      );
    }
    const existing = await ctx.db
      .query("workspaceAiSettings")
      .withIndex("by_workspaceId", (q) =>
        q.eq("workspaceId", workspace._id),
      )
      .unique();
    const value = {
      workspaceId: workspace._id,
      enabled: args.enabled,
      answerModel: ANSWER_MODEL,
      handoffMessage,
      updatedAt: Date.now(),
    } as const;
    if (existing) {
      await ctx.db.replace("workspaceAiSettings", existing._id, value);
    } else {
      await ctx.db.insert("workspaceAiSettings", value);
    }
    if (!args.enabled) {
      await invalidateDisabledWorkspaceRunBatch(ctx, workspace._id, "queued");
      await invalidateDisabledWorkspaceRunBatch(ctx, workspace._id, "running");
      await invalidateDisabledWorkspaceStateBatch(ctx, workspace._id);
    }
    return null;
  },
});

export const getAiSettings = query({
  args: {},
  returns: v.object({
    enabled: v.boolean(),
    globalAvailable: v.boolean(),
    effectiveEnabled: v.boolean(),
    answerModel: v.literal(ANSWER_MODEL),
    handoffMessage: v.string(),
  }),
  handler: async (ctx) => {
    const workspace = await requireOwnerWorkspace(ctx);
    const settings = await ctx.db
      .query("workspaceAiSettings")
      .withIndex("by_workspaceId", (q) =>
        q.eq("workspaceId", workspace._id),
      )
      .unique();
    return {
      enabled: settings?.enabled ?? false,
      globalAvailable: isGloballyEnabled(),
      effectiveEnabled: Boolean(settings?.enabled && isGloballyEnabled()),
      answerModel: ANSWER_MODEL,
      handoffMessage: resolvedHandoffMessage(settings?.handoffMessage),
    };
  },
});
