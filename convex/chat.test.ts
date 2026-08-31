/// <reference types="vite/client" />

import agentTest from "@convex-dev/agent/test";
import { makeFunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { describe, expect, test, vi } from "vitest";
import { components } from "./_generated/api";
import { CAPABILITY_TTL_MS } from "./chatModel";
import {
  runResponderOrchestration,
  type ResponderDependencies,
  type RunPreflight,
  type SyncResult,
} from "./aiResponderOrchestration";
import schema from "./schema";
import {
  signWidgetBootstrap,
  WIDGET_BOOTSTRAP_VERSION,
} from "../lib/widget-bootstrap-token";
import { WIDGET_HUMAN_REQUEST_MESSAGE } from "../lib/widget-embed-contract";
import { parseWidgetBootstrapRequest } from "../lib/widget-bootstrap-request";
import { clearWidgetOriginObservations } from "./widgetOriginModel";

const modules = import.meta.glob("./**/*.ts");

type WorkspaceId = GenericId<"workspaces">;
type ConversationId = GenericId<"conversations">;
type RunId = GenericId<"aiRuns">;

type ContextInput = {
  city?: string | null;
  country?: string | null;
  timezone?: string | null;
  locale?: string | null;
  device?: string | null;
  pageUrl?: string | null;
  pageTitle?: string | null;
};

type MessageItem = {
  _id: GenericId<"messages">;
  sequence: number;
  author: "visitor" | "owner" | "assistant" | "system";
  body: string;
  createdAt: number;
};

type Page<T> = {
  page: T[];
  isDone: boolean;
  continueCursor: string;
};

const ensureSession = makeFunctionReference<
  "mutation",
  {
    workspaceId: WorkspaceId;
    bootstrapToken: string;
    token?: string;
    context: ContextInput;
  },
  { token: string }
>("widgetChat:ensureSession");

const getBootstrapRenewalPolicy = makeFunctionReference<
  "mutation",
  { workspaceId: WorkspaceId; capabilityToken: string; origin: string },
  null | {
    allowed: boolean;
    mode: "legacy_limited" | "enforced";
    policyVersion: number;
  }
>("widgetBootstrap:getRenewalPolicy");

const updateContext = makeFunctionReference<
  "mutation",
  { workspaceId: WorkspaceId; token: string; context: ContextInput },
  null
>("widgetChat:updateContext");

const sendMessage = makeFunctionReference<
  "mutation",
  {
    workspaceId: WorkspaceId;
    token: string;
    clientMessageId: string;
    body: string;
    context: ContextInput;
  },
  MessageItem
>("widgetChat:sendMessage");

const listVisitorMessages = makeFunctionReference<
  "query",
  {
    workspaceId: WorkspaceId;
    token: string;
    paginationOpts: { numItems: number; cursor: string | null };
  },
  Page<MessageItem>
>("widgetChat:listMessages");

const listConversations = makeFunctionReference<
  "query",
  { paginationOpts: { numItems: number; cursor: string | null } },
  Page<{
    _id: ConversationId;
    status: "open" | "resolved";
    unreadCount: number;
    handlingState: "ai_handling" | "human_handling" | "needs_human" | "resolved";
    attentionState: "none" | "needs_human";
    isAiTyping: boolean;
    canTakeOver: boolean;
    canResume: boolean;
    lastMessage: { author: MessageItem["author"]; body: string; createdAt: number };
    visitor: {
      city: string | null;
      country: string | null;
      timezone: string | null;
      locale: string | null;
      device: string | null;
      pageUrl: string | null;
      pageTitle: string | null;
      lastSeenAt: number;
    };
  }>
>("inbox:listConversations");

const listInboxMessages = makeFunctionReference<
  "query",
  {
    conversationId: ConversationId;
    paginationOpts: { numItems: number; cursor: string | null };
  },
  Page<MessageItem>
>("inbox:listMessages");

const sendReply = makeFunctionReference<
  "mutation",
  { conversationId: ConversationId; clientMessageId: string; body: string },
  MessageItem
>("inbox:sendReply");

const resolveConversation = makeFunctionReference<
  "mutation",
  { conversationId: ConversationId; clientMessageId: string },
  MessageItem
>("inbox:resolve");

const markRead = makeFunctionReference<
  "mutation",
  { conversationId: ConversationId },
  null
>("inbox:markRead");

const enforceRunKillSwitch = makeFunctionReference<
  "mutation",
  { runId: RunId },
  boolean
>("aiAutomation:enforceRunKillSwitch");

const getRunPreflight = makeFunctionReference<
  "mutation",
  { runId: RunId },
  RunPreflight | null
>("aiAutomation:getRunPreflight");

const syncNextBatch = makeFunctionReference<
  "mutation",
  { runId: RunId },
  SyncResult
>("aiAutomation:syncNextBatch");

const handoffRun = makeFunctionReference<
  "mutation",
  { runId: RunId; reason: string; errorCode?: string; errorMessage?: string },
  { status: "handed_off"; messageId: GenericId<"messages"> } | { status: "stale" }
>("aiAutomation:handoffRun");

const page = { numItems: 50, cursor: null };
const emptyContext: ContextInput = {};
const ownerAIdentity = {
  subject: "better-auth-owner-a",
  issuer: "https://auth.example.test",
  tokenIdentifier: "https://auth.example.test|owner-a",
};
const ownerBIdentity = {
  subject: "better-auth-owner-b",
  issuer: "https://auth.example.test",
  tokenIdentifier: "https://auth.example.test|owner-b",
};
const TEST_WIDGET_BOOTSTRAP_SECRET = "test-widget-bootstrap-secret-with-at-least-32-bytes";
const TEST_WIDGET_ORIGIN = "https://shop.example.test";
vi.stubEnv("WIDGET_BOOTSTRAP_SECRET", TEST_WIDGET_BOOTSTRAP_SECRET);

const deleteBootstrapUse = makeFunctionReference<
  "mutation",
  {
    bootstrapUseId: GenericId<"widgetBootstrapUses">;
    nonce: string;
    expectedExpiresAt: number;
  },
  null
>("widgetChatInternal:deleteBootstrapUse");

function makeTestBackend() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  rateLimiterTest.register(t);
  return t;
}

