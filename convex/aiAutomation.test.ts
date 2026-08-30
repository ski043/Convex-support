/// <reference types="vite/client" />

import agentTest from "@convex-dev/agent/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { makeFunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { components } from "./_generated/api";
import {
  invalidateForResolveInTransaction,
  type QueueVisitorResult,
} from "./aiAutomation";
import { runResponderOrchestration } from "./aiResponderOrchestration";
import {
  MAX_QUEUED_DISPATCH_RECOVERIES,
  QUEUED_DISPATCH_RECOVERY_DELAY_MS,
  classifyProviderFailure,
  normalizeRetrievedEvidence,
  validateCandidateAnswer,
  type GroundedAnswerSegment,
  type RetrievedEvidence,
} from "./aiModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type WorkspaceId = GenericId<"workspaces">;
type ConversationId = GenericId<"conversations">;
type MessageId = GenericId<"messages">;
type RunId = GenericId<"aiRuns">;

const queueVisitor = makeFunctionReference<
  "mutation",
  {
    conversationId: ConversationId;
    messageId: MessageId;
    reopened: boolean;
  },
  QueueVisitorResult
>("aiAutomation:queueVisitorMessage");

const syncNextBatch = makeFunctionReference<
  "mutation",
  { runId: RunId },
  | { status: "stale" }
  | { status: "more"; syncedThroughSequence: number }
  | {
      status: "ready";
      threadId: string;
      promptMessageId: string;
      syncedThroughSequence: number;
    }
>("aiAutomation:syncNextBatch");

const claimAttempt = makeFunctionReference<
  "mutation",
  { runId: RunId; expectedAttempt: number },
  | { status: "claimed"; attempt: number }
  | { status: "busy" }
  | { status: "stale" }
  | { status: "exhausted" }
>("aiAutomation:claimAttempt");

const getRunPreflight = makeFunctionReference<
  "mutation",
  { runId: RunId },
  {
    runId: RunId;
    workspaceId: WorkspaceId;
    conversationId: ConversationId;
    triggerMessageId: MessageId;
    triggerBody: string;
    epoch: number;
    attempt: number;
    status: "queued" | "running";
  } | null
>("aiAutomation:getRunPreflight");

const prepareRetry = makeFunctionReference<
  "mutation",
  {
    runId: RunId;
    attempt: number;
    errorCode: string;
    errorMessage: string;
  },
  boolean
>("aiAutomation:prepareRetry");

const recoverQueuedDispatch = makeFunctionReference<
  "mutation",
  {
    runId: RunId;
    epoch: number;
    expectedAttempt: number;
    expectedRecoveryCount: number;
  },
  null
>("aiAutomation:recoverQueuedDispatch");

const commitCandidate = makeFunctionReference<
  "mutation",
  {
    runId: RunId;
    attempt: number;
    segments: GroundedAnswerSegment[];
    evidence: RetrievedEvidence[];
  },
  | { status: "accepted"; messageId: MessageId }
  | { status: "stale" }
  | { status: "invalid_evidence" }
>("aiAutomation:commitCandidate");

const handoffRun = makeFunctionReference<
  "mutation",
  { runId: RunId; reason: string; errorCode?: string; errorMessage?: string },
  | { status: "handed_off"; messageId: MessageId }
  | {
      status: "responded";
      messageId: MessageId;
      consecutiveFailures: number;
    }
  | { status: "stale" }
>("aiAutomation:handoffRun");

const recordUsage = makeFunctionReference<
  "mutation",
  {
    runId: RunId;
    attempt: number;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  },
  null
>("aiAutomation:recordUsage");

const takeOver = makeFunctionReference<
  "mutation",
  { conversationId: ConversationId },
  null
>("aiAutomation:takeOver");

const resumeAi = makeFunctionReference<
  "mutation",
  { conversationId: ConversationId },
  { queued: boolean }
>("aiAutomation:resumeAi");

const configureAi = makeFunctionReference<
  "mutation",
  { enabled: boolean; handoffMessage: string },
  null
>("aiAutomation:configureAi");

const enforceRunKillSwitch = makeFunctionReference<
  "mutation",
  { runId: RunId },
  boolean
>("aiAutomation:enforceRunKillSwitch");

const getAiSettings = makeFunctionReference<
  "query",
  Record<string, never>,
  {
    enabled: boolean;
    globalAvailable: boolean;
    effectiveEnabled: boolean;
    answerModel: "openai/gpt-5.6-terra";
    handoffMessage: string;
  }
>("aiAutomation:getAiSettings");

const sendVisitorMessage = makeFunctionReference<
  "mutation",
  {
    workspaceId: WorkspaceId;
    token: string;
    clientMessageId: string;
    body: string;
    context: Record<string, never>;
  },
  {
    _id: MessageId;
    sequence: number;
    author: "visitor" | "owner" | "assistant" | "system";
    body: string;
    createdAt: number;
  }
>("widgetChat:sendMessage");

const sendOwnerReply = makeFunctionReference<
  "mutation",
  { conversationId: ConversationId; clientMessageId: string; body: string },
  {
    _id: MessageId;
    sequence: number;
    author: "visitor" | "owner" | "assistant" | "system";
    body: string;
    createdAt: number;
  }
>("inbox:sendReply");

const ownerIdentity = {
  subject: "owner-a",
  issuer: "https://auth.example.test",
  tokenIdentifier: "https://auth.example.test|owner-a",
};

function makeBackend() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  rateLimiterTest.register(t);
  return t;
}

type TestBackend = ReturnType<typeof makeBackend>;

async function cancelPendingResponderActions(t: TestBackend) {
  await t.run(async (ctx) => {
    const jobs = await ctx.db.system.query("_scheduled_functions").take(100);
    for (const job of jobs) {
      if (job.name === "aiResponder:run" && job.state.kind === "pending") {
        await ctx.scheduler.cancel(job._id);
      }
    }
  });
}

async function createWorkspace(t: TestBackend, suffix = "a") {
  return await t.run(async (ctx) => {
    const workspaceId = await ctx.db.insert("workspaces", {
      name: `Workspace ${suffix}`,
      ownerAuthUserId: `legacy-${suffix}`,
      ownerTokenIdentifier:
        suffix === "a" ? ownerIdentity.tokenIdentifier : `owner-${suffix}`,
    });
    await ctx.db.insert("workspaceAiSettings", {
      workspaceId,
      enabled: true,
      answerModel: "openai/gpt-5.6-terra",
      handoffMessage: "A human will continue here.",
      updatedAt: Date.now(),
    });
    return workspaceId;
  });
}

