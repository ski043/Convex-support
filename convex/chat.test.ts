/// <reference types="vite/client" />

import { makeFunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { CAPABILITY_TTL_MS } from "./chatModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type WorkspaceId = GenericId<"workspaces">;
type ConversationId = GenericId<"conversations">;

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
  { workspaceId: WorkspaceId; token?: string; context: ContextInput },
  { token: string }
>("widgetChat:ensureSession");

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

function makeTestBackend() {
  return convexTest(schema, modules);
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
    context: emptyContext,
  });
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

describe("visitor sessions and isolation", () => {
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
    });

    await t.mutation(ensureSession, {
      workspaceId,
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
