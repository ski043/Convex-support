/// <reference types="vite/client" />

import agentTest from "@convex-dev/agent/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { makeFunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { components } from "./_generated/api";
import type { QueueVisitorResult } from "./aiAutomation";
import type { GroundedAnswerSegment, RetrievedEvidence } from "./aiModel";
import { knowledgeNamespace } from "./knowledgeModel";
import schema from "./schema";
import { getWidgetOriginPolicy } from "./widgetBootstrap";
import { getRecentWidgetOriginObservations } from "./widgetSettings";
import {
  clearWidgetOriginObservations,
  MAX_WIDGET_ORIGIN_OBSERVATIONS_PER_WORKSPACE,
  recordWidgetOriginObservation,
} from "./widgetOriginModel";

const modules = import.meta.glob("./**/*.ts");

type WorkspaceId = GenericId<"workspaces">;
type ConversationId = GenericId<"conversations">;
type MessageId = GenericId<"messages">;
type RunId = GenericId<"aiRuns">;
type KnowledgeDocumentId = GenericId<"knowledgeDocuments">;

type MessageItem = {
  _id: MessageId;
  sequence: number;
  author: "visitor" | "owner" | "assistant" | "system";
  body: string;
  createdAt: number;
};

type ConversationItem = {
  _id: ConversationId;
  attentionState: "none" | "needs_human";
  handlingState:
    | "ai_handling"
    | "needs_human"
    | "human_handling"
    | "resolved";
};

type Page<T> = {
  page: T[];
  isDone: boolean;
  continueCursor: string;
};

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

const sendReply = makeFunctionReference<
  "mutation",
  { conversationId: ConversationId; clientMessageId: string; body: string },
  MessageItem
>("inbox:sendReply");

const listCitations = makeFunctionReference<
  "query",
  { messageId: MessageId },
  Array<{
    documentTitle: string;
    pageNumber?: number;
    heading?: string;
    segmentIndex?: number;
    segmentText?: string;
    supportingQuote?: string;
    excerpt: string;
  }>
>("inbox:listCitations");

const listNeedsHuman = makeFunctionReference<
  "query",
  { paginationOpts: { numItems: number; cursor: string | null } },
  Page<ConversationItem>
>("inbox:listNeedsHuman");

const listWidgetMessages = makeFunctionReference<
  "query",
  {
    workspaceId: WorkspaceId;
    token: string;
    paginationOpts: { numItems: number; cursor: string | null };
  },
  Page<MessageItem>
>("widgetChat:listMessages");

const getWidgetConfig = makeFunctionReference<
  "query",
  { workspaceId: WorkspaceId },
  null | {
    displayName: string;
    greeting: string;
    theme: "blue" | "green" | "red" | "amber" | "zinc";
    position: "bottomLeft" | "bottomRight";
  }
>("widgetChat:getConfig");

const getWidgetAutomationState = makeFunctionReference<
  "query",
  { workspaceId: WorkspaceId; token: string },
  { isAiTyping: boolean; handling: "ai" | "human"; needsHuman: boolean }
>("widgetChat:getAutomationState");

const continueClearWidgetOriginObservations = makeFunctionReference<
  "mutation",
  {
    workspaceId: WorkspaceId;
    clearThroughLastSeenAt: number;
    clearThroughCreationTime: number;
  },
  null
>("widgetSettings:continueClearWidgetOriginObservations");

const removeKnowledge = makeFunctionReference<
  "mutation",
  { documentId: KnowledgeDocumentId },
  null
>("knowledge:remove");

const beginKnowledgeProcessing = makeFunctionReference<
  "mutation",
  { documentId: KnowledgeDocumentId },
  null | {
    documentId: KnowledgeDocumentId;
    processingToken: string;
  }
>("knowledge:beginProcessing");

const completeKnowledgeEntry = makeFunctionReference<
  "mutation",
  {
    documentId: KnowledgeDocumentId;
    processingToken: string;
    ragEntryId: string;
    replacedRagEntryId: string | null;
  },
  null
>("knowledge:completeExistingEntry");

const getReadyDocuments = makeFunctionReference<
  "query",
  { workspaceId: WorkspaceId; ragEntryIds: string[] },
  Array<{
    knowledgeDocumentId: KnowledgeDocumentId;
    ragEntryId: string;
    documentTitle: string;
  }>
