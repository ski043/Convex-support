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
  v.literal("assistant"),
  v.literal("system"),
);

export const messageKindValidator = v.union(
  v.literal("chat"),
  v.literal("ai_answer"),
  v.literal("handoff"),
  v.literal("resolution"),
);

export const conversationStatusValidator = v.union(
  v.literal("open"),
  v.literal("resolved"),
);

export const automationModeValidator = v.union(
  v.literal("ai"),
  v.literal("human"),
  v.literal("disabled"),
);

export const attentionStateValidator = v.union(
  v.literal("none"),
  v.literal("needs_human"),
);

export const knowledgeFileKindValidator = v.union(
  v.literal("pdf"),
  v.literal("markdown"),
  v.literal("text"),
);

export const knowledgeStatusValidator = v.union(
  v.literal("queued"),
  v.literal("processing"),
  v.literal("ready"),
  v.literal("failed"),
  v.literal("replacing"),
  v.literal("deleting"),
);

export const aiRunStatusValidator = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("accepted"),
  v.literal("discarded"),
  v.literal("failed"),
  v.literal("handed_off"),
);

export const visitorContextFields = {
  city: v.optional(v.string()),
  country: v.optional(v.string()),
  timezone: v.optional(v.string()),
  locale: v.optional(v.string()),
  device: v.optional(v.string()),
  pageUrl: v.optional(v.string()),
  pageTitle: v.optional(v.string()),
  origin: v.optional(v.string()),
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
      // Optional only for pre-enforcement workspaces. Runtime policy treats an
      // enforced empty list as deny-all, never as allow-all.
      allowedOrigins: v.optional(v.array(v.string())),
      originPolicy: v.optional(
        v.union(v.literal("legacy_limited"), v.literal("enforced")),
      ),
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
    kind: v.optional(messageKindValidator),
    aiRunId: v.optional(v.id("aiRuns")),
    createdAt: v.number(),
  })
    .index("by_conversationId_and_sequence", ["conversationId", "sequence"])
    .index("by_clientMessageId", ["clientMessageId"]),
  workspaceAiSettings: defineTable({
    workspaceId: v.id("workspaces"),
    enabled: v.boolean(),
    // Persisted model identifiers are historical/configuration data. Public
    // mutations still validate the currently supported model selection.
    answerModel: v.string(),
    handoffMessage: v.string(),
    updatedAt: v.number(),
  }).index("by_workspaceId", ["workspaceId"]),
  knowledgeDocuments: defineTable({
    workspaceId: v.id("workspaces"),
    storageId: v.id("_storage"),
    clientRequestId: v.string(),
    stableKey: v.string(),
    version: v.number(),
    replacesDocumentId: v.optional(v.id("knowledgeDocuments")),
    filename: v.string(),
    title: v.string(),
    mimeType: v.string(),
    fileKind: knowledgeFileKindValidator,
    size: v.number(),
    sha256: v.string(),
    status: knowledgeStatusValidator,
    ragEntryId: v.optional(v.string()),
    attempt: v.number(),
    processingToken: v.optional(v.string()),
    cleanupToken: v.optional(v.string()),
    cleanupAttempt: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    readyAt: v.optional(v.number()),
  })
    .index("by_workspaceId_and_createdAt", ["workspaceId", "createdAt"])
    .index("by_workspaceId_and_status", ["workspaceId", "status"])
    .index("by_workspaceId_and_stableKey_and_version", [
      "workspaceId",
      "stableKey",
      "version",
    ])
    .index("by_clientRequestId", ["clientRequestId"])
    .index("by_storageId", ["storageId"])
    .index("by_ragEntryId", ["ragEntryId"]),
  aiConversationStates: defineTable({
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    agentThreadId: v.optional(v.string()),
    mode: automationModeValidator,
    attention: attentionStateValidator,
    generationEpoch: v.number(),
    activeRunId: v.optional(v.id("aiRuns")),
    handoffReason: v.optional(v.string()),
    consecutiveAiFailures: v.optional(v.number()),
    syncedThroughSequence: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_conversationId", ["conversationId"])
    .index("by_workspaceId_and_mode", ["workspaceId", "mode"])
    .index("by_workspaceId_and_attention_and_updatedAt", [
      "workspaceId",
      "attention",
      "updatedAt",
    ])
    .index("by_agentThreadId", ["agentThreadId"]),
  aiRuns: defineTable({
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    triggerMessageId: v.id("messages"),
    epoch: v.number(),
    status: aiRunStatusValidator,
    model: v.string(),
    attempt: v.number(),
    dispatchRecoveryCount: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_conversationId_and_createdAt", ["conversationId", "createdAt"])
    .index("by_workspaceId_and_status", ["workspaceId", "status"])
    .index("by_triggerMessageId", ["triggerMessageId"]),
  messageAgentLinks: defineTable({
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    messageId: v.id("messages"),
    sequence: v.number(),
    agentThreadId: v.string(),
    agentMessageId: v.string(),
    createdAt: v.number(),
  })
    .index("by_messageId", ["messageId"])
    .index("by_conversationId_and_sequence", ["conversationId", "sequence"]),
  aiCitations: defineTable({
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    messageId: v.id("messages"),
    knowledgeDocumentId: v.id("knowledgeDocuments"),
    ragEntryId: v.string(),
    chunkOrder: v.number(),
    documentTitle: v.string(),
    pageNumber: v.optional(v.number()),
    heading: v.optional(v.string()),
    excerpt: v.string(),
    citationId: v.optional(v.string()),
    segmentIndex: v.optional(v.number()),
    segmentText: v.optional(v.string()),
    supportingQuote: v.optional(v.string()),
    score: v.number(),
    createdAt: v.number(),
  })
    .index("by_messageId", ["messageId"])
    .index("by_workspaceId_and_messageId", ["workspaceId", "messageId"]),
  aiUsageRecords: defineTable({
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    runId: v.id("aiRuns"),
    attempt: v.number(),
    provider: v.string(),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    totalTokens: v.number(),
    createdAt: v.number(),
  })
    .index("by_runId_and_attempt", ["runId", "attempt"])
    .index("by_workspaceId_and_createdAt", ["workspaceId", "createdAt"]),
  workspaceAiUsage: defineTable({
    workspaceId: v.id("workspaces"),
    period: v.string(),
    requests: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    totalTokens: v.number(),
    updatedAt: v.number(),
  }).index("by_workspaceId_and_period", ["workspaceId", "period"]),
  widgetBootstrapUses: defineTable({
    workspaceId: v.id("workspaces"),
    nonce: v.string(),
    origin: v.string(),
    expiresAt: v.number(),
    sessionCreatedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_nonce", ["nonce"])
    .index("by_expiresAt", ["expiresAt"])
    .index("by_workspaceId_and_createdAt", ["workspaceId", "createdAt"]),
});