type TestBackend = ReturnType<typeof makeTestBackend>;

async function createWorkspace(
  t: TestBackend,
  ownerTokenIdentifier: string,
  name = "Test workspace",
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("workspaces", {
      name,
      ownerAuthUserId: `legacy-${ownerTokenIdentifier}`,
      ownerTokenIdentifier,
    }),
  );
}

async function createVisitor(t: TestBackend, workspaceId: WorkspaceId) {
  return await t.mutation(ensureSession, {
    workspaceId,
    bootstrapToken: await createBootstrap(workspaceId),
    context: emptyContext,
  });
}

async function createBootstrap(
  workspaceId: WorkspaceId,
  origin = TEST_WIDGET_ORIGIN,
  policyVersion = 0,
) {
  const issuedAt = Date.now();
  return await signWidgetBootstrap(
    {
      version: WIDGET_BOOTSTRAP_VERSION,
      workspaceId,
      origin,
      policyVersion,
      issuedAt,
      expiresAt: issuedAt + 5 * 60_000,
      nonce: crypto.randomUUID().replaceAll("-", ""),
    },
    TEST_WIDGET_BOOTSTRAP_SECRET,
  );
}

async function firstConversation(t: TestBackend, workspaceId: WorkspaceId) {
  const conversation = await t.run(async (ctx) =>
    ctx.db
      .query("conversations")
      .withIndex("by_workspaceId_and_hasMessages_and_lastMessageAt", (q) =>
        q.eq("workspaceId", workspaceId).eq("hasMessages", true),
      )
      .first(),
  );
  if (!conversation) {
    throw new Error("Expected a conversation");
  }
  return conversation;
}

describe("widget bootstrap request parsing", () => {
  const workspaceId = "workspace_123";
  const capabilityToken = "a".repeat(64);

  test("keeps ordinary bootstraps separate from explicit renewals", () => {
    expect(parseWidgetBootstrapRequest({ workspaceId })).toEqual({
      workspaceId,
      renewal: null,
    });
    expect(
      parseWidgetBootstrapRequest({
        workspaceId,
        parentOrigin: "https://shop.example.test",
        capabilityToken,
      }),
    ).toEqual({
      workspaceId,
      renewal: {
        origin: "https://shop.example.test",
        capabilityToken,
      },
    });
  });

  test("rejects incomplete or malformed renewal intent", () => {
    expect(
      parseWidgetBootstrapRequest({
        workspaceId,
        parentOrigin: "https://shop.example.test",
      }),
    ).toBeNull();
    expect(
      parseWidgetBootstrapRequest({
        workspaceId,
        capabilityToken,
      }),
    ).toBeNull();
    expect(
      parseWidgetBootstrapRequest({
        workspaceId,
        parentOrigin: "not-an-origin",
        capabilityToken: "not-a-capability",
      }),
    ).toBeNull();
  });
});