>("knowledgeInternal:getReadyDocumentsByRagIds");

const page = { numItems: 50, cursor: null };
const ownerA = {
  subject: "verification-owner-a",
  issuer: "https://auth.example.test",
  tokenIdentifier: "https://auth.example.test|verification-owner-a",
};
const ownerB = {
  subject: "verification-owner-b",
  issuer: "https://auth.example.test",
  tokenIdentifier: "https://auth.example.test|verification-owner-b",
};

function backend() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  rateLimiterTest.register(t);
  return t;
}

async function registerRagTest(t: TestBackend) {
  // The package exposes its test harness as TypeScript source. A non-literal
  // import keeps that dependency's lower-target test sources out of app tsc,
  // while Vitest still loads the official component harness at runtime.
  const testHarnessModule = "@convex-dev/rag/test";
  const ragTest = (await import(/* @vite-ignore */ testHarnessModule)) as {
    default: { register(testBackend: TestBackend): void };
  };
  ragTest.default.register(t);
}

type TestBackend = ReturnType<typeof backend>;

async function createWorkspace(
  t: TestBackend,
  identity: typeof ownerA,
  suffix: string,
) {
  return await t.run(async (ctx) => {
    const workspaceId = await ctx.db.insert("workspaces", {
      name: `Verification ${suffix}`,
      ownerAuthUserId: `legacy-${suffix}`,
      ownerTokenIdentifier: identity.tokenIdentifier,
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

async function createConversation(
  t: TestBackend,
  workspaceId: WorkspaceId,
  suffix: string,
  lastAuthor: "visitor" | "owner" = "visitor",
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const visitorId = await ctx.db.insert("visitors", {
      workspaceId,
      capabilityToken: suffix.padEnd(64, suffix).slice(0, 64),
      capabilityExpiresAt: now + 60_000,
      capabilityExpired: false,
      createdAt: now,
      lastSeenAt: now,
    });
    const body = lastAuthor === "visitor" ? "Can you help?" : "I can help.";
    const conversationId = await ctx.db.insert("conversations", {
      workspaceId,
      visitorId,
      status: "open",
      hasMessages: true,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
      lastMessageAt: now,
      lastMessageAuthor: lastAuthor,
      lastMessageBody: body,
      lastMessageSequence: 1,
      unreadCount: lastAuthor === "visitor" ? 1 : 0,
    });
    const messageId = await ctx.db.insert("messages", {
      workspaceId,
      conversationId,
      sequence: 1,
      author: lastAuthor,
      body,
      clientMessageId: `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`,
      createdAt: now,
    });
    return { visitorId, conversationId, messageId };
  });
}

async function addReadyKnowledge(
  t: TestBackend,
  workspaceId: WorkspaceId,
  suffix: string,
  ragEntryId = `rag-${suffix}`,
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const storageId = await ctx.storage.store(
      new Blob(["Returns are accepted for 30 days."], { type: "text/plain" }),
    );
    const documentId = await ctx.db.insert("knowledgeDocuments", {
      workspaceId,
      storageId,
      clientRequestId: `knowledge-${suffix}`,
      stableKey: `knowledge:${suffix}`,
      version: 1,
      filename: "returns.txt",
      title: "Returns policy",
      mimeType: "text/plain",
      fileKind: "text",
      size: 33,
      sha256: suffix.repeat(64).slice(0, 64),
      status: "ready",
      ragEntryId,
      attempt: 1,
      createdAt: now,
      updatedAt: now,
      readyAt: now,
    });
    return { documentId, storageId };
  });
}

describe("public owner mutations and stale generation guards", () => {
  test("inbox.sendReply implicitly takes over before a late candidate can commit", async () => {
    const t = backend();
    const workspaceId = await createWorkspace(t, ownerA, "reply");
    const fixture = await createConversation(t, workspaceId, "1");
    const knowledge = await addReadyKnowledge(t, workspaceId, "reply");
    const queued = await t.mutation(queueVisitor, {
      conversationId: fixture.conversationId,
      messageId: fixture.messageId,
      reopened: false,
    });
    if (!queued.queued) throw new Error("Expected an AI run");
    expect(await t.mutation(syncNextBatch, { runId: queued.runId })).toMatchObject({
      status: "ready",
    });
    expect(
      await t.mutation(claimAttempt, {
        runId: queued.runId,
        expectedAttempt: 0,
      }),
    ).toEqual({ status: "claimed", attempt: 1 });

    const reply = await t.withIdentity(ownerA).mutation(sendReply, {
      conversationId: fixture.conversationId,
      clientMessageId: "20000000-0000-4000-8000-000000000001",
      body: "A human is taking this one.",
    });
    expect(reply).toMatchObject({ author: "owner", sequence: 2 });

    const evidence: RetrievedEvidence = {
      citationId: "returns:0",
      knowledgeDocumentId: knowledge.documentId,
      ragEntryId: "rag-reply",
      chunkOrder: 0,
      documentTitle: "Returns policy",
      excerpt: "Returns are accepted for 30 days.",
      score: 0.95,
    };
    expect(
      await t.mutation(commitCandidate, {
        runId: queued.runId,
        attempt: 1,
        segments: [
          {
            text: evidence.excerpt,
            citationId: evidence.citationId,
            supportingQuote: evidence.excerpt,
          },
        ],
        evidence: [evidence],
      }),
    ).toEqual({ status: "stale" });

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
    expect(snapshot.run?.status).toBe("discarded");
    expect(snapshot.state).toMatchObject({
      mode: "human",
      attention: "none",
      generationEpoch: 2,
    });
    expect(snapshot.state?.activeRunId).toBeUndefined();
    expect(snapshot.messages.map((message) => message.author)).toEqual([
      "visitor",
      "owner",
    ]);
  });

  test("takeover, resume, and AI settings enforce owner and workspace boundaries", async () => {
    const t = backend();
    const workspaceA = await createWorkspace(t, ownerA, "auth-a");
    const workspaceB = await createWorkspace(t, ownerB, "auth-b");
    const conversationA = await createConversation(t, workspaceA, "2", "owner");
    const conversationB = await createConversation(t, workspaceB, "3", "owner");
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("aiConversationStates", {
        workspaceId: workspaceA,
        conversationId: conversationA.conversationId,
        mode: "ai",
        attention: "none",
        generationEpoch: 1,
        syncedThroughSequence: 1,
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(
      t.mutation(takeOver, { conversationId: conversationA.conversationId }),
    ).rejects.toThrow(/Authentication required/);
    await expect(
      t.mutation(resumeAi, { conversationId: conversationA.conversationId }),
    ).rejects.toThrow(/Authentication required/);
    await expect(t.query(getAiSettings, {})).rejects.toThrow(
      /Authentication required/,
    );
    await expect(
      t.mutation(configureAi, {
        enabled: false,
        handoffMessage: "A human will continue here.",
      }),
    ).rejects.toThrow(/Authentication required/);

    await expect(
      t.withIdentity(ownerB).mutation(takeOver, {
        conversationId: conversationA.conversationId,
      }),
    ).rejects.toThrow(/Conversation not found/);
    await expect(
      t.withIdentity(ownerA).mutation(resumeAi, {
        conversationId: conversationB.conversationId,
      }),
    ).rejects.toThrow(/Conversation not found/);

    await t.withIdentity(ownerA).mutation(takeOver, {
      conversationId: conversationA.conversationId,
    });
    expect(
      await t.withIdentity(ownerA).mutation(resumeAi, {
        conversationId: conversationA.conversationId,
      }),
    ).toEqual({ queued: false });
    await t.withIdentity(ownerA).mutation(configureAi, {
      enabled: false,
      handoffMessage: "  A verified human will continue here.  ",
    });
    expect(await t.withIdentity(ownerA).query(getAiSettings, {})).toMatchObject({
      enabled: false,
      effectiveEnabled: false,
      handoffMessage: "A verified human will continue here.",
    });
    expect(await t.withIdentity(ownerB).query(getAiSettings, {})).toMatchObject({
      enabled: true,
      handoffMessage: "A human will continue here.",
    });
  });
});

describe("citation privacy and the needs-human projection", () => {
  test("only the owning dashboard receives safe citations while widget DTOs stay minimal", async () => {
    const t = backend();
    const workspaceA = await createWorkspace(t, ownerA, "citation-a");
    await createWorkspace(t, ownerB, "citation-b");
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const visitorId = await ctx.db.insert("visitors", {
        workspaceId: workspaceA,
        capabilityToken: "c".repeat(64),
        capabilityExpiresAt: now + 60_000,
        capabilityExpired: false,
        createdAt: now,
        lastSeenAt: now,
      });
      const conversationId = await ctx.db.insert("conversations", {
        workspaceId: workspaceA,
        visitorId,
        status: "open",
        hasMessages: true,
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
        lastMessageAt: now,
        lastMessageAuthor: "assistant",
        lastMessageBody: "You can return it within 30 days.",
        lastMessageSequence: 2,
        unreadCount: 0,
      });
      const triggerMessageId = await ctx.db.insert("messages", {
        workspaceId: workspaceA,
        conversationId,
        sequence: 1,
        author: "visitor",
        body: "Can I return this?",
        clientMessageId: "30000000-0000-4000-8000-000000000001",
        createdAt: now - 1,
      });
      const runId = await ctx.db.insert("aiRuns", {
        workspaceId: workspaceA,
        conversationId,
        triggerMessageId,
        epoch: 1,
        status: "accepted",
        model: "openai/gpt-5.6-terra",
        attempt: 1,
        createdAt: now,
        updatedAt: now,
        finishedAt: now,
      });
      const assistantMessageId = await ctx.db.insert("messages", {
        workspaceId: workspaceA,
        conversationId,
        sequence: 2,
        author: "assistant",
        body: "You can return it within 30 days.",
        clientMessageId: "ai-answer:verification-citation",
        kind: "ai_answer",
        aiRunId: runId,
        createdAt: now,
      });
      const storageId = await ctx.storage.store(
        new Blob(["Return policy"], { type: "text/plain" }),
      );
      const knowledgeDocumentId = await ctx.db.insert("knowledgeDocuments", {
        workspaceId: workspaceA,
        storageId,
        clientRequestId: "citation-document",
        stableKey: "citation-document",
        version: 1,
        filename: "returns.txt",
        title: "Returns policy",
        mimeType: "text/plain",
        fileKind: "text",
        size: 13,
        sha256: "c".repeat(64),
        status: "ready",
        ragEntryId: "rag-private-id",
        attempt: 1,
        createdAt: now,
        updatedAt: now,
        readyAt: now,
      });
      await ctx.db.insert("aiCitations", {
        workspaceId: workspaceA,
        conversationId,
        messageId: assistantMessageId,
        knowledgeDocumentId,
        ragEntryId: "rag-private-id",
        chunkOrder: 7,
        documentTitle: "Returns policy",
        pageNumber: 4,
        heading: "Refunds",
        excerpt: "Unused items may be returned within 30 days.",
        score: 0.93,
        createdAt: now,
      });
      return {
        visitorId,
        conversationId,
        assistantMessageId,
        runId,
        storageId,
        knowledgeDocumentId,
      };
    });

    const citations = await t.withIdentity(ownerA).query(listCitations, {
      messageId: seeded.assistantMessageId,
    });
    expect(citations).toEqual([
      {
        documentTitle: "Returns policy",
        pageNumber: 4,
        heading: "Refunds",
        excerpt: "Unused items may be returned within 30 days.",
      },
    ]);
    expect(Object.keys(citations[0]).sort()).toEqual([
      "documentTitle",
      "excerpt",
      "heading",
      "pageNumber",
    ]);
    await expect(
      t.query(listCitations, { messageId: seeded.assistantMessageId }),
    ).rejects.toThrow(/Authentication required/);
    await expect(
      t.withIdentity(ownerB).query(listCitations, {
        messageId: seeded.assistantMessageId,
      }),
    ).rejects.toThrow(/Conversation not found/);

    const widgetMessages = await t.query(listWidgetMessages, {
      workspaceId: workspaceA,
      token: "c".repeat(64),
      paginationOpts: page,
    });
    const assistantDto = widgetMessages.page.find(
      (message) => message._id === seeded.assistantMessageId,
    );
    expect(assistantDto).toBeDefined();
    expect(Object.keys(assistantDto ?? {}).sort()).toEqual([
      "_id",
      "author",
      "body",
      "createdAt",
      "sequence",
    ]);
    expect(assistantDto).not.toHaveProperty("aiRunId");
    expect(assistantDto).not.toHaveProperty("citations");
    expect(assistantDto).not.toHaveProperty("kind");
    expect(assistantDto).not.toHaveProperty("ragEntryId");
    expect(
      widgetMessages.page.every(
        (message) =>
          JSON.stringify(Object.keys(message).sort()) ===
          JSON.stringify(["_id", "author", "body", "createdAt", "sequence"]),
      ),
    ).toBe(true);
    const serializedWidgetDto = JSON.stringify(widgetMessages);
    expect(serializedWidgetDto).not.toContain(String(seeded.runId));
    expect(serializedWidgetDto).not.toContain(String(seeded.storageId));
    expect(serializedWidgetDto).not.toContain(
      String(seeded.knowledgeDocumentId),
    );
    expect(serializedWidgetDto).not.toContain("rag-private-id");
    expect(serializedWidgetDto).not.toMatch(/storageUrl|https?:\/\/.*storage/i);

    const [widgetConfig, automationState] = await Promise.all([
      t.query(getWidgetConfig, { workspaceId: workspaceA }),
      t.query(getWidgetAutomationState, {
        workspaceId: workspaceA,
        token: "c".repeat(64),
      }),
    ]);
    expect(Object.keys(widgetConfig ?? {}).sort()).toEqual([
      "displayName",
      "greeting",
      "position",
      "theme",
    ]);
    expect(Object.keys(automationState).sort()).toEqual([
      "handling",
      "isAiTyping",
      "needsHuman",
    ]);
  });

  test("the needs-human query excludes routine AI and other workspaces", async () => {
    const t = backend();
    const workspaceA = await createWorkspace(t, ownerA, "filter-a");
    const workspaceB = await createWorkspace(t, ownerB, "filter-b");
    const routine = await createConversation(t, workspaceA, "4");
    const needsHuman = await createConversation(t, workspaceA, "5");
    const otherWorkspace = await createConversation(t, workspaceB, "6");
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("aiConversationStates", {
        workspaceId: workspaceA,
        conversationId: routine.conversationId,
        mode: "ai",
        attention: "none",
        generationEpoch: 1,
        syncedThroughSequence: 1,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("aiConversationStates", {
        workspaceId: workspaceA,
        conversationId: needsHuman.conversationId,
        mode: "human",
        attention: "needs_human",
        generationEpoch: 1,
        handoffReason: "low_confidence",
        syncedThroughSequence: 1,
        createdAt: now,
        updatedAt: now + 1,
      });
      await ctx.db.insert("aiConversationStates", {
        workspaceId: workspaceB,
        conversationId: otherWorkspace.conversationId,
        mode: "human",
        attention: "needs_human",
        generationEpoch: 1,
        syncedThroughSequence: 1,
        createdAt: now,
        updatedAt: now + 2,
      });
    });

    const result = await t.withIdentity(ownerA).query(listNeedsHuman, {
      paginationOpts: page,
    });
    expect(result.page.map((conversation) => conversation._id)).toEqual([
      needsHuman.conversationId,
    ]);
    expect(result.page[0]).toMatchObject({
      attentionState: "needs_human",
      handlingState: "needs_human",
    });
    expect(result.page.some((conversation) => conversation._id === routine.conversationId)).toBe(
      false,
    );
  });
});

describe("knowledge removal", () => {
  test("removal invalidates ready evidence immediately and cleanup is retry-safe", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T12:00:00.000Z"));
    try {
      const t = backend();
      await registerRagTest(t);
      const workspaceId = await createWorkspace(t, ownerA, "remove");
      const namespace = await t.mutation(components.rag.namespaces.getOrCreate, {
        namespace: knowledgeNamespace(workspaceId),
        status: "ready",
        modelId: "text-embedding-3-small",
        dimension: 1_536,
        filterNames: [],
      });
      const entry = await t.mutation(components.rag.entries.add, {
        entry: {
          namespaceId: namespace.namespaceId,
          key: "remove-document",
          importance: 1,
          filterValues: [],
          contentHash: "remove-document-hash",
          title: "Removal policy",
        },
        allChunks: [],
      });
      expect(entry.status).toBe("ready");
      const ready = await addReadyKnowledge(
        t,
        workspaceId,
        "remove",
        entry.entryId,
      );

      expect(
        await t.query(getReadyDocuments, {
          workspaceId,
          ragEntryIds: [entry.entryId],
        }),
      ).toMatchObject([{ knowledgeDocumentId: ready.documentId }]);

      const owner = t.withIdentity(ownerA);
      await expect(
        owner.mutation(removeKnowledge, { documentId: ready.documentId }),
      ).resolves.toBeNull();
      expect(
        await t.query(getReadyDocuments, {
          workspaceId,
          ragEntryIds: [entry.entryId],
        }),
      ).toEqual([]);
      expect(
        await t.run(async (ctx) =>
          (await ctx.db.get("knowledgeDocuments", ready.documentId))?.status,
        ),
      ).toBe("deleting");
      await expect(
        owner.mutation(removeKnowledge, { documentId: ready.documentId }),
      ).resolves.toBeNull();

      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      const cleaned = await t.run(async (ctx) => ({
        document: await ctx.db.get("knowledgeDocuments", ready.documentId),
        storage: await ctx.db.system.get("_storage", ready.storageId),
      }));
      expect(cleaned).toEqual({ document: null, storage: null });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("mocked whole-feature vertical slice", () => {
  test("queued owner knowledge becomes a grounded canonical answer with private evidence", async () => {
    const t = backend();
    const workspaceId = await createWorkspace(t, ownerA, "vertical");
    const registered = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(
        new Blob(["Returns are accepted for 30 days."], {
          type: "text/plain",
        }),
      );
      const now = Date.now();
      const documentId = await ctx.db.insert("knowledgeDocuments", {
        workspaceId,
        storageId,
        clientRequestId: "50000000-0000-4000-8000-000000000001",
        stableKey: "returns.txt",
        version: 1,
        filename: "returns.txt",
        title: "returns",
        mimeType: "text/plain",
        fileKind: "text",
        size: 34,
        sha256: "5".repeat(64),
        status: "queued",
        attempt: 0,
        createdAt: now,
        updatedAt: now,
      });
      return { documentId };
    });
    const owner = t.withIdentity(ownerA);
    const processing = await t.mutation(beginKnowledgeProcessing, {
      documentId: registered.documentId,
    });
    if (!processing) throw new Error("Expected queued knowledge processing");
    await t.mutation(completeKnowledgeEntry, {
      documentId: registered.documentId,
      processingToken: processing.processingToken,
      ragEntryId: "rag-vertical-ready",
      replacedRagEntryId: null,
    });

    const fixture = await createConversation(t, workspaceId, "7");
    const queued = await t.mutation(queueVisitor, {
      conversationId: fixture.conversationId,
      messageId: fixture.messageId,
      reopened: false,
    });
    if (!queued.queued) throw new Error("Expected an AI run");
    expect(await t.mutation(syncNextBatch, { runId: queued.runId })).toMatchObject({
      status: "ready",
    });
    expect(
      await t.mutation(claimAttempt, {
        runId: queued.runId,
        expectedAttempt: 0,
      }),
    ).toEqual({ status: "claimed", attempt: 1 });

    const groundedEvidence: RetrievedEvidence = {
      citationId: "rag-vertical-ready:0",
      knowledgeDocumentId: registered.documentId,
      ragEntryId: "rag-vertical-ready",
      chunkOrder: 0,
      documentTitle: "Returns",
      excerpt: "Returns are accepted for 30 days.",
      score: 0.94,
    };
    const committed = await t.mutation(commitCandidate, {
      runId: queued.runId,
      attempt: 1,
      segments: [
        {
          text: groundedEvidence.excerpt,
          citationId: groundedEvidence.citationId,
          supportingQuote: groundedEvidence.excerpt,
        },
      ],
      evidence: [groundedEvidence],
    });
    if (committed.status !== "accepted") {
      throw new Error("Expected a guarded canonical answer");
    }

    expect(
      await owner.query(listCitations, { messageId: committed.messageId }),
    ).toEqual([
      {
        documentTitle: "returns",
        segmentIndex: 0,
        segmentText: "Returns are accepted for 30 days.",
        supportingQuote: "Returns are accepted for 30 days.",
        excerpt: "Returns are accepted for 30 days.",
      },
    ]);
    const widgetPage = await t.query(listWidgetMessages, {
      workspaceId,
      token: "7".repeat(64),
      paginationOpts: page,
    });
    expect(widgetPage.page.map((message) => message.author)).toEqual([
      "assistant",
      "visitor",
    ]);
    expect(Object.keys(widgetPage.page[0] ?? {}).sort()).toEqual([
      "_id",
      "author",
      "body",
      "createdAt",
      "sequence",
    ]);

    const snapshot = await t.run(async (ctx) => ({
      document: await ctx.db.get("knowledgeDocuments", registered.documentId),
      run: await ctx.db.get("aiRuns", queued.runId),
      links: await ctx.db
        .query("messageAgentLinks")
        .withIndex("by_conversationId_and_sequence", (q) =>
          q.eq("conversationId", fixture.conversationId),
        )
        .take(10),
    }));
    expect(snapshot.document?.status).toBe("ready");
    expect(snapshot.run?.status).toBe("accepted");
    expect(snapshot.links).toHaveLength(2);
  });
});

describe("widget bootstrap policy versioning", () => {
  test("appearance timestamps do not invalidate bootstrap policy", async () => {
    const t = backend();
    const workspaceId = await createWorkspace(t, ownerA, "widget-policy");
    await t.run(async (ctx) => {
      const settingsId = await ctx.db.insert("widgetSettings", {
        ownerTokenIdentifier: ownerA.tokenIdentifier,
        workspaceId,
        displayName: "Support",
        greeting: "Hello",
        theme: "blue",
        position: "bottomRight",
        allowedOrigins: ["https://shop.example.com"],
        originPolicy: "enforced",
        securityUpdatedAt: 50,
        updatedAt: 100,
      });
      expect(
        await getWidgetOriginPolicy(
          ctx,
          workspaceId,
          "https://shop.example.com",
        ),
      ).toMatchObject({ allowed: true, policyVersion: 50 });

      await ctx.db.patch("widgetSettings", settingsId, { updatedAt: 200 });
      expect(
        await getWidgetOriginPolicy(
          ctx,
          workspaceId,
          "https://shop.example.com",
        ),
      ).toMatchObject({ allowed: true, policyVersion: 50 });
    });
  });
});

describe("widget origin enforcement guidance", () => {
  test("browser-reported origins preserve activity and recency signals", async () => {
    const t = backend();
    const workspaceId = await createWorkspace(t, ownerA, "widget-origins");
    await t.run(async (ctx) => {
      await recordWidgetOriginObservation(
        ctx,
        workspaceId,
        "https://shop.example.com",
        1_000,
      );
      await recordWidgetOriginObservation(
        ctx,
        workspaceId,
        "https://help.example.com",
        2_000,
      );
      await recordWidgetOriginObservation(
        ctx,
        workspaceId,
        "https://shop.example.com",
        3_000,
      );
    });

    expect(
      await t.run(async (ctx) =>
        getRecentWidgetOriginObservations(ctx, workspaceId),
      ),
    ).toEqual({
      origins: [
        {
          origin: "https://shop.example.com",
          sessionCount: 2,
          firstSeenAt: 1_000,
          lastSeenAt: 3_000,
        },
        {
          origin: "https://help.example.com",
          sessionCount: 1,
          firstSeenAt: 2_000,
          lastSeenAt: 2_000,
        },
      ],
      isTruncated: false,
      isAtCapacity: false,
    });
  });

  test("origin guidance identifies a list that exceeds the enforceable sample", async () => {
    const t = backend();
    const workspaceId = await createWorkspace(t, ownerA, "widget-origin-limit");
    await t.run(async (ctx) => {
      for (let index = 0; index < 21; index += 1) {
        await recordWidgetOriginObservation(
          ctx,
          workspaceId,
          `https://site-${index}.example.com`,
          index,
        );
      }
    });

    const result = await t.run(async (ctx) =>
      getRecentWidgetOriginObservations(ctx, workspaceId),
    );
    expect(result.isTruncated).toBe(true);
    expect(result.isAtCapacity).toBe(false);
    expect(result.origins).toHaveLength(20);
    expect(result.origins[0]?.origin).toBe("https://site-20.example.com");
    expect(result.origins.at(-1)?.origin).toBe("https://site-1.example.com");
  });

  test("origin observations repair legacy overflow and clear for rediscovery", async () => {
    const t = backend();
    const workspaceId = await createWorkspace(t, ownerA, "widget-origin-cap");
    await t.run(async (ctx) => {
      for (
        let index = 0;
        index < MAX_WIDGET_ORIGIN_OBSERVATIONS_PER_WORKSPACE + 25;
        index += 1
      ) {
        await ctx.db.insert("widgetOriginObservations", {
          workspaceId,
          origin: `https://bounded-${index}.example.com`,
          sessionCount: 1,
          firstSeenAt: index,
          lastSeenAt: index,
        });
      }
      await recordWidgetOriginObservation(
        ctx,
        workspaceId,
        `https://bounded-${MAX_WIDGET_ORIGIN_OBSERVATIONS_PER_WORKSPACE + 25}.example.com`,
        MAX_WIDGET_ORIGIN_OBSERVATIONS_PER_WORKSPACE + 25,
      );
    });

    expect(
      (
        await t.run(async (ctx) =>
          getRecentWidgetOriginObservations(ctx, workspaceId),
        )
      ).isAtCapacity,
    ).toBe(true);

    const retained = await t.run(async (ctx) =>
      ctx.db
        .query("widgetOriginObservations")
        .withIndex("by_workspaceId_and_lastSeenAt", (q) =>
          q.eq("workspaceId", workspaceId),
        )
        .take(MAX_WIDGET_ORIGIN_OBSERVATIONS_PER_WORKSPACE + 1),
    );
    expect(retained).toHaveLength(MAX_WIDGET_ORIGIN_OBSERVATIONS_PER_WORKSPACE);
    expect(retained.map((observation) => observation.origin)).not.toContain(
      "https://bounded-0.example.com",
    );
    expect(retained.map((observation) => observation.origin)).toContain(
      `https://bounded-${MAX_WIDGET_ORIGIN_OBSERVATIONS_PER_WORKSPACE + 25}.example.com`,
    );

    vi.useFakeTimers();
    try {
      await t.run(async (ctx) => {
        for (
          let index = 0;
          index < MAX_WIDGET_ORIGIN_OBSERVATIONS_PER_WORKSPACE + 25;
          index += 1
        ) {
          await ctx.db.insert("widgetOriginObservations", {
            workspaceId,
            origin: `https://legacy-overflow-${index}.example.com`,
            sessionCount: 1,
            firstSeenAt: index,
            lastSeenAt: index,
          });
        }
      });
      const firstBatch = await t.run(async (ctx) =>
        clearWidgetOriginObservations(ctx, workspaceId),
      );
      if (!firstBatch.hasMore || !firstBatch.clearThrough) {
        throw new Error("Expected a scheduled clear continuation");
      }
      const clearThrough = firstBatch.clearThrough;
      const rediscoveredOrigin = "https://rediscovered.example.com";
      vi.advanceTimersByTime(1);
      await t.run(async (ctx) => {
        await ctx.db.insert("widgetOriginObservations", {
          workspaceId,
          origin: rediscoveredOrigin,
          sessionCount: 1,
          firstSeenAt: clearThrough.lastSeenAt,
          lastSeenAt: clearThrough.lastSeenAt,
        });
      });
      await t.mutation(continueClearWidgetOriginObservations, {
        workspaceId,
        clearThroughLastSeenAt: clearThrough.lastSeenAt,
        clearThroughCreationTime: clearThrough.creationTime,
      });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    } finally {
      vi.useRealTimers();
    }
    expect(
      await t.run(async (ctx) =>
        ctx.db
          .query("widgetOriginObservations")
          .withIndex("by_workspaceId_and_lastSeenAt", (q) =>
            q.eq("workspaceId", workspaceId),
          )
          .take(2),
      ),
    ).toMatchObject([{ origin: "https://rediscovered.example.com" }]);
  });
});
