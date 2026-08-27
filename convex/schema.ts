import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const widgetThemeValidator = v.union(
  v.literal("blue"),
  v.literal("green"),
  v.literal("red"),
  v.literal("amber"),
  v.literal("zinc"),
);

export const widgetPositionValidator = v.union(
  v.literal("bottomLeft"),
  v.literal("bottomRight"),
);

export const widgetSettingsValidator = v.object({
  displayName: v.string(),
  greeting: v.string(),
  theme: widgetThemeValidator,
  position: widgetPositionValidator,
});

export const messageAuthorValidator = v.union(
  v.literal("visitor"),
  v.literal("owner"),
  v.literal("system"),
);

export const conversationStatusValidator = v.union(
  v.literal("open"),
  v.literal("resolved"),
);

export const visitorContextFields = {
  city: v.optional(v.string()),
  country: v.optional(v.string()),
  timezone: v.optional(v.string()),
  locale: v.optional(v.string()),
  device: v.optional(v.string()),
  pageUrl: v.optional(v.string()),
  pageTitle: v.optional(v.string()),
};

export default defineSchema({
  setupChecks: defineTable({
    name: v.literal("database"),
    completedAt: v.number(),
  }).index("by_name", ["name"]),
  workspaces: defineTable({
    name: v.string(),
    ownerAuthUserId: v.string(),
    ownerTokenIdentifier: v.optional(v.string()),
  })
    .index("by_ownerAuthUserId", ["ownerAuthUserId"])
    .index("by_ownerTokenIdentifier", ["ownerTokenIdentifier"]),
  widgetSettings: defineTable(
    widgetSettingsValidator.extend({
      ownerTokenIdentifier: v.string(),
      workspaceId: v.optional(v.id("workspaces")),
      updatedAt: v.number(),
    }),
  )
    .index("by_ownerTokenIdentifier", ["ownerTokenIdentifier"])
    .index("by_workspaceId", ["workspaceId"]),
  visitors: defineTable({
    workspaceId: v.id("workspaces"),
    capabilityToken: v.string(),
    capabilityExpiresAt: v.number(),
    capabilityExpired: v.boolean(),
    createdAt: v.number(),
    lastSeenAt: v.number(),
    ...visitorContextFields,
  }).index("by_workspaceId_and_capabilityToken", [
    "workspaceId",
    "capabilityToken",
  ]),
  conversations: defineTable({
    workspaceId: v.id("workspaces"),
    visitorId: v.id("visitors"),
    status: conversationStatusValidator,
    hasMessages: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    resolvedAt: v.union(v.number(), v.null()),
    lastMessageAt: v.union(v.number(), v.null()),
    lastMessageAuthor: v.union(messageAuthorValidator, v.null()),
    lastMessageBody: v.union(v.string(), v.null()),
    lastMessageSequence: v.number(),
    unreadCount: v.number(),
  })
    .index("by_visitorId", ["visitorId"])
    .index("by_workspaceId_and_hasMessages_and_lastMessageAt", [
      "workspaceId",
      "hasMessages",
      "lastMessageAt",
    ]),
  messages: defineTable({
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    sequence: v.number(),
    author: messageAuthorValidator,
    body: v.string(),
    clientMessageId: v.string(),
    createdAt: v.number(),
  })
    .index("by_conversationId_and_sequence", ["conversationId", "sequence"])
    .index("by_clientMessageId", ["clientMessageId"]),
});