describe("visitor sessions and isolation", () => {
  test("bootstrap renewal accepts legacy visitors without weakening origin policy", async () => {
    const t = makeTestBackend();
    const workspaceId = await createWorkspace(t, ownerAIdentity.tokenIdentifier);
    const session = await createVisitor(t, workspaceId);

    await expect(
      t.mutation(getBootstrapRenewalPolicy, {
        workspaceId,
        capabilityToken: session.token,
        origin: "https://attacker.example.test",
      }),
    ).resolves.toBeNull();

    await t.run(async (ctx) => {
      const visitor = await ctx.db
        .query("visitors")
        .withIndex("by_workspaceId_and_capabilityToken", (q) =>
          q.eq("workspaceId", workspaceId).eq("capabilityToken", session.token),
        )
        .unique();
      if (!visitor) throw new Error("Expected visitor");
      await ctx.db.patch("visitors", visitor._id, { origin: undefined });
      await ctx.db.insert("widgetSettings", {
        ownerTokenIdentifier: ownerAIdentity.tokenIdentifier,
        workspaceId,
        displayName: "Support",
        greeting: "Hello",
        theme: "blue",
        position: "bottomRight",
        allowedOrigins: [TEST_WIDGET_ORIGIN],
        originPolicy: "enforced",
        updatedAt: Date.now(),
      });
    });

    await expect(
      t.mutation(getBootstrapRenewalPolicy, {
        workspaceId,
        capabilityToken: session.token,
        origin: TEST_WIDGET_ORIGIN,
      }),
    ).resolves.toMatchObject({ allowed: true, mode: "enforced" });
    await expect(
      t.mutation(getBootstrapRenewalPolicy, {
        workspaceId,
        capabilityToken: session.token,
        origin: "https://attacker.example.test",
      }),
    ).resolves.toBeNull();

    await t.run(async (ctx) => {
      const visitor = await ctx.db
        .query("visitors")
        .withIndex("by_workspaceId_and_capabilityToken", (q) =>
          q.eq("workspaceId", workspaceId).eq("capabilityToken", session.token),
        )
        .unique();
      if (!visitor) throw new Error("Expected visitor");
      await ctx.db.patch("visitors", visitor._id, {
        capabilityExpiresAt: 0,
        capabilityExpired: true,
      });
    });
    await expect(
      t.mutation(getBootstrapRenewalPolicy, {
        workspaceId,
        capabilityToken: session.token,
        origin: TEST_WIDGET_ORIGIN,
      }),
    ).resolves.toBeNull();
  });

  test("new sessions require a short-lived origin bootstrap and reject replay", async () => {
    const t = makeTestBackend();
    const workspaceId = await createWorkspace(t, ownerAIdentity.tokenIdentifier);

    await expect(
      t.mutation(ensureSession, {
        workspaceId,
        bootstrapToken: "not-a-bootstrap",
        context: emptyContext,
      }),
    ).rejects.toThrow(/unavailable/i);

    const bootstrapToken = await createBootstrap(workspaceId);
    await t.mutation(ensureSession, {
      workspaceId,
      bootstrapToken,
      context: emptyContext,
    });
    await expect(
      t.mutation(ensureSession, {
        workspaceId,
        bootstrapToken,
        context: emptyContext,
      }),
    ).rejects.toThrow(/unavailable/i);

    const policyVersion = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("widgetSettings", {
        ownerTokenIdentifier: ownerAIdentity.tokenIdentifier,
        workspaceId,
        displayName: "Support",
        greeting: "Hello",
        theme: "blue",
        position: "bottomRight",
        allowedOrigins: ["https://allowed.example.test"],
        originPolicy: "enforced",
        updatedAt: policyVersion,
      });
    });
    await expect(
      t.mutation(ensureSession, {
        workspaceId,
        bootstrapToken: await createBootstrap(
          workspaceId,
          "https://unknown.example.test",
          policyVersion,
        ),
        context: emptyContext,
      }),
    ).rejects.toThrow(/unavailable/i);
  });

  test("the replay ledger is token-guarded and removed after bootstrap expiry", async () => {
    vi.useFakeTimers();
    try {
      const t = makeTestBackend();
      const workspaceId = await createWorkspace(
        t,
        ownerAIdentity.tokenIdentifier,
      );
      await createVisitor(t, workspaceId);
      const use = await t.run(async (ctx) =>
        ctx.db.query("widgetBootstrapUses").withIndex("by_nonce").unique(),
      );
      if (!use) throw new Error("Expected bootstrap replay ledger entry");

      await t.mutation(deleteBootstrapUse, {
        bootstrapUseId: use._id,
        nonce: `${use.nonce}-stale`,
        expectedExpiresAt: use.expiresAt,
      });
      expect(
        await t.run(async (ctx) =>
          ctx.db.get("widgetBootstrapUses", use._id),
        ),
      ).not.toBeNull();

      await t.finishAllScheduledFunctions(() => vi.runAllTimers(), 10);
      expect(
        await t.run(async (ctx) =>
          ctx.db.get("widgetBootstrapUses", use._id),
        ),
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("a fresh session has no conversation until its first message and resumes once", async () => {
    const t = makeTestBackend();
    const workspaceId = await createWorkspace(t, ownerAIdentity.tokenIdentifier);
    const session = await createVisitor(t, workspaceId);

    expect(session.token).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await t.run(async (ctx) =>
        ctx.db
          .query("conversations")
          .withIndex("by_workspaceId_and_hasMessages_and_lastMessageAt", (q) =>
            q.eq("workspaceId", workspaceId),
          )
          .take(2),
      ),
    ).toHaveLength(0);
    expect(
      await t.query(listVisitorMessages, {
        workspaceId,
        token: session.token,
        paginationOpts: page,
      }),
    ).toMatchObject({ page: [], isDone: true });

    await t.mutation(sendMessage, {
      workspaceId,
      token: session.token,
      clientMessageId: "00000000-0000-4000-8000-000000000001",
      body: "Hello",
      context: emptyContext,
    });
    await t.mutation(ensureSession, {
      workspaceId,
      bootstrapToken: await createBootstrap(workspaceId),
      token: session.token,
      context: emptyContext,
    });

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("conversations")
        .withIndex("by_workspaceId_and_hasMessages_and_lastMessageAt", (q) =>
          q.eq("workspaceId", workspaceId),
        )
        .take(2),
    );
    expect(rows).toHaveLength(1);
  });

  test("the widget human action uses the canonical message path and hands off exactly once", async () => {
    const t = makeTestBackend();
    const workspaceId = await createWorkspace(
      t,
      ownerAIdentity.tokenIdentifier,
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceAiSettings", {
        workspaceId,
        enabled: true,
        answerModel: "openai/gpt-5.6-terra",
        handoffMessage: "A human will continue here.",
        updatedAt: Date.now(),
      });
    });
    const session = await createVisitor(t, workspaceId);
    const requestBody = WIDGET_HUMAN_REQUEST_MESSAGE;
    const clientMessageId = "10000000-0000-4000-8000-000000000099";
    const first = await t.mutation(sendMessage, {
      workspaceId,
      token: session.token,
      clientMessageId,
      body: requestBody,
      context: emptyContext,
    });
    const retry = await t.mutation(sendMessage, {
      workspaceId,
      token: session.token,
      clientMessageId,
      body: requestBody,
      context: emptyContext,
    });
    expect(retry._id).toBe(first._id);

    const conversation = await firstConversation(t, workspaceId);
    const run = await t.run(async (ctx) =>
      ctx.db
        .query("aiRuns")
        .withIndex("by_triggerMessageId", (q) =>
          q.eq("triggerMessageId", first._id),
        )
        .unique(),
    );
    if (!run) throw new Error("Expected the human request responder run");

    const searchReadyKnowledge = vi.fn(async () => ({ results: [] }));
    const generateCandidate = vi.fn(async () => {
      throw new Error("The model must not run for a human request");
    });
    const dependencies = {
      enforceRunKillSwitch: async (runId) =>
        await t.mutation(enforceRunKillSwitch, { runId }),
      getRunPreflight: async (runId) =>
        await t.mutation(getRunPreflight, { runId }),
      syncNextBatch: async (runId) =>
        await t.mutation(syncNextBatch, { runId }),
      searchReadyKnowledge,
      claimAttempt: async () => ({ status: "stale" as const }),
      prepareRetry: async () => false,
      generateCandidate,
      commitCandidate: async () => ({ status: "stale" as const }),
      handoff: async (request) => {
        await t.mutation(handoffRun, request);
      },
      delay: async () => undefined,
    } satisfies ResponderDependencies;

    await runResponderOrchestration(run._id, dependencies);
    await runResponderOrchestration(run._id, dependencies);

    expect(searchReadyKnowledge).not.toHaveBeenCalled();
    expect(generateCandidate).not.toHaveBeenCalled();
    const messages = await t.query(listVisitorMessages, {
      workspaceId,
      token: session.token,
      paginationOpts: page,
    });
    expect(messages.page).toHaveLength(2);
    expect(messages.page).toMatchObject([
      {
        author: "assistant",
        body: "A human will continue here.",
      },
      { _id: first._id, author: "visitor", body: requestBody },
    ]);
    expect(
      await t.run(async (ctx) =>
        ctx.db
          .query("aiConversationStates")
          .withIndex("by_conversationId", (q) =>
            q.eq("conversationId", conversation._id),
          )
          .unique(),
      ),
    ).toMatchObject({ mode: "human", attention: "needs_human" });
  });

  test("workspace ID and another visitor token cannot cross capability scopes", async () => {
    const t = makeTestBackend();
    const workspaceA = await createWorkspace(t, ownerAIdentity.tokenIdentifier);
    const workspaceB = await createWorkspace(t, ownerBIdentity.tokenIdentifier);
    const visitorA = await createVisitor(t, workspaceA);
    const visitorB = await createVisitor(t, workspaceA);

    await t.mutation(sendMessage, {
      workspaceId: workspaceA,
      token: visitorA.token,
      clientMessageId: "00000000-0000-4000-8000-000000000010",
      body: "Private A",
      context: emptyContext,
    });
    await t.mutation(sendMessage, {
      workspaceId: workspaceA,
      token: visitorB.token,
      clientMessageId: "00000000-0000-4000-8000-000000000011",
      body: "Private B",
      context: emptyContext,
    });

    await expect(
      t.query(listVisitorMessages, {
        workspaceId: workspaceB,
        token: visitorA.token,
        paginationOpts: page,
      }),
    ).rejects.toThrow(/Invalid or expired visitor capability/);
    const visitorAResults = await t.query(listVisitorMessages, {
      workspaceId: workspaceA,
      token: visitorA.token,
      paginationOpts: page,
    });
    expect(visitorAResults.page.map((message) => message.body)).toEqual(["Private A"]);
  });

  test("visitor API cannot forge an owner author and owner API requires auth", async () => {
    const t = makeTestBackend();
    const workspaceId = await createWorkspace(t, ownerAIdentity.tokenIdentifier);
    const session = await createVisitor(t, workspaceId);

    const forgedArgs = {
        workspaceId,
        token: session.token,
        clientMessageId: "00000000-0000-4000-8000-000000000020",
        body: "Forged",
        context: emptyContext,
        author: "owner",
      } as unknown as {
        workspaceId: WorkspaceId;
        token: string;
        clientMessageId: string;
        body: string;
        context: ContextInput;
      };
    await expect(t.mutation(sendMessage, forgedArgs)).rejects.toThrow();

    await t.mutation(sendMessage, {
      workspaceId,
      token: session.token,
      clientMessageId: "00000000-0000-4000-8000-000000000021",
      body: "Hello",
      context: emptyContext,
    });
    const conversation = await firstConversation(t, workspaceId);
    await expect(
      t.mutation(sendReply, {
        conversationId: conversation._id,
        clientMessageId: "00000000-0000-4000-8000-000000000022",
        body: "Not authenticated",
      }),
    ).rejects.toThrow(/Authentication required/);
  });
});

