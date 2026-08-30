import {
  makeFunctionReference,
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { DAY, HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import type { Id } from "./_generated/dataModel";
import { components } from "./_generated/api";
import { env, mutation, query, type MutationCtx } from "./_generated/server";
import {
  CAPABILITY_EXPIRY_SCHEDULE_STEP_MS,
  CAPABILITY_TTL_MS,
  chatError,
  findVisitorByCapability,
  generateCapabilityToken,
  getIdempotentMessage,
  getOrCreateConversation,
  insertMessage,
  normalizeBody,
  requireVisitor,
  requireWorkspace,
  sanitizeVisitorContext,
  toMessageItem,
  validateCapabilityToken,
  validatePageSize,
} from "./chatModel";
import {
  messageItemValidator,
  visitorContextInputValidator,
} from "./chatValidators";
import { widgetSettingsValidator } from "./schema";
import { getWidgetOriginPolicy } from "./widgetBootstrap";
import { verifyWidgetBootstrap } from "../lib/widget-bootstrap-token";
import { queueVisitorMessageInTransaction } from "./aiAutomation";

const defaultWidgetSettings = {
  displayName: "MarshalDesk support",
  greeting: "Hi there! How can we help today?",
  theme: "blue",
  position: "bottomRight",
} as const;

const widgetRateLimiter = new RateLimiter(components.rateLimiter, {
  legacyNewSession: { kind: "token bucket", rate: 5, period: HOUR, capacity: 5 },
  configuredNewSession: {
    kind: "token bucket",
    rate: 30,
    period: HOUR,
    capacity: 10,
  },
  workspaceNewSession: {
    kind: "fixed window",
    rate: 250,
    period: DAY,
    capacity: 250,
  },
  globalNewSession: {
    kind: "token bucket",
    rate: 2_000,
    period: HOUR,
    capacity: 500,
    shards: 10,
  },
  visitorMessageBurst: {
    kind: "token bucket",
    rate: 12,
    period: MINUTE,
    capacity: 6,
  },
  workspaceMessages: {
    kind: "token bucket",
    rate: 1_000,
    period: HOUR,
    capacity: 200,
    shards: 5,
  },
});

export async function recordWidgetOriginObservation(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  origin: string,
  now: number,
) {
  const existing = await ctx.db
    .query("widgetOriginObservations")
    .withIndex("by_workspaceId_and_origin", (q) =>
      q.eq("workspaceId", workspaceId).eq("origin", origin),
    )
    .unique();
  if (existing) {
    await ctx.db.patch("widgetOriginObservations", existing._id, {
      sessionCount: existing.sessionCount + 1,
      lastSeenAt: now,
    });
    return;
  }
  await ctx.db.insert("widgetOriginObservations", {
    workspaceId,
    origin,
    sessionCount: 1,
    firstSeenAt: now,
    lastSeenAt: now,
  });
}

async function requireValidBootstrap(
  ctx: Parameters<typeof getWidgetOriginPolicy>[0],
  workspaceId: Id<"workspaces">,
  bootstrapToken: string,
  now: number,
) {
  const secret = env.WIDGET_BOOTSTRAP_SECRET;
  if (!secret || secret.length < 32) {
    throw chatError("WIDGET_UNAVAILABLE", "Widget session unavailable.");
  }
  const claims = await verifyWidgetBootstrap(bootstrapToken, secret);
  if (
    !claims ||
    claims.workspaceId !== workspaceId ||
    claims.expiresAt <= now ||
    claims.issuedAt > now + 60_000
  ) {
    throw chatError("INVALID_BOOTSTRAP", "Widget session unavailable.");
  }
  const policy = await getWidgetOriginPolicy(ctx, workspaceId, claims.origin);
  if (
    !policy?.allowed ||
    policy.origin !== claims.origin ||
    policy.policyVersion !== claims.policyVersion
  ) {
    throw chatError("INVALID_BOOTSTRAP", "Widget session unavailable.");
  }
  return { claims, policy };
}

const expireCapabilityReference = makeFunctionReference<
  "mutation",
  { visitorId: Id<"visitors">; expectedExpiresAt: number },
  null
>("widgetChatInternal:expireCapability");

const deleteBootstrapUseReference = makeFunctionReference<
  "mutation",
  {
    bootstrapUseId: Id<"widgetBootstrapUses">;
    nonce: string;
    expectedExpiresAt: number;
  },
  null
>("widgetChatInternal:deleteBootstrapUse");

export const getConfig = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(v.null(), widgetSettingsValidator),
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) {
      return null;
    }

    const settings = await ctx.db
      .query("widgetSettings")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspace._id))
      .unique();

    return settings
      ? {
          displayName: settings.displayName,
          greeting: settings.greeting,
          theme: settings.theme,
          position: settings.position,
        }
      : defaultWidgetSettings;
  },
});

