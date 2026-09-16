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
import {
  invalidateForOwnerTakeoverInTransaction,
  invalidateForResolveInTransaction,
  mirrorCanonicalMessageInTransaction,
} from "./aiAutomation";

async function automationSummary(
  ctx: Parameters<typeof requireOwnerWorkspace>[0],
  conversationId: Parameters<typeof requireOwnedConversation>[1],
) {
  const state = await ctx.db
    .query("aiConversationStates")
    .withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId))
    .unique();
  if (!state) return undefined;
  const run = state.activeRunId ? await ctx.db.get("aiRuns", state.activeRunId) : null;
  return {
    mode: state.mode,
    attention: state.attention,
    isAiTyping:
      state.mode === "ai" &&
      (run?.status === "queued" || run?.status === "running"),
  };
}

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
        return toConversationItem(
          conversation,
          visitor,
          await automationSummary(ctx, conversation._id),
        );
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
    return toConversationItem(
      conversation,
      visitor,
      await automationSummary(ctx, conversation._id),
    );
  },
});

export const listNeedsHuman = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(conversationItemValidator),
  handler: async (ctx, args) => {
    validatePageSize(args.paginationOpts);
    const workspace = await requireOwnerWorkspace(ctx);
    const result = await ctx.db
      .query("aiConversationStates")
      .withIndex("by_workspaceId_and_attention_and_updatedAt", (q) =>
        q.eq("workspaceId", workspace._id).eq("attention", "needs_human"),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    const page = await Promise.all(
      result.page.map(async (state) => {
        const conversation = await ctx.db.get("conversations", state.conversationId);
        if (!conversation || conversation.workspaceId !== workspace._id) {
          throw chatError("CONVERSATION_NOT_FOUND", "Conversation not found.");
        }
        const visitor = await ctx.db.get("visitors", conversation.visitorId);
        if (!visitor || visitor.workspaceId !== workspace._id) {
          throw chatError("CONVERSATION_NOT_FOUND", "Conversation not found.");
        }
        const run = state.activeRunId ? await ctx.db.get("aiRuns", state.activeRunId) : null;
        return toConversationItem(conversation, visitor, {
          mode: state.mode,
          attention: state.attention,
          isAiTyping:
            state.mode === "ai" &&
            (run?.status === "queued" || run?.status === "running"),
        });
      }),
    );
    return { ...result, page };
  },
});

export const listCitations = query({
  args: { messageId: v.id("messages") },
  returns: v.array(
    v.object({
      documentTitle: v.string(),
      pageNumber: v.optional(v.number()),
      heading: v.optional(v.string()),
      segmentIndex: v.optional(v.number()),
      segmentText: v.optional(v.string()),
      supportingQuote: v.optional(v.string()),
      excerpt: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const message = await ctx.db.get("messages", args.messageId);
    if (!message) throw chatError("MESSAGE_NOT_FOUND", "Message not found.");
    const { workspace } = await requireOwnedConversation(ctx, message.conversationId);
    if (message.workspaceId !== workspace._id || message.author !== "assistant") {
      throw chatError("MESSAGE_NOT_FOUND", "Message not found.");
    }
    const citations = await ctx.db
      .query("aiCitations")
      .withIndex("by_workspaceId_and_messageId", (q) =>
        q.eq("workspaceId", workspace._id).eq("messageId", message._id),
      )
      .take(20);
    return citations
      .map((citation) => ({
        documentTitle: citation.documentTitle,
        ...(citation.pageNumber === undefined
          ? {}
          : { pageNumber: citation.pageNumber }),
        ...(citation.heading === undefined ? {} : { heading: citation.heading }),
        ...(citation.segmentIndex === undefined
          ? {}
          : { segmentIndex: citation.segmentIndex }),
        ...(citation.segmentText === undefined
          ? {}
          : { segmentText: citation.segmentText }),
        ...(citation.supportingQuote === undefined
          ? {}
          : { supportingQuote: citation.supportingQuote }),
        excerpt: citation.excerpt,
      }))
      .sort(
        (left, right) =>
          (left.segmentIndex ?? Number.MAX_SAFE_INTEGER) -
          (right.segmentIndex ?? Number.MAX_SAFE_INTEGER),
      );
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

    await invalidateForOwnerTakeoverInTransaction(ctx, conversation._id);
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
    await mirrorCanonicalMessageInTransaction(ctx, message._id);
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

    await invalidateForResolveInTransaction(ctx, conversation._id);
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
    await mirrorCanonicalMessageInTransaction(ctx, message._id);
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