describe("owner inbox and conversation lifecycle", () => {
  test("authenticated owners cannot access another workspace", async () => {
    const t = makeTestBackend();
    const workspaceA = await createWorkspace(t, ownerAIdentity.tokenIdentifier);
    const workspaceB = await createWorkspace(t, ownerBIdentity.tokenIdentifier);
    const sessionB = await createVisitor(t, workspaceB);
    await t.mutation(sendMessage, {
      workspaceId: workspaceB,
      token: sessionB.token,
      clientMessageId: "00000000-0000-4000-8000-000000000030",
      body: "Workspace B only",
      context: emptyContext,
    });
    const conversationB = await firstConversation(t, workspaceB);
    const ownerA = t.withIdentity(ownerAIdentity);

    await expect(
      ownerA.query(listInboxMessages, {
        conversationId: conversationB._id,
        paginationOpts: page,
      }),
    ).rejects.toThrow(/Conversation not found/);
    expect(
      (
        await ownerA.query(listConversations, {
          paginationOpts: page,
        })
      ).page,
    ).toEqual([]);

    // Keep this workspace live in the test so both owner mappings are exercised.
    expect(workspaceA).toBeTruthy();
  });

  test("messages have deterministic sequence, owner replies, read state, resolve, and reopen", async () => {
    const t = makeTestBackend();
    const workspaceId = await createWorkspace(t, ownerAIdentity.tokenIdentifier);
    const session = await createVisitor(t, workspaceId);
    const owner = t.withIdentity(ownerAIdentity);

    await t.mutation(sendMessage, {
      workspaceId,
      token: session.token,
      clientMessageId: "00000000-0000-4000-8000-000000000040",
      body: "First",
      context: emptyContext,
    });
    const conversation = await firstConversation(t, workspaceId);
    const reply = await owner.mutation(sendReply, {
      conversationId: conversation._id,
      clientMessageId: "00000000-0000-4000-8000-000000000041",
      body: "  Owner reply  ",
    });
    expect(reply).toMatchObject({ author: "owner", body: "Owner reply", sequence: 2 });
    expect(
      await owner.mutation(sendReply, {
        conversationId: conversation._id,
        clientMessageId: "00000000-0000-4000-8000-000000000041",
        body: "Owner reply",
      }),
    ).toEqual(reply);
    await expect(
      owner.mutation(sendReply, {
        conversationId: conversation._id,
        clientMessageId: "00000000-0000-4000-8000-000000000041",
        body: "Different owner reply",
      }),
    ).rejects.toThrow(/already used for a different message/);

    await t.mutation(sendMessage, {
      workspaceId,
      token: session.token,
      clientMessageId: "00000000-0000-4000-8000-000000000042",
      body: "Third",
      context: emptyContext,
    });
    const beforeRead = await owner.query(listConversations, { paginationOpts: page });
    expect(beforeRead.page[0]).toMatchObject({
      status: "open",
      unreadCount: 1,
      handlingState: "human_handling",
      attentionState: "none",
      isAiTyping: false,
      canTakeOver: false,
      canResume: false,
    });
    await owner.mutation(markRead, { conversationId: conversation._id });
    const afterRead = await owner.query(listConversations, { paginationOpts: page });
    expect(afterRead.page[0].unreadCount).toBe(0);

    const resolved = await owner.mutation(resolveConversation, {
      conversationId: conversation._id,
      clientMessageId: "00000000-0000-4000-8000-000000000043",
    });
    expect(resolved).toMatchObject({ author: "system", sequence: 4 });
    expect(
      (await owner.query(listConversations, { paginationOpts: page })).page[0],
    ).toMatchObject({
      status: "resolved",
      handlingState: "resolved",
      attentionState: "none",
      isAiTyping: false,
      canTakeOver: false,
      canResume: false,
    });
    await t.mutation(sendMessage, {
      workspaceId,
      token: session.token,
      clientMessageId: "00000000-0000-4000-8000-000000000044",
      body: "Reopen",
      context: emptyContext,
    });

    const messages = await owner.query(listInboxMessages, {
      conversationId: conversation._id,
      paginationOpts: page,
    });
    expect(messages.page.map((message) => message.sequence)).toEqual([5, 4, 3, 2, 1]);
    expect(messages.page.map((message) => message.author)).toEqual([
      "visitor",
      "system",
      "visitor",
      "owner",
      "visitor",
    ]);
    const reopened = await owner.query(listConversations, { paginationOpts: page });
    expect(reopened.page[0]).toMatchObject({ status: "open", unreadCount: 1 });
  });
});