export const ensureSession = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    bootstrapToken: v.string(),
    token: v.optional(v.string()),
    context: visitorContextInputValidator,
  },
  returns: v.object({ token: v.string() }),
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const now = Date.now();
    const { claims, policy } = await requireValidBootstrap(
      ctx,
      args.workspaceId,
      args.bootstrapToken,
      now,
    );
    const capabilityExpiresAt = now + CAPABILITY_TTL_MS;
    const contextPatch = sanitizeVisitorContext(args.context);

    if (args.token !== undefined) {
      const token = validateCapabilityToken(args.token);
      const visitor = await findVisitorByCapability(ctx, args.workspaceId, token);
      if (
        !visitor ||
        visitor.capabilityExpired ||
        visitor.capabilityExpiresAt <= now ||
        (visitor.origin !== undefined && visitor.origin !== claims.origin)
      ) {
        throw chatError("INVALID_CAPABILITY", "Invalid or expired visitor capability.");
      }

      await ctx.db.patch("visitors", visitor._id, {
        ...contextPatch,
        origin: claims.origin,
        lastSeenAt: now,
        capabilityExpiresAt,
        capabilityExpired: false,
      });
      await recordWidgetOriginObservation(
        ctx,
        args.workspaceId,
        claims.origin,
        now,
      );
      await ctx.scheduler.runAt(
        Math.min(capabilityExpiresAt, now + CAPABILITY_EXPIRY_SCHEDULE_STEP_MS),
        expireCapabilityReference,
        {
          visitorId: visitor._id,
          expectedExpiresAt: capabilityExpiresAt,
        },
      );
      return { token };
    }

    const priorUse = await ctx.db
      .query("widgetBootstrapUses")
      .withIndex("by_nonce", (q) => q.eq("nonce", claims.nonce))
      .unique();
    if (priorUse) {
      throw chatError("BOOTSTRAP_REPLAYED", "Widget session unavailable.");
    }
    const originLimit = await widgetRateLimiter.limit(
      ctx,
      policy.mode === "legacy_limited" ? "legacyNewSession" : "configuredNewSession",
      { key: `${args.workspaceId}:${claims.origin}` },
    );
    const workspaceLimit = await widgetRateLimiter.limit(ctx, "workspaceNewSession", {
      key: args.workspaceId,
    });
    const globalLimit = await widgetRateLimiter.limit(ctx, "globalNewSession");
    if (!originLimit.ok || !workspaceLimit.ok || !globalLimit.ok) {
      throw chatError("SESSION_RATE_LIMITED", "Widget session unavailable.");
    }

    let token: string | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const candidate = generateCapabilityToken();
      const collision = await findVisitorByCapability(
        ctx,
        args.workspaceId,
        candidate,
      );
      if (!collision) {
        token = candidate;
        break;
      }
    }
    if (token === null) {
      throw chatError(
        "CAPABILITY_GENERATION_FAILED",
        "Could not create visitor session.",
      );
    }

    const visitorId = await ctx.db.insert("visitors", {
      workspaceId: args.workspaceId,
      capabilityToken: token,
      capabilityExpiresAt,
      capabilityExpired: false,
      createdAt: now,
      lastSeenAt: now,
      origin: claims.origin,
      ...contextPatch,
    });
    const bootstrapUseId = await ctx.db.insert("widgetBootstrapUses", {
      workspaceId: args.workspaceId,
      nonce: claims.nonce,
      origin: claims.origin,
      expiresAt: claims.expiresAt,
      sessionCreatedAt: now,
      createdAt: now,
    });
    await recordWidgetOriginObservation(
      ctx,
      args.workspaceId,
      claims.origin,
      now,
    );
    await ctx.scheduler.runAt(claims.expiresAt, deleteBootstrapUseReference, {
      bootstrapUseId,
      nonce: claims.nonce,
      expectedExpiresAt: claims.expiresAt,
    });
    await ctx.scheduler.runAt(
      Math.min(capabilityExpiresAt, now + CAPABILITY_EXPIRY_SCHEDULE_STEP_MS),
      expireCapabilityReference,
      {
        visitorId,
        expectedExpiresAt: capabilityExpiresAt,
      },
    );
    return { token };
  },
});