async function createConversationWithVisitorMessage(
  t: TestBackend,
  workspaceId: WorkspaceId,
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const visitorId = await ctx.db.insert("visitors", {
      workspaceId,
      capabilityToken: "a".repeat(64),
      capabilityExpiresAt: now + 60_000,
      capabilityExpired: false,
      createdAt: now,
      lastSeenAt: now,
    });
    const conversationId = await ctx.db.insert("conversations", {
      workspaceId,
      visitorId,
      status: "open",
      hasMessages: true,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
      lastMessageAt: now,
      lastMessageAuthor: "visitor",
      lastMessageBody: "How do returns work?",
      lastMessageSequence: 1,
      unreadCount: 1,
    });
    const messageId = await ctx.db.insert("messages", {
      workspaceId,
      conversationId,
      sequence: 1,
      author: "visitor",
      body: "How do returns work?",
      clientMessageId: "00000000-0000-4000-8000-000000000001",
      createdAt: now,
    });
    return { conversationId, messageId };
  });
}

async function appendVisitorMessage(
  t: TestBackend,
  workspaceId: WorkspaceId,
  conversationId: ConversationId,
  sequence: number,
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      workspaceId,
      conversationId,
      sequence,
      author: "visitor",
      body: `Visitor question ${sequence}`,
      clientMessageId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
      createdAt: now,
    });
    await ctx.db.patch("conversations", conversationId, {
      status: "open",
      resolvedAt: null,
      updatedAt: now,
      lastMessageAt: now,
      lastMessageAuthor: "visitor",
      lastMessageBody: `Visitor question ${sequence}`,
      lastMessageSequence: sequence,
    });
    return messageId;
  });
}

async function addReadyKnowledge(
  t: TestBackend,
  workspaceId: WorkspaceId,
  suffix = "a",
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const storageId = await ctx.storage.store(
      new Blob(["Returns are accepted for 30 days."], { type: "text/plain" }),
    );
    return await ctx.db.insert("knowledgeDocuments", {
      workspaceId,
      storageId,
      clientRequestId: `request-${suffix}`,
      stableKey: `returns-${suffix}`,
      version: 1,
      filename: "returns.txt",
      title: "Returns policy",
      mimeType: "text/plain",
      fileKind: "text",
      size: 33,
      sha256: suffix.repeat(64).slice(0, 64),
      status: "ready",
      ragEntryId: `rag-${suffix}`,
      attempt: 1,
      createdAt: now,
      updatedAt: now,
      readyAt: now,
    });
  });
}

function evidenceFor(
  knowledgeDocumentId: GenericId<"knowledgeDocuments">,
  suffix = "a",
): RetrievedEvidence {
  return {
    citationId: `citation-${suffix}`,
    knowledgeDocumentId,
    ragEntryId: `rag-${suffix}`,
    chunkOrder: 0,
    documentTitle: "Returns policy",
    excerpt: "Returns are accepted for 30 days.",
    score: 0.91,
  };
}

function groundedSegmentFor(
  evidence: RetrievedEvidence,
  text = evidence.excerpt,
  supportingQuote = evidence.excerpt,
): GroundedAnswerSegment {
  return {
    text,
    citationId: evidence.citationId,
    supportingQuote,
  };
}

async function queueSyncAndClaim(
  t: TestBackend,
  conversationId: ConversationId,
  messageId: MessageId,
) {
  const queued = await t.mutation(queueVisitor, {
    conversationId,
    messageId,
    reopened: false,
  });
  if (!queued.queued) throw new Error("Expected an AI run");
  expect((await t.mutation(syncNextBatch, { runId: queued.runId })).status).toBe(
    "ready",
  );
  const claim = await t.mutation(claimAttempt, {
    runId: queued.runId,
    expectedAttempt: 0,
  });
  expect(claim).toEqual({ status: "claimed", attempt: 1 });
  return queued.runId;
}

describe("grounded answer state helpers", () => {
  test("requires every answer segment to exactly match bounded retrieved text", () => {
    const evidence = evidenceFor("knowledge;doc" as GenericId<"knowledgeDocuments">);
    expect(normalizeRetrievedEvidence([])).toEqual([]);
    expect(
      validateCandidateAnswer(
        {
          canAnswer: true,
          reason: "answered",
          segments: [
            {
              text: "Returns are accepted for 30 days.",
              citationId: "",
              supportingQuote: "Returns are accepted for 30 days.",
            },
          ],
        },
        [evidence],
      ),
    ).toEqual({ ok: false, reason: "missing_citation" });
    expect(
      validateCandidateAnswer(
        {
          canAnswer: true,
          reason: "answered",
          segments: [
            groundedSegmentFor(evidence),
          ],
        },
        [evidence],
      ),
    ).toMatchObject({
      ok: true,
      answer: "Returns are accepted for 30 days.",
    });
    expect(
      validateCandidateAnswer(
        {
          canAnswer: true,
          reason: "answered",
          segments: [
            groundedSegmentFor(
              evidence,
              "Returns are accepted for 90 days.",
            ),
          ],
        },
        [evidence],
      ),
    ).toEqual({ ok: false, reason: "ungrounded_segment" });
  });

  test("classifies bounded retry failures without leaking raw provider errors", () => {
    expect(classifyProviderFailure({ statusCode: 429 }).retryable).toBe(true);
    expect(classifyProviderFailure(new DOMException("timed out", "TimeoutError"))).toMatchObject({
      code: "provider_timeout",
      retryable: true,
    });
    expect(classifyProviderFailure({ statusCode: 401 })).toMatchObject({
      code: "provider_auth",
      retryable: false,
    });
  });
});

