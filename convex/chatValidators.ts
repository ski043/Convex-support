import { v } from "convex/values";
import {
  conversationStatusValidator,
  messageAuthorValidator,
} from "./schema";

const nullableContextValue = v.optional(v.union(v.string(), v.null()));

export const visitorContextInputValidator = v.object({
  city: nullableContextValue,
  country: nullableContextValue,
  timezone: nullableContextValue,
  locale: nullableContextValue,
  device: nullableContextValue,
  pageUrl: nullableContextValue,
  pageTitle: nullableContextValue,
});

export const visitorSnapshotValidator = v.object({
  lastSeenAt: v.number(),
  city: v.union(v.string(), v.null()),
  country: v.union(v.string(), v.null()),
  timezone: v.union(v.string(), v.null()),
  locale: v.union(v.string(), v.null()),
  device: v.union(v.string(), v.null()),
  pageUrl: v.union(v.string(), v.null()),
  pageTitle: v.union(v.string(), v.null()),
});

export const messageItemValidator = v.object({
  _id: v.id("messages"),
  sequence: v.number(),
  author: messageAuthorValidator,
  body: v.string(),
  createdAt: v.number(),
});

export const conversationItemValidator = v.object({
  _id: v.id("conversations"),
  status: conversationStatusValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
  lastMessageAt: v.number(),
  lastMessage: v.object({
    author: messageAuthorValidator,
    body: v.string(),
    createdAt: v.number(),
  }),
  unreadCount: v.number(),
  handlingState: v.union(
    v.literal("ai_handling"),
    v.literal("needs_human"),
    v.literal("human_handling"),
    v.literal("resolved"),
  ),
  attentionState: v.union(v.literal("none"), v.literal("needs_human")),
  isAiTyping: v.boolean(),
  canTakeOver: v.boolean(),
  canResume: v.boolean(),
  visitor: visitorSnapshotValidator,
});