export const updateContext = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    token: v.string(),
    context: visitorContextInputValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const visitor = await requireVisitor(ctx, args.workspaceId, args.token, now);
    await ctx.db.patch("visitors", visitor._id, {
      ...sanitizeVisitorContext(args.context),
      lastSeenAt: now,
    });
    return null;
  },
});

export const getAutomationState = query({
  args: {
    workspaceId: v.id("workspaces"),
    token: v.string(),
  },
  returns: v.object({
    isAiTyping: v.boolean(),
    handling: v.union(v.literal("ai"), v.literal("human")),
    needsHuman: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const visitor = await requireVisitor(ctx, args.workspaceId, args.token);
    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_visitorId", (q) => q.eq("visitorId", visitor._id))
      .unique();
    if (!conversation) {
      return { isAiTyping: false, handling: "ai" as const, needsHuman: false };
    }
    const state = await ctx.db
      .query("aiConversationStates")
      .withIndex("by_conversationId", (q) => q.eq("conversationId", conversation._id))
      .unique();
    if (!state) {
      return { isAiTyping: false, handling: "ai" as const, needsHuman: false };
    }
    const run = state.activeRunId ? await ctx.db.get("aiRuns", state.activeRunId) : null;
    return {
      isAiTyping:
        state.mode === "ai" &&
        (run?.status === "queued" || run?.status === "running"),
      handling: state.mode === "ai" ? ("ai" as const) : ("human" as const),
      needsHuman: state.attention === "needs_human",
    };
  },
});

export const listMessages = query({
  args: {
    workspaceId: v.id("workspaces"),
    token: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(messageItemValidator),
  handler: async (ctx, args) => {
    validatePageSize(args.paginationOpts);
    const visitor = await requireVisitor(ctx, args.workspaceId, args.token);
    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_visitorId", (q) => q.eq("visitorId", visitor._id))
      .unique();
    if (!conversation) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    if (conversation.workspaceId !== args.workspaceId) {
      throw chatError("CONVERSATION_NOT_FOUND", "Conversation not found.");
    }

    const result = await ctx.db
      .query("messages")
      .withIndex("by_conversationId_and_sequence", (q) =>
        q.eq("conversationId", conversation._id),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return { ...result, page: result.page.map(toMessageItem) };
  },
});

export const sendMessage = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    token: v.string(),
    clientMessageId: v.string(),
    body: v.string(),
    context: visitorContextInputValidator,
  },
  returns: messageItemValidator,
  handler: async (ctx, args) => {
    const now = Date.now();
    const visitor = await requireVisitor(ctx, args.workspaceId, args.token, now);
    const body = normalizeBody(args.body);
    await ctx.db.patch("visitors", visitor._id, {
      ...sanitizeVisitorContext(args.context),
      lastSeenAt: now,
    });

    const conversation = await getOrCreateConversation(ctx, visitor, now);
    const reopened = conversation.status === "resolved";
    const idempotency = await getIdempotentMessage(
      ctx,
      conversation._id,
      args.clientMessageId,
      "visitor",
      body,
    );
    if (idempotency.existing) {
      return toMessageItem(idempotency.existing);
    }

    const visitorLimit = await widgetRateLimiter.limit(ctx, "visitorMessageBurst", {
      key: visitor._id,
    });
    const workspaceLimit = await widgetRateLimiter.limit(ctx, "workspaceMessages", {
      key: visitor.workspaceId,
    });
    if (!visitorLimit.ok || !workspaceLimit.ok) {
      throw chatError("MESSAGE_RATE_LIMITED", "Please wait before sending again.");
    }

    const message = await insertMessage(
      ctx,
      conversation,
      idempotency.normalizedId,
      "visitor",
      body,
      now,
    );
    await ctx.db.patch("conversations", conversation._id, {
      status: "open",
      hasMessages: true,
      updatedAt: now,
      resolvedAt: null,
      lastMessageAt: now,
      lastMessageAuthor: "visitor",
      lastMessageBody: body,
      lastMessageSequence: message.sequence,
      unreadCount: conversation.unreadCount + 1,
    });
    await queueVisitorMessageInTransaction(ctx, {
      conversationId: conversation._id,
      messageId: message._id,
      reopened,
    });
    return toMessageItem(message);
  },
});
