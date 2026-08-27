import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  chatError,
  getIdempotentMessage,
  insertMessage,
  normalizeBody,
  toConversationItem,
  toMessageItem,
  validatePageSize,
} from "./chatModel";
import { requireOwnedConversation, requireOwnerWorkspace } from "./chatOwner";
import {
  conversationItemValidator,
  messageItemValidator,
} from "./chatValidators";

export const listConversations = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(conversationItemValidator),
  handler: async (ctx, args) => {
    validatePageSize(args.paginationOpts);
    const workspace = await requireOwnerWorkspace(ctx);
    const result = await ctx.db
      .query("conversations")
      .withIndex("by_workspaceId_and_hasMessages_and_lastMessageAt", (q) =>
        q.eq("workspaceId", workspace._id).eq("hasMessages", true),
      )
      .order("desc")
      .paginate(args.paginationOpts);

    const page = await Promise.all(
      result.page.map(async (conversation) => {
        const visitor = await ctx.db.get("visitors", conversation.visitorId);
        if (!visitor || visitor.workspaceId !== workspace._id) {
          throw chatError("CONVERSATION_NOT_FOUND", "Conversation not found.");
        }
        return toConversationItem(conversation, visitor);
      }),
    );
    return { ...result, page };
  },
});

export const getConversation = query({
  args: { conversationId: v.id("conversations") },
  returns: conversationItemValidator,
  handler: async (ctx, args) => {
    const { workspace, conversation } = await requireOwnedConversation(
      ctx,
      args.conversationId,
    );
    const visitor = await ctx.db.get("visitors", conversation.visitorId);
    if (!visitor || visitor.workspaceId !== workspace._id) {
      throw chatError("CONVERSATION_NOT_FOUND", "Conversation not found.");
    }
    return toConversationItem(conversation, visitor);
  },
});

export const listMessages = query({
  args: {
    conversationId: v.id("conversations"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(messageItemValidator),
  handler: async (ctx, args) => {
    validatePageSize(args.paginationOpts);
    const { conversation } = await requireOwnedConversation(
      ctx,
      args.conversationId,
    );
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

export const sendReply = mutation({
  args: {
    conversationId: v.id("conversations"),
    clientMessageId: v.string(),
    body: v.string(),
  },
  returns: messageItemValidator,
  handler: async (ctx, args) => {
    const { conversation } = await requireOwnedConversation(
      ctx,
      args.conversationId,
    );
    const body = normalizeBody(args.body);
    const idempotency = await getIdempotentMessage(
      ctx,
      conversation._id,
      args.clientMessageId,
      "owner",
      body,
    );
    if (idempotency.existing) {
      return toMessageItem(idempotency.existing);
    }
    if (conversation.status === "resolved") {
      throw chatError(
        "CONVERSATION_RESOLVED",
        "Resolved conversations cannot be replied to.",
      );
    }

    const now = Date.now();
    const message = await insertMessage(
      ctx,
      conversation,
      idempotency.normalizedId,
      "owner",
      body,
      now,
    );
    await ctx.db.patch("conversations", conversation._id, {
      updatedAt: now,
      lastMessageAt: now,
      lastMessageAuthor: "owner",
      lastMessageBody: body,
      lastMessageSequence: message.sequence,
      unreadCount: 0,
    });
    return toMessageItem(message);
  },
});

export const resolve = mutation({
  args: {
    conversationId: v.id("conversations"),
    clientMessageId: v.string(),
  },
  returns: messageItemValidator,
  handler: async (ctx, args) => {
    const { conversation } = await requireOwnedConversation(
      ctx,
      args.conversationId,
    );
    const body = "Conversation resolved";
    const idempotency = await getIdempotentMessage(
      ctx,
      conversation._id,
      args.clientMessageId,
      "system",
      body,
    );
    if (idempotency.existing) {
      return toMessageItem(idempotency.existing);
    }
    if (conversation.status === "resolved") {
      throw chatError("CONVERSATION_RESOLVED", "Conversation is already resolved.");
    }

    const now = Date.now();
    const message = await insertMessage(
      ctx,
      conversation,
      idempotency.normalizedId,
      "system",
      body,
      now,
    );
    await ctx.db.patch("conversations", conversation._id, {
      status: "resolved",
      updatedAt: now,
      resolvedAt: now,
      lastMessageAt: now,
      lastMessageAuthor: "system",
      lastMessageBody: body,
      lastMessageSequence: message.sequence,
      unreadCount: 0,
    });
    return toMessageItem(message);
  },
});

export const markRead = mutation({
  args: { conversationId: v.id("conversations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { conversation } = await requireOwnedConversation(ctx, args.conversationId);
    if (conversation.unreadCount !== 0) {
      await ctx.db.patch("conversations", conversation._id, {
        unreadCount: 0,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});