describe("context, idempotency, and capability expiry", () => {
  test("context is sanitized and null values do not erase the last-seen snapshot", async () => {
    const t = makeTestBackend();
    const workspaceId = await createWorkspace(t, ownerAIdentity.tokenIdentifier);
    const session = await t.mutation(ensureSession, {
      workspaceId,
      bootstrapToken: await createBootstrap(workspaceId),
      context: {
        city: " Berlin ",
        country: "de",
        timezone: "Europe/Berlin",
        locale: "de-DE",
        device: "Safari on macOS",
        pageUrl: "https://example.com/pricing?utm_source=test#plans",
        pageTitle: "Pricing",
      },
    });
    await t.mutation(sendMessage, {
      workspaceId,
      token: session.token,
      clientMessageId: "00000000-0000-4000-8000-000000000050",
      body: "Context",
      context: { city: null, pageTitle: " Plans " },
    });

    const owner = t.withIdentity(ownerAIdentity);
    const conversations = await owner.query(listConversations, { paginationOpts: page });
    expect(conversations.page[0].visitor).toMatchObject({
      city: "Berlin",
      country: "DE",
      timezone: "Europe/Berlin",
      pageUrl: "https://example.com/pricing",
      pageTitle: "Plans",
    });

    await t.mutation(updateContext, {
      workspaceId,
      token: session.token,
      context: { pageTitle: "Checkout" },
    });
    const updated = await owner.query(listConversations, { paginationOpts: page });
    expect(updated.page[0].visitor).toMatchObject({ city: "Berlin", pageTitle: "Checkout" });

    await expect(
      t.mutation(updateContext, {
        workspaceId,
        token: session.token,
        context: { country: "XX" },
      }),
    ).rejects.toThrow(/Country must be a two-letter ISO code/);
    await expect(
      t.mutation(updateContext, {
        workspaceId,
        token: session.token,
        context: { timezone: "Mars\/Olympus Mons" },
      }),
    ).rejects.toThrow(/Timezone is invalid/);
  });

  test("exact retries return the original message and collisions throw", async () => {
    const t = makeTestBackend();
    const workspaceId = await createWorkspace(t, ownerAIdentity.tokenIdentifier);
    const first = await createVisitor(t, workspaceId);
    const second = await createVisitor(t, workspaceId);
    const clientMessageId = "00000000-0000-4000-8000-000000000060";
    const original = await t.mutation(sendMessage, {
      workspaceId,
      token: first.token,
      clientMessageId,
      body: "Same body",
      context: emptyContext,
    });
    const retry = await t.mutation(sendMessage, {
      workspaceId,
      token: first.token,
      clientMessageId,
      body: " Same body ",
      context: emptyContext,
    });
    expect(retry).toEqual(original);

    await expect(
      t.mutation(sendMessage, {
        workspaceId,
        token: first.token,
        clientMessageId,
        body: "Different body",
        context: emptyContext,
      }),
    ).rejects.toThrow(/already used for a different message/);
    await expect(
      t.mutation(sendMessage, {
        workspaceId,
        token: second.token,
        clientMessageId,
        body: "Same body",
        context: emptyContext,
      }),
    ).rejects.toThrow(/already used for a different message/);
  });

  test("ensureSession slides expiry while expired capabilities cannot read or write", async () => {
    const t = makeTestBackend();
    const workspaceId = await createWorkspace(t, ownerAIdentity.tokenIdentifier);
    const session = await createVisitor(t, workspaceId);
    const shortExpiry = Date.now() + 1_000;
    await t.run(async (ctx) => {
      const visitor = await ctx.db
        .query("visitors")
        .withIndex("by_workspaceId_and_capabilityToken", (q) =>
          q.eq("workspaceId", workspaceId).eq("capabilityToken", session.token),
        )
        .unique();
      if (!visitor) throw new Error("Expected visitor");
      await ctx.db.patch("visitors", visitor._id, {
        capabilityExpiresAt: shortExpiry,
      });
      const observation = await ctx.db
        .query("widgetOriginObservations")
        .withIndex("by_workspaceId_and_origin", (q) =>
          q
            .eq("workspaceId", workspaceId)
            .eq("origin", TEST_WIDGET_ORIGIN),
        )
        .unique();
      if (!observation) throw new Error("Expected origin observation");
      await ctx.db.patch("widgetOriginObservations", observation._id, {
        lastSeenAt: 1_000,
      });
    });

    await t.mutation(ensureSession, {
      workspaceId,
      bootstrapToken: await createBootstrap(workspaceId),
      token: session.token,
      context: emptyContext,
    });
    const renewedExpiry = await t.run(async (ctx) => {
      const visitor = await ctx.db
        .query("visitors")
        .withIndex("by_workspaceId_and_capabilityToken", (q) =>
          q.eq("workspaceId", workspaceId).eq("capabilityToken", session.token),
        )
        .unique();
      return visitor?.capabilityExpiresAt ?? 0;
    });
    expect(renewedExpiry).toBeGreaterThanOrEqual(Date.now() + CAPABILITY_TTL_MS - 1_000);
    expect(
      await t.run(async (ctx) =>
        ctx.db
          .query("widgetOriginObservations")
          .withIndex("by_workspaceId_and_origin", (q) =>
            q
              .eq("workspaceId", workspaceId)
              .eq("origin", TEST_WIDGET_ORIGIN),
          )
          .unique(),
      ),
    ).toMatchObject({ sessionCount: 1, lastSeenAt: 1_000 });

    await t.run(async (ctx) => {
      const visitor = await ctx.db
        .query("visitors")
        .withIndex("by_workspaceId_and_capabilityToken", (q) =>
          q.eq("workspaceId", workspaceId).eq("capabilityToken", session.token),
        )
        .unique();
      if (!visitor) throw new Error("Expected visitor");
      await ctx.db.patch("visitors", visitor._id, {
        capabilityExpiresAt: 0,
        capabilityExpired: true,
      });
    });

    await expect(
      t.query(listVisitorMessages, {
        workspaceId,
        token: session.token,
        paginationOpts: page,
      }),
    ).rejects.toThrow(/Invalid or expired visitor capability/);
    await expect(
      t.mutation(sendMessage, {
        workspaceId,
        token: session.token,
        clientMessageId: "00000000-0000-4000-8000-000000000070",
        body: "Expired",
        context: emptyContext,
      }),
    ).rejects.toThrow(/Invalid or expired visitor capability/);
  });

  test("resumed capabilities repopulate cleared origin discovery without counting a bootstrap", async () => {
    const t = makeTestBackend();
    const workspaceId = await createWorkspace(t, ownerAIdentity.tokenIdentifier);
    const session = await createVisitor(t, workspaceId);
    await t.run(async (ctx) =>
      clearWidgetOriginObservations(ctx, workspaceId),
    );

    await t.mutation(ensureSession, {
      workspaceId,
      bootstrapToken: await createBootstrap(workspaceId),
      token: session.token,
      context: emptyContext,
    });

    expect(
      await t.run(async (ctx) =>
        ctx.db
          .query("widgetOriginObservations")
          .withIndex("by_workspaceId_and_origin", (q) =>
            q
              .eq("workspaceId", workspaceId)
              .eq("origin", TEST_WIDGET_ORIGIN),
          )
          .unique(),
      ),
    ).toMatchObject({ sessionCount: 0 });
  });

  test("rate-limits origin rediscovery without blocking capability renewal", async () => {
    const t = makeTestBackend();
    const workspaceId = await createWorkspace(t, ownerAIdentity.tokenIdentifier);
    const session = await createVisitor(t, workspaceId);
    await t.run(async (ctx) => {
      await clearWidgetOriginObservations(ctx, workspaceId);
      const exhausted = await ctx.runMutation(
        components.rateLimiter.lib.rateLimit,
        {
          name: "widgetOriginRediscovery",
          key: workspaceId,
          count: 20,
          config: {
            kind: "fixed window",
            rate: 20,
            period: 24 * 60 * 60_000,
            capacity: 20,
            start: 0,
          },
        },
      );
      expect(exhausted.ok).toBe(true);
    });

    await expect(
      t.mutation(ensureSession, {
        workspaceId,
        bootstrapToken: await createBootstrap(workspaceId),
        token: session.token,
        context: emptyContext,
      }),
    ).resolves.toEqual(session);
    expect(
      await t.run(async (ctx) =>
        ctx.db
          .query("widgetOriginObservations")
          .withIndex("by_workspaceId_and_origin", (q) =>
            q
              .eq("workspaceId", workspaceId)
              .eq("origin", TEST_WIDGET_ORIGIN),
          )
          .unique(),
      ),
    ).toBeNull();
  });

  test("the scheduled expiry invalidates reactive visitor reads", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    try {
      const t = makeTestBackend();
      const workspaceId = await createWorkspace(t, ownerAIdentity.tokenIdentifier);
      const session = await createVisitor(t, workspaceId);

      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      await expect(
        t.query(listVisitorMessages, {
          workspaceId,
          token: session.token,
          paginationOpts: page,
        }),
      ).rejects.toThrow(/Invalid or expired visitor capability/);
    } finally {
      vi.useRealTimers();
    }
  });
});
