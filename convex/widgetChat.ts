import {
  makeFunctionReference,
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
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

const defaultWidgetSettings = {
  displayName: "MarshalDesk support",
  greeting: "Hi there! How can we help today?",
  theme: "blue",
  position: "bottomRight",
} as const;

const expireCapabilityReference = makeFunctionReference<
  "mutation",
  { visitorId: Id<"visitors">; expectedExpiresAt: number },
  null
>("widgetChatInternal:expireCapability");

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
    token: v.optional(v.string()),
    context: visitorContextInputValidator,
  },
  returns: v.object({ token: v.string() }),
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const now = Date.now();
    const capabilityExpiresAt = now + CAPABILITY_TTL_MS;
    const contextPatch = sanitizeVisitorContext(args.context);

    if (args.token !== undefined) {
      const token = validateCapabilityToken(args.token);
      const visitor = await findVisitorByCapability(ctx, args.workspaceId, token);
      if (
        !visitor ||
        visitor.capabilityExpired ||
        visitor.capabilityExpiresAt <= now
      ) {
        throw chatError("INVALID_CAPABILITY", "Invalid or expired visitor capability.");
      }

      await ctx.db.patch("visitors", visitor._id, {
        ...contextPatch,
        lastSeenAt: now,
        capabilityExpiresAt,
        capabilityExpired: false,
      });
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
      ...contextPatch,
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
    return toMessageItem(message);
  },
});