describe("AI run concurrency and idempotency", () => {
  test("a real workspace concurrency limit preserves the visitor message, hands off once, and still permits an owner reply", async () => {
    const t = makeBackend();
    const workspaceId = await createWorkspace(t);
    const token = "9".repeat(64);
    const visitorId = await t.run(async (ctx) => {
      const now = Date.now();
      const targetVisitorId = await ctx.db.insert("visitors", {
        workspaceId,
        capabilityToken: token,
        capabilityExpiresAt: now + 60_000,
        capabilityExpired: false,
        createdAt: now,
        lastSeenAt: now,
      });
      for (let index = 0; index < 4; index += 1) {
        const blockerVisitorId = await ctx.db.insert("visitors", {
          workspaceId,
          capabilityToken: String(index + 1).repeat(64),
          capabilityExpiresAt: now + 60_000,
          capabilityExpired: false,
          createdAt: now,
          lastSeenAt: now,
        });
        const conversationId = await ctx.db.insert("conversations", {
          workspaceId,
          visitorId: blockerVisitorId,
          status: "open",
          hasMessages: true,
          createdAt: now,
          updatedAt: now,
          resolvedAt: null,
          lastMessageAt: now,
          lastMessageAuthor: "visitor",
          lastMessageBody: `Concurrent visitor ${index}`,
          lastMessageSequence: 1,
          unreadCount: 1,
        });
        const triggerMessageId = await ctx.db.insert("messages", {
          workspaceId,
          conversationId,
          sequence: 1,
          author: "visitor",
          body: `Concurrent visitor ${index}`,
          clientMessageId: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          createdAt: now,
        });
        await ctx.db.insert("aiRuns", {
          workspaceId,
          conversationId,
          triggerMessageId,
          epoch: 1,
          status: "queued",
          model: "openai/gpt-5.6-terra",
          attempt: 0,
          createdAt: now,
          updatedAt: now,
        });
      }
      return targetVisitorId;
    });

    const visitorMessage = await t.mutation(sendVisitorMessage, {
      workspaceId,
      token,
      clientMessageId: "20000000-0000-4000-8000-000000000001",
      body: "Can you help with my order?",
      context: {},
    });
    const remainingWorkspaceRequests = await t.run(async (ctx) =>
      ctx.runQuery(components.rateLimiter.lib.getValue, {
        name: "aiWorkspaceGenerationRequests",
        key: workspaceId,
        config: { kind: "fixed window", rate: 60, period: 60 * 60 * 1_000 },
      }),
    );
    expect(remainingWorkspaceRequests.value).toBe(60);
    const queued = await t.run(async (ctx) => {
      const conversation = await ctx.db
        .query("conversations")
        .withIndex("by_visitorId", (q) => q.eq("visitorId", visitorId))
        .unique();
      if (!conversation) throw new Error("Expected target conversation");
      const run = await ctx.db
        .query("aiRuns")
        .withIndex("by_conversationId_and_createdAt", (q) =>
          q.eq("conversationId", conversation._id),
        )
        .unique();
      if (!run) throw new Error("Expected rate-limited run");
      return { conversation, run };
    });
    expect(queued.run).toMatchObject({
      status: "queued",
      attempt: 0,
      errorCode: "limit_workspace_concurrency",
    });

    const searchReadyKnowledge = vi.fn(async () => ({ results: [] }));
    const generateCandidate = vi.fn(async () => {
      throw new Error("provider must not run for an application limit");
    });
    const handoff = vi.fn(async (request) => {
      await t.mutation(handoffRun, request);
    });
    const dependencies = {
      enforceRunKillSwitch: async (runId: RunId) =>
        await t.mutation(enforceRunKillSwitch, { runId }),
      getRunPreflight: async (runId: RunId) =>
        await t.mutation(getRunPreflight, { runId }),
      syncNextBatch: async (runId: RunId) =>
        await t.mutation(syncNextBatch, { runId }),
      searchReadyKnowledge,
      claimAttempt: vi.fn(async () => ({ status: "stale" as const })),
      prepareRetry: vi.fn(async () => false),
      generateCandidate,
      commitCandidate: vi.fn(async () => ({ status: "stale" as const })),
      handoff,
      delay: vi.fn(async () => undefined),
    };

    await runResponderOrchestration(queued.run._id, dependencies);
    await runResponderOrchestration(queued.run._id, dependencies);

    expect(searchReadyKnowledge).not.toHaveBeenCalled();
    expect(generateCandidate).not.toHaveBeenCalled();
    expect(handoff).toHaveBeenCalledTimes(1);
    expect(handoff).toHaveBeenCalledWith({
      runId: queued.run._id,
      reason: "limit_workspace_concurrency",
      errorCode: "limit_workspace_concurrency",
      errorMessage: "Automatic answering is temporarily limited.",
    });
    const handedOff = await t.run(async (ctx) => ({
      run: await ctx.db.get("aiRuns", queued.run._id),
      state: await ctx.db
        .query("aiConversationStates")
        .withIndex("by_conversationId", (q) =>
          q.eq("conversationId", queued.conversation._id),
        )
        .unique(),
      messages: await ctx.db
        .query("messages")
        .withIndex("by_conversationId_and_sequence", (q) =>
          q.eq("conversationId", queued.conversation._id),
        )
        .take(10),
    }));
    expect(handedOff.run).toMatchObject({
      status: "handed_off",
      errorCode: "limit_workspace_concurrency",
    });
    expect(handedOff.state).toMatchObject({
      mode: "human",
      attention: "needs_human",
      handoffReason: "limit_workspace_concurrency",
    });
    expect(handedOff.state?.activeRunId).toBeUndefined();
    expect(handedOff.messages).toMatchObject([
      {
        _id: visitorMessage._id,
        author: "visitor",
        body: "Can you help with my order?",
      },
      { author: "assistant", kind: "handoff" },
    ]);

    await expect(
      t.withIdentity(ownerIdentity).mutation(sendOwnerReply, {
        conversationId: queued.conversation._id,
        clientMessageId: "20000000-0000-4000-8000-000000000002",
        body: "I can help from here.",
      }),
    ).resolves.toMatchObject({
      sequence: 3,
      author: "owner",
      body: "I can help from here.",
    });
  });

  test("prepareRetry durably schedules the next responder before returning queued", async () => {
    const t = makeBackend();
    const workspaceId = await createWorkspace(t);
    const fixture = await createConversationWithVisitorMessage(t, workspaceId);
    const runId = await queueSyncAndClaim(
      t,
      fixture.conversationId,
      fixture.messageId,
    );
    const scheduledBefore = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").take(20),
    );

    expect(
      await t.mutation(prepareRetry, {
        runId,
        attempt: 1,
        errorCode: "provider_timeout",
        errorMessage: "The answer provider timed out.",
      }),
    ).toBe(true);

    const snapshot = await t.run(async (ctx) => ({
      run: await ctx.db.get("aiRuns", runId),
      scheduled: await ctx.db.system.query("_scheduled_functions").take(20),
    }));
    expect(snapshot.run).toMatchObject({
      status: "queued",
      attempt: 1,
      dispatchRecoveryCount: 0,
      errorCode: "provider_timeout",
    });
    expect(
      snapshot.scheduled.filter((job) => job.name === "aiResponder:run"),
    ).toHaveLength(
      scheduledBefore.filter((job) => job.name === "aiResponder:run").length + 1,
    );
    expect(
      snapshot.scheduled.filter(
        (job) => job.name === "aiAutomation:recoverQueuedDispatch",
      ),
    ).toHaveLength(
      scheduledBefore.filter(
        (job) => job.name === "aiAutomation:recoverQueuedDispatch",
      ).length + 1,
    );
  });

  test("an initial queued action loss is redispatched by the durable watchdog without spending a provider attempt", async () => {
    vi.useFakeTimers();
    try {
      const t = makeBackend();
      const workspaceId = await createWorkspace(t);
      const fixture = await createConversationWithVisitorMessage(t, workspaceId);
      const queued = await t.mutation(queueVisitor, {
        ...fixture,
        reopened: false,
      });
      if (!queued.queued) throw new Error("Expected a queued responder");
      const initiallyScheduled = await t.run(async (ctx) =>
        ctx.db.system.query("_scheduled_functions").take(20),
      );
      expect(
        initiallyScheduled.filter((job) => job.name === "aiResponder:run"),
      ).toHaveLength(1);
      expect(
        initiallyScheduled.filter(
          (job) => job.name === "aiAutomation:recoverQueuedDispatch",
        ),
      ).toHaveLength(1);

      // The at-most-once action is canceled to model loss before its first
      // claim. The exactly-once scheduled mutation remains live.
      await cancelPendingResponderActions(t);
      vi.advanceTimersByTime(QUEUED_DISPATCH_RECOVERY_DELAY_MS);
      await t.finishInProgressScheduledFunctions();

      const snapshot = await t.run(async (ctx) => ({
        run: await ctx.db.get("aiRuns", queued.runId),
        scheduled: await ctx.db.system.query("_scheduled_functions").take(30),
      }));
      expect(snapshot.run).toMatchObject({
        status: "queued",
        attempt: 0,
        dispatchRecoveryCount: 1,
      });
      expect(
        snapshot.scheduled.filter(
          (job) => job.name === "aiResponder:run" && job.state.kind === "pending",
        ),
      ).toHaveLength(1);
      expect(
        snapshot.scheduled.filter(
          (job) =>
            job.name === "aiAutomation:recoverQueuedDispatch" &&
            job.state.kind === "pending",
        ),
      ).toHaveLength(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  test("a retry queued action loss has its own bounded dispatch recovery budget", async () => {
    vi.useFakeTimers();
    try {
      const t = makeBackend();
      const workspaceId = await createWorkspace(t);
      const fixture = await createConversationWithVisitorMessage(t, workspaceId);
      const runId = await queueSyncAndClaim(
        t,
        fixture.conversationId,
        fixture.messageId,
      );
      expect(
        await t.mutation(prepareRetry, {
          runId,
          attempt: 1,
          errorCode: "provider_timeout",
          errorMessage: "The answer provider timed out.",
        }),
      ).toBe(true);
      await cancelPendingResponderActions(t);

      // This also lets stale initial/running watchdogs fire; their expected
      // attempt/status guards must leave the retry generation alone.
      vi.advanceTimersByTime(QUEUED_DISPATCH_RECOVERY_DELAY_MS + 1_000);
      await t.finishInProgressScheduledFunctions();

      expect(
        await t.run(async (ctx) => ctx.db.get("aiRuns", runId)),
      ).toMatchObject({
        status: "queued",
        attempt: 1,
        dispatchRecoveryCount: 1,
        errorCode: "provider_timeout",
      });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  test("duplicate watchdogs and a live worker converge through the claim guard", async () => {
    const t = makeBackend();
    const workspaceId = await createWorkspace(t);
    const fixture = await createConversationWithVisitorMessage(t, workspaceId);
    const queued = await t.mutation(queueVisitor, {
      ...fixture,
      reopened: false,
    });
    if (!queued.queued) throw new Error("Expected a queued responder");
    expect(await t.mutation(syncNextBatch, { runId: queued.runId })).toMatchObject({
      status: "ready",
    });

    const [, , claim] = await Promise.all([
      t.mutation(recoverQueuedDispatch, {
        runId: queued.runId,
        epoch: queued.epoch,
        expectedAttempt: 0,
        expectedRecoveryCount: 0,
      }),
      t.mutation(recoverQueuedDispatch, {
        runId: queued.runId,
        epoch: queued.epoch,
        expectedAttempt: 0,
        expectedRecoveryCount: 0,
      }),
      t.mutation(claimAttempt, {
        runId: queued.runId,
        expectedAttempt: 0,
      }),
    ]);
    expect(claim).toEqual({ status: "claimed", attempt: 1 });

    await t.mutation(recoverQueuedDispatch, {
      runId: queued.runId,
      epoch: queued.epoch,
      expectedAttempt: 0,
      expectedRecoveryCount: 0,
    });
    const snapshot = await t.run(async (ctx) => ({
      run: await ctx.db.get("aiRuns", queued.runId),
      messages: await ctx.db
        .query("messages")
        .withIndex("by_conversationId_and_sequence", (q) =>
          q.eq("conversationId", fixture.conversationId),
        )
        .take(10),
    }));
    expect(snapshot.run).toMatchObject({ status: "running", attempt: 1 });
    expect(snapshot.run?.dispatchRecoveryCount ?? 0).toBeLessThanOrEqual(1);
    expect(snapshot.messages).toHaveLength(1);
  });

  test("bounded queued dispatch loss hands off once and clears active AI handling", async () => {
    vi.useFakeTimers();
    try {
      const t = makeBackend();
      const workspaceId = await createWorkspace(t);
      const fixture = await createConversationWithVisitorMessage(t, workspaceId);
      const queued = await t.mutation(queueVisitor, {
        ...fixture,
        reopened: false,
      });
      if (!queued.queued) throw new Error("Expected a queued responder");
      await cancelPendingResponderActions(t);

      for (
        let recoveryCount = 0;
        recoveryCount <= MAX_QUEUED_DISPATCH_RECOVERIES;
        recoveryCount += 1
      ) {
        vi.advanceTimersByTime(QUEUED_DISPATCH_RECOVERY_DELAY_MS);
        await t.finishInProgressScheduledFunctions();
        await cancelPendingResponderActions(t);
      }

      const snapshot = await t.run(async (ctx) => ({
        run: await ctx.db.get("aiRuns", queued.runId),
        state: await ctx.db
          .query("aiConversationStates")
          .withIndex("by_conversationId", (q) =>
            q.eq("conversationId", fixture.conversationId),
          )
          .unique(),
        messages: await ctx.db
          .query("messages")
          .withIndex("by_conversationId_and_sequence", (q) =>
            q.eq("conversationId", fixture.conversationId),
          )
          .take(10),
      }));
      expect(snapshot.run).toMatchObject({
        status: "handed_off",
        attempt: 0,
        dispatchRecoveryCount: MAX_QUEUED_DISPATCH_RECOVERIES,
        errorCode: "dispatch_recovery_exhausted",
      });
      expect(snapshot.state).toMatchObject({
        mode: "human",
        attention: "needs_human",
        handoffReason: "dispatch_recovery_exhausted",
      });
      expect(snapshot.state?.activeRunId).toBeUndefined();
      expect(snapshot.messages).toMatchObject([
        { author: "visitor" },
        { author: "assistant", kind: "handoff" },
      ]);

      await t.mutation(recoverQueuedDispatch, {
        runId: queued.runId,
        epoch: queued.epoch,
        expectedAttempt: 0,
        expectedRecoveryCount: MAX_QUEUED_DISPATCH_RECOVERIES,
      });
      expect(
        await t.run(async (ctx) =>
          ctx.db
            .query("messages")
            .withIndex("by_conversationId_and_sequence", (q) =>
              q.eq("conversationId", fixture.conversationId),
            )
            .take(10),
        ),
      ).toHaveLength(2);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  test("the queued watchdog converts a global kill switch into safe disabled attention", async () => {
    const t = makeBackend();
    const workspaceId = await createWorkspace(t);
    const fixture = await createConversationWithVisitorMessage(t, workspaceId);
    const queued = await t.mutation(queueVisitor, {
      ...fixture,
      reopened: false,
    });
    if (!queued.queued) throw new Error("Expected a queued responder");

    vi.stubEnv("AI_AUTOMATION_ENABLED", "false");
    try {
      await t.mutation(recoverQueuedDispatch, {
        runId: queued.runId,
        epoch: queued.epoch,
        expectedAttempt: 0,
        expectedRecoveryCount: 0,
      });
    } finally {
      vi.unstubAllEnvs();
    }

    const snapshot = await t.run(async (ctx) => ({
      run: await ctx.db.get("aiRuns", queued.runId),
      state: await ctx.db
        .query("aiConversationStates")
        .withIndex("by_conversationId", (q) =>
          q.eq("conversationId", fixture.conversationId),
        )
        .unique(),
    }));
    expect(snapshot.run).toMatchObject({
      status: "discarded",
      errorCode: "automation_disabled",
    });
    expect(snapshot.state).toMatchObject({
      mode: "disabled",
      attention: "needs_human",
    });
    expect(snapshot.state?.activeRunId).toBeUndefined();
  });

  test("watchdog callbacks are harmless after takeover, resolve, or supersession", async () => {
    const takeoverBackend = makeBackend();
    const takeoverWorkspace = await createWorkspace(takeoverBackend);
    const takeoverFixture = await createConversationWithVisitorMessage(
      takeoverBackend,
      takeoverWorkspace,
    );
    const takeoverRun = await takeoverBackend.mutation(queueVisitor, {
      ...takeoverFixture,
      reopened: false,
    });
    if (!takeoverRun.queued) throw new Error("Expected takeover run");
    await takeoverBackend.withIdentity(ownerIdentity).mutation(takeOver, {
      conversationId: takeoverFixture.conversationId,
    });
    await takeoverBackend.mutation(recoverQueuedDispatch, {
      runId: takeoverRun.runId,
      epoch: takeoverRun.epoch,
      expectedAttempt: 0,
      expectedRecoveryCount: 0,
    });

    const resolveBackend = makeBackend();
    const resolveWorkspace = await createWorkspace(resolveBackend);
    const resolveFixture = await createConversationWithVisitorMessage(
      resolveBackend,
      resolveWorkspace,
    );
    const resolveRun = await resolveBackend.mutation(queueVisitor, {
      ...resolveFixture,
      reopened: false,
    });
    if (!resolveRun.queued) throw new Error("Expected resolve run");
    await resolveBackend.run(async (ctx) => {
      await invalidateForResolveInTransaction(
        ctx,
        resolveFixture.conversationId,
      );
    });
    await resolveBackend.mutation(recoverQueuedDispatch, {
      runId: resolveRun.runId,
      epoch: resolveRun.epoch,
      expectedAttempt: 0,
      expectedRecoveryCount: 0,
    });

    const supersedeBackend = makeBackend();
    const supersedeWorkspace = await createWorkspace(supersedeBackend);
    const supersedeFixture = await createConversationWithVisitorMessage(
      supersedeBackend,
      supersedeWorkspace,
    );
    const supersededRun = await supersedeBackend.mutation(queueVisitor, {
      ...supersedeFixture,
      reopened: false,
    });
    if (!supersededRun.queued) throw new Error("Expected superseded run");
    const newerMessageId = await appendVisitorMessage(
      supersedeBackend,
      supersedeWorkspace,
      supersedeFixture.conversationId,
      2,
    );
    const currentRun = await supersedeBackend.mutation(queueVisitor, {
      conversationId: supersedeFixture.conversationId,
      messageId: newerMessageId,
      reopened: false,
    });
    if (!currentRun.queued) throw new Error("Expected current run");
    await supersedeBackend.mutation(recoverQueuedDispatch, {
      runId: supersededRun.runId,
      epoch: supersededRun.epoch,
      expectedAttempt: 0,
      expectedRecoveryCount: 0,
    });

    const [takeoverSnapshot, resolveSnapshot, supersedeSnapshot] =
      await Promise.all([
        takeoverBackend.run(async (ctx) => ({
          run: await ctx.db.get("aiRuns", takeoverRun.runId),
          state: await ctx.db
            .query("aiConversationStates")
            .withIndex("by_conversationId", (q) =>
              q.eq("conversationId", takeoverFixture.conversationId),
            )
            .unique(),
        })),
        resolveBackend.run(async (ctx) => ({
          run: await ctx.db.get("aiRuns", resolveRun.runId),
          state: await ctx.db
            .query("aiConversationStates")
            .withIndex("by_conversationId", (q) =>
              q.eq("conversationId", resolveFixture.conversationId),
            )
            .unique(),
        })),
        supersedeBackend.run(async (ctx) => ({
          oldRun: await ctx.db.get("aiRuns", supersededRun.runId),
          current: await ctx.db.get("aiRuns", currentRun.runId),
          state: await ctx.db
            .query("aiConversationStates")
            .withIndex("by_conversationId", (q) =>
              q.eq("conversationId", supersedeFixture.conversationId),
            )
            .unique(),
        })),
      ]);
    expect(takeoverSnapshot.run?.status).toBe("discarded");
    expect(takeoverSnapshot.state).toMatchObject({ mode: "human" });
    expect(resolveSnapshot.run?.status).toBe("discarded");
    expect(resolveSnapshot.state).toMatchObject({ mode: "human" });
    expect(supersedeSnapshot.oldRun?.status).toBe("discarded");
    expect(supersedeSnapshot.current?.status).toBe("queued");
    expect(supersedeSnapshot.state?.activeRunId).toBe(currentRun.runId);
  });

  test("global disable at preflight atomically discards and exposes human attention", async () => {
    const t = makeBackend();
    const workspaceId = await createWorkspace(t);
    const fixture = await createConversationWithVisitorMessage(t, workspaceId);
    const queued = await t.mutation(queueVisitor, {
      ...fixture,
      reopened: false,
    });
    if (!queued.queued) throw new Error("Expected run");

    vi.stubEnv("AI_AUTOMATION_ENABLED", "false");
    try {
      expect(
        await t.mutation(getRunPreflight, { runId: queued.runId }),
      ).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }

    const snapshot = await t.run(async (ctx) => ({
      run: await ctx.db.get("aiRuns", queued.runId),
      state: await ctx.db
        .query("aiConversationStates")
        .withIndex("by_conversationId", (q) =>
          q.eq("conversationId", fixture.conversationId),
        )
        .unique(),
    }));
    expect(snapshot.run?.status).toBe("discarded");
    expect(snapshot.state).toMatchObject({
      mode: "disabled",
      attention: "needs_human",
      handoffReason: "automation_disabled",
    });
    expect(snapshot.state?.activeRunId).toBeUndefined();
  });

  test("global disable at commit cannot leave a running AI state", async () => {
    const t = makeBackend();
    const workspaceId = await createWorkspace(t);
    const fixture = await createConversationWithVisitorMessage(t, workspaceId);
    const documentId = await addReadyKnowledge(t, workspaceId);
    const runId = await queueSyncAndClaim(
      t,
      fixture.conversationId,
      fixture.messageId,
    );

    vi.stubEnv("AI_AUTOMATION_ENABLED", "false");
    try {
      expect(
        await t.mutation(commitCandidate, {
          runId,
          attempt: 1,
          segments: [groundedSegmentFor(evidenceFor(documentId))],
          evidence: [evidenceFor(documentId)],
        }),
      ).toEqual({ status: "stale" });
    } finally {
      vi.unstubAllEnvs();
    }

    const snapshot = await t.run(async (ctx) => ({
      run: await ctx.db.get("aiRuns", runId),
      state: await ctx.db
        .query("aiConversationStates")
        .withIndex("by_conversationId", (q) =>
          q.eq("conversationId", fixture.conversationId),
        )
        .unique(),
    }));
    expect(snapshot.run?.status).toBe("discarded");
    expect(snapshot.state).toMatchObject({
      mode: "disabled",
      attention: "needs_human",
    });
    expect(snapshot.state?.activeRunId).toBeUndefined();
  });

  test("coalesces duplicate queueing and supersedes an older visitor run", async () => {
    const t = makeBackend();
    const workspaceId = await createWorkspace(t);
    const first = await createConversationWithVisitorMessage(t, workspaceId);
    const queued = await t.mutation(queueVisitor, {
      ...first,
      reopened: false,
    });
    const duplicate = await t.mutation(queueVisitor, {
      ...first,
      reopened: false,
    });
    expect(duplicate).toEqual(queued);

    const secondMessageId = await appendVisitorMessage(
      t,
      workspaceId,
      first.conversationId,
      2,
    );
    const newer = await t.mutation(queueVisitor, {
      conversationId: first.conversationId,
      messageId: secondMessageId,
      reopened: false,
    });
    expect(newer.queued).toBe(true);

    const runs = await t.run(async (ctx) =>
      ctx.db
        .query("aiRuns")
        .withIndex("by_conversationId_and_createdAt", (q) =>
          q.eq("conversationId", first.conversationId),
        )
        .take(10),
    );
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.status)).toEqual(["discarded", "queued"]);
  });

  test("atomically accepts canonical answer, citations, Agent link, and exact usage once", async () => {
    const t = makeBackend();
    const workspaceId = await createWorkspace(t);
    const fixture = await createConversationWithVisitorMessage(t, workspaceId);
    const knowledgeDocumentId = await addReadyKnowledge(t, workspaceId);
    const runId = await queueSyncAndClaim(
      t,
      fixture.conversationId,
      fixture.messageId,
    );
    const evidence = evidenceFor(knowledgeDocumentId);

    const first = await t.mutation(commitCandidate, {
      runId,
      attempt: 1,
      segments: [groundedSegmentFor(evidence)],
      evidence: [evidence],
    });
    expect(first.status).toBe("accepted");
    expect(
      await t.mutation(commitCandidate, {
        runId,
        attempt: 1,
        segments: [groundedSegmentFor(evidence)],
        evidence: [evidence],
      }),
    ).toEqual({ status: "stale" });

    const usage = {
      runId,
      attempt: 1,
      provider: "convexGateway.chat",
      model: "openai/gpt-5.6-terra",
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
    };
    await t.mutation(recordUsage, usage);
    await t.mutation(recordUsage, usage);

    const snapshot = await t.run(async (ctx) => ({
      messages: await ctx.db
        .query("messages")
        .withIndex("by_conversationId_and_sequence", (q) =>
          q.eq("conversationId", fixture.conversationId),
        )
        .take(10),
      links: await ctx.db
        .query("messageAgentLinks")
        .withIndex("by_conversationId_and_sequence", (q) =>
          q.eq("conversationId", fixture.conversationId),
        )
        .take(10),
      citations: await ctx.db
        .query("aiCitations")
        .withIndex("by_workspaceId_and_messageId", (q) =>
          q.eq("workspaceId", workspaceId),
        )
        .take(10),
      usage: await ctx.db
        .query("aiUsageRecords")
        .withIndex("by_runId_and_attempt", (q) => q.eq("runId", runId))
        .take(10),
      aggregates: await ctx.db
        .query("workspaceAiUsage")
        .withIndex("by_workspaceId_and_period", (q) =>
          q.eq("workspaceId", workspaceId),
        )
        .take(10),
    }));
    expect(snapshot.messages.map((message) => message.author)).toEqual([
      "visitor",
      "assistant",
    ]);
    expect(snapshot.links).toHaveLength(2);
    expect(snapshot.citations).toHaveLength(1);
    expect(snapshot.citations[0]).toMatchObject({
      citationId: evidence.citationId,
      segmentIndex: 0,
      segmentText: evidence.excerpt,
      supportingQuote: evidence.excerpt,
      excerpt: evidence.excerpt,
    });
    expect(snapshot.usage).toHaveLength(1);
    expect(snapshot.aggregates).toHaveLength(2);
    expect(snapshot.aggregates.every((row) => row.requests === 1)).toBe(true);
  });

  test("rejects cross-workspace citations before any canonical answer is written", async () => {
    const t = makeBackend();
    const workspaceA = await createWorkspace(t, "a");
    const workspaceB = await createWorkspace(t, "b");
    const fixture = await createConversationWithVisitorMessage(t, workspaceA);
    const otherDocument = await addReadyKnowledge(t, workspaceB, "b");
    const runId = await queueSyncAndClaim(
      t,
      fixture.conversationId,
      fixture.messageId,
    );
    expect(
      await t.mutation(commitCandidate, {
        runId,
        attempt: 1,
        segments: [
          groundedSegmentFor(evidenceFor(otherDocument, "b")),
        ],
        evidence: [evidenceFor(otherDocument, "b")],
      }),
    ).toEqual({ status: "invalid_evidence" });
    const messages = await t.run(async (ctx) =>
      ctx.db
        .query("messages")
        .withIndex("by_conversationId_and_sequence", (q) =>
          q.eq("conversationId", fixture.conversationId),
        )
        .take(10),
    );
    expect(messages).toHaveLength(1);
  });

  test("rejects contradictory segment prose even when its citation and quote are valid", async () => {
    const t = makeBackend();
    const workspaceId = await createWorkspace(t);
    const fixture = await createConversationWithVisitorMessage(t, workspaceId);
    const documentId = await addReadyKnowledge(t, workspaceId);
    const evidence = evidenceFor(documentId);
    const runId = await queueSyncAndClaim(
      t,
      fixture.conversationId,
      fixture.messageId,
    );

    expect(
      await t.mutation(commitCandidate, {
        runId,
        attempt: 1,
        segments: [
          groundedSegmentFor(
            evidence,
            "Returns are accepted for 90 days.",
          ),
        ],
        evidence: [evidence],
      }),
    ).toEqual({ status: "invalid_evidence" });
    expect(
      await t.run(async (ctx) =>
        ctx.db
          .query("messages")
          .withIndex("by_conversationId_and_sequence", (q) =>
            q.eq("conversationId", fixture.conversationId),
          )
          .take(10),
      ),
    ).toHaveLength(1);
  });

  test("owner takeover defeats a claimed candidate; resume creates a fresh epoch", async () => {
    const t = makeBackend();
    const workspaceId = await createWorkspace(t);
    const fixture = await createConversationWithVisitorMessage(t, workspaceId);
    const documentId = await addReadyKnowledge(t, workspaceId);
    const runId = await queueSyncAndClaim(
      t,
      fixture.conversationId,
      fixture.messageId,
    );

    await t.withIdentity(ownerIdentity).mutation(takeOver, {
      conversationId: fixture.conversationId,
    });
    await t.run(async (ctx) => {
      const state = await ctx.db
        .query("aiConversationStates")
        .withIndex("by_conversationId", (q) =>
          q.eq("conversationId", fixture.conversationId),
        )
        .unique();
      if (!state) throw new Error("Expected automation state");
      await ctx.db.patch("aiConversationStates", state._id, {
        consecutiveAiFailures: 2,
      });
    });
    expect(
      await t.mutation(commitCandidate, {
        runId,
        attempt: 1,
        segments: [groundedSegmentFor(evidenceFor(documentId))],
        evidence: [evidenceFor(documentId)],
      }),
    ).toEqual({ status: "stale" });
    const resumed = await t.withIdentity(ownerIdentity).mutation(resumeAi, {
      conversationId: fixture.conversationId,
    });
    expect(resumed).toEqual({ queued: true });
    const state = await t.run(async (ctx) =>
      ctx.db
        .query("aiConversationStates")
        .withIndex("by_conversationId", (q) =>
          q.eq("conversationId", fixture.conversationId),
        )
        .unique(),
    );
    expect(state).toMatchObject({
      mode: "ai",
      generationEpoch: 3,
      consecutiveAiFailures: 0,
    });
  });

  test("resume after an owner answer only enables AI for the next visitor", async () => {
    const t = makeBackend();
    const workspaceId = await createWorkspace(t);
    const fixture = await createConversationWithVisitorMessage(t, workspaceId);
    const queued = await t.mutation(queueVisitor, {
      ...fixture,
      reopened: false,
    });
    if (!queued.queued) throw new Error("Expected run");
    await t.withIdentity(ownerIdentity).mutation(takeOver, {
      conversationId: fixture.conversationId,
    });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("messages", {
        workspaceId,
        conversationId: fixture.conversationId,
        sequence: 2,
        author: "owner",
        body: "A human already answered.",
        clientMessageId: "00000000-0000-4000-8000-000000000002",
        createdAt: now,
      });
      await ctx.db.patch("conversations", fixture.conversationId, {
        updatedAt: now,
        lastMessageAt: now,
        lastMessageAuthor: "owner",
        lastMessageBody: "A human already answered.",
        lastMessageSequence: 2,
      });
    });

    expect(
      await t.withIdentity(ownerIdentity).mutation(resumeAi, {
        conversationId: fixture.conversationId,
      }),
    ).toEqual({ queued: false });
    const snapshot = await t.run(async (ctx) => ({
      state: await ctx.db
        .query("aiConversationStates")
        .withIndex("by_conversationId", (q) =>
          q.eq("conversationId", fixture.conversationId),
        )
        .unique(),
      runs: await ctx.db
        .query("aiRuns")
        .withIndex("by_conversationId_and_createdAt", (q) =>
          q.eq("conversationId", fixture.conversationId),
        )
        .take(10),
    }));
    expect(snapshot.state).toMatchObject({ mode: "ai" });
    expect(snapshot.state?.activeRunId).toBeUndefined();
    expect(snapshot.runs).toHaveLength(1);
  });

  test("disabling the workspace kill switch proactively discards claimed work", async () => {
    const t = makeBackend();
    const workspaceId = await createWorkspace(t);
    const fixture = await createConversationWithVisitorMessage(t, workspaceId);
    const queued = await t.mutation(queueVisitor, {
      ...fixture,
      reopened: false,
    });
    if (!queued.queued) throw new Error("Expected run");
    await t.mutation(syncNextBatch, { runId: queued.runId });
    expect(
      await t.mutation(claimAttempt, {
        runId: queued.runId,
        expectedAttempt: 0,
      }),
    ).toEqual({ status: "claimed", attempt: 1 });
    await t.withIdentity(ownerIdentity).mutation(configureAi, {
      enabled: false,
      handoffMessage: "A human will continue here.",
    });
    const immediately = await t.run(async (ctx) => ({
      run: await ctx.db.get("aiRuns", queued.runId),
      state: await ctx.db
        .query("aiConversationStates")
        .withIndex("by_conversationId", (q) =>
          q.eq("conversationId", fixture.conversationId),
        )
        .unique(),
    }));
    expect(immediately.run?.status).toBe("discarded");
    expect(immediately.state).toMatchObject({
      mode: "disabled",
      attention: "needs_human",
    });
    expect(immediately.state?.activeRunId).toBeUndefined();
    expect(
      await t.mutation(enforceRunKillSwitch, { runId: queued.runId }),
    ).toBe(false);
    const snapshot = await t.run(async (ctx) => ({
      run: await ctx.db.get("aiRuns", queued.runId),
      state: await ctx.db
        .query("aiConversationStates")
        .withIndex("by_conversationId", (q) =>
          q.eq("conversationId", fixture.conversationId),
        )
        .unique(),
    }));
    expect(snapshot.run?.status).toBe("discarded");
    expect(snapshot.state).toMatchObject({
      mode: "disabled",
      attention: "needs_human",
    });
    expect(snapshot.state?.activeRunId).toBeUndefined();
  });

  test("disabling a workspace clears a stale active-run association", async () => {
    const t = makeBackend();
    const workspaceId = await createWorkspace(t);
    const fixture = await createConversationWithVisitorMessage(t, workspaceId);
    const runId = await t.run(async (ctx) => {
      const now = Date.now();
      const insertedRunId = await ctx.db.insert("aiRuns", {
        workspaceId,
        conversationId: fixture.conversationId,
        triggerMessageId: fixture.messageId,
        epoch: 1,
        status: "queued",
        model: "openai/gpt-5.6-terra",
        attempt: 0,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("aiConversationStates", {
        workspaceId,
        conversationId: fixture.conversationId,
        mode: "ai",
        attention: "none",
        generationEpoch: 2,
        activeRunId: insertedRunId,
        syncedThroughSequence: 0,
        createdAt: now,
        updatedAt: now,
      });
      return insertedRunId;
    });

    await t.withIdentity(ownerIdentity).mutation(configureAi, {
      enabled: false,
      handoffMessage: "A human will continue here.",
    });

    const snapshot = await t.run(async (ctx) => ({
      run: await ctx.db.get("aiRuns", runId),
      state: await ctx.db
        .query("aiConversationStates")
        .withIndex("by_conversationId", (q) =>
          q.eq("conversationId", fixture.conversationId),
        )
        .unique(),
    }));
    expect(snapshot.run?.status).toBe("discarded");
    expect(snapshot.state).toMatchObject({
      mode: "disabled",
      attention: "needs_human",
      handoffReason: "automation_disabled",
    });
    expect(snapshot.state?.activeRunId).toBeUndefined();
  });

  test("disabling a workspace also removes idle AI-handling state", async () => {
    const t = makeBackend();
    const workspaceId = await createWorkspace(t);
    const fixture = await createConversationWithVisitorMessage(t, workspaceId);
    const documentId = await addReadyKnowledge(t, workspaceId);
    const runId = await queueSyncAndClaim(
      t,
      fixture.conversationId,
      fixture.messageId,
    );
    expect(
      await t.mutation(commitCandidate, {
        runId,
        attempt: 1,
        segments: [groundedSegmentFor(evidenceFor(documentId))],
        evidence: [evidenceFor(documentId)],
      }),
    ).toMatchObject({ status: "accepted" });

    await t.withIdentity(ownerIdentity).mutation(configureAi, {
      enabled: false,
      handoffMessage: "A human will continue here.",
    });
    const state = await t.run(async (ctx) =>
      ctx.db
        .query("aiConversationStates")
        .withIndex("by_conversationId", (q) =>
          q.eq("conversationId", fixture.conversationId),
        )
        .unique(),
    );
    expect(state).toMatchObject({ mode: "disabled", attention: "none" });
    expect(state?.activeRunId).toBeUndefined();
  });

  test("disabled automation acknowledges the visitor once and exposes safe owner settings", async () => {
    const t = makeBackend();
    const workspaceId = await createWorkspace(t);
    await t.withIdentity(ownerIdentity).mutation(configureAi, {
      enabled: false,
      handoffMessage: "A human will continue here.",
    });
    expect(await t.withIdentity(ownerIdentity).query(getAiSettings, {})).toMatchObject({
      enabled: false,
      globalAvailable: true,
      effectiveEnabled: false,
      answerModel: "openai/gpt-5.6-terra",
    });
    const fixture = await createConversationWithVisitorMessage(t, workspaceId);
    expect(
      await t.mutation(queueVisitor, { ...fixture, reopened: false }),
    ).toEqual({ queued: false, reason: "disabled" });
    expect(
      await t.mutation(queueVisitor, { ...fixture, reopened: false }),
    ).toEqual({ queued: false, reason: "disabled" });
    const snapshot = await t.run(async (ctx) => ({
      messages: await ctx.db
        .query("messages")
        .withIndex("by_conversationId_and_sequence", (q) =>
          q.eq("conversationId", fixture.conversationId),
        )
        .take(10),
      state: await ctx.db
        .query("aiConversationStates")
        .withIndex("by_conversationId", (q) =>
          q.eq("conversationId", fixture.conversationId),
        )
        .unique(),
    }));
    expect(snapshot.messages).toHaveLength(2);
    expect(snapshot.messages[1]).toMatchObject({
      author: "assistant",
      kind: "handoff",
      body: "A human will continue here.",
    });
    expect(snapshot.state).toMatchObject({
      mode: "disabled",
      attention: "needs_human",
      handoffReason: "automation_disabled",
    });
  });

  test("resolve invalidates work, while a reopened visitor message starts a fresh AI run", async () => {
    const t = makeBackend();
    const workspaceId = await createWorkspace(t);
    const fixture = await createConversationWithVisitorMessage(t, workspaceId);
    const first = await t.mutation(queueVisitor, {
      ...fixture,
      reopened: false,
    });
    if (!first.queued) throw new Error("Expected first run");
    await t.run(async (ctx) => {
      await invalidateForResolveInTransaction(ctx, fixture.conversationId);
      await ctx.db.patch("conversations", fixture.conversationId, {
        status: "resolved",
        resolvedAt: Date.now(),
      });
    });
    const secondMessageId = await appendVisitorMessage(
      t,
      workspaceId,
      fixture.conversationId,
      2,
    );
    const reopened = await t.mutation(queueVisitor, {
      conversationId: fixture.conversationId,
      messageId: secondMessageId,
      reopened: true,
    });
    expect(reopened.queued).toBe(true);
    const firstRun = await t.run(async (ctx) => ctx.db.get("aiRuns", first.runId));
    expect(firstRun?.status).toBe("discarded");
  });

  test("three consecutive unanswered requests retry twice and then hand off exactly once", async () => {
    const t = makeBackend();
    const workspaceId = await createWorkspace(t);
    const fixture = await createConversationWithVisitorMessage(t, workspaceId);

    const respondToFailure = async (messageId: MessageId) => {
      const queued = await t.mutation(queueVisitor, {
        conversationId: fixture.conversationId,
        messageId,
        reopened: false,
      });
      if (!queued.queued) throw new Error("Expected run");
      await t.mutation(syncNextBatch, { runId: queued.runId });
      const result = await t.mutation(handoffRun, {
        runId: queued.runId,
        reason: "no_ready_or_relevant_knowledge",
      });
      return { result, runId: queued.runId };
    };

    const first = await respondToFailure(fixture.messageId);
    expect(first.result).toMatchObject({
      status: "responded",
      consecutiveFailures: 1,
    });
    const secondMessageId = await appendVisitorMessage(
      t,
      workspaceId,
      fixture.conversationId,
      3,
    );
    const second = await respondToFailure(secondMessageId);
    expect(second.result).toMatchObject({
      status: "responded",
      consecutiveFailures: 2,
    });
    const thirdMessageId = await appendVisitorMessage(
      t,
      workspaceId,
      fixture.conversationId,
      5,
    );
    const third = await respondToFailure(thirdMessageId);
    expect(third.result.status).toBe("handed_off");
    expect(
      await t.mutation(handoffRun, {
        runId: third.runId,
        reason: "duplicate",
      }),
    ).toEqual({ status: "stale" });
    const result = await t.run(async (ctx) => ({
      messages: await ctx.db
        .query("messages")
        .withIndex("by_conversationId_and_sequence", (q) =>
          q.eq("conversationId", fixture.conversationId),
        )
        .take(10),
      state: await ctx.db
        .query("aiConversationStates")
        .withIndex("by_conversationId", (q) =>
          q.eq("conversationId", fixture.conversationId),
        )
        .unique(),
    }));
    expect(
      result.messages
        .filter((message) => message.author === "assistant")
        .map((message) => message.kind),
    ).toEqual(["ai_answer", "ai_answer", "handoff"]);
    expect(result.state).toMatchObject({
      mode: "human",
      attention: "needs_human",
      consecutiveAiFailures: 3,
    });
  });

  test("a greeting gets an AI reply without incrementing failures", async () => {
    const t = makeBackend();
    const workspaceId = await createWorkspace(t);
    const fixture = await createConversationWithVisitorMessage(t, workspaceId);
    const queued = await t.mutation(queueVisitor, {
      ...fixture,
      reopened: false,
    });
    if (!queued.queued) throw new Error("Expected run");
    await t.mutation(syncNextBatch, { runId: queued.runId });
    const greeting = await t.mutation(handoffRun, {
      runId: queued.runId,
      reason: "greeting",
    });
    expect(greeting).toMatchObject({
      status: "responded",
      consecutiveFailures: 0,
    });
    const state = await t.run(async (ctx) =>
      ctx.db
        .query("aiConversationStates")
        .withIndex("by_conversationId", (q) =>
          q.eq("conversationId", fixture.conversationId),
        )
        .unique(),
    );
    expect(state).toMatchObject({
      mode: "ai",
      attention: "none",
      consecutiveAiFailures: 0,
    });
  });
});
