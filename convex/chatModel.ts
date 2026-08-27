import { ConvexError, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { visitorContextInputValidator } from "./chatValidators";

export const CAPABILITY_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
export const CAPABILITY_EXPIRY_SCHEDULE_STEP_MS = 20 * 24 * 60 * 60 * 1_000;
export const MAX_PAGE_SIZE = 100;

const TIMEZONE_PATTERN = /^[A-Za-z0-9_+\-/]+$/;

type VisitorContextInput = Infer<typeof visitorContextInputValidator>;

type VisitorContextPatch = Partial<
  Pick<
    Doc<"visitors">,
    | "city"
    | "country"
    | "timezone"
    | "locale"
    | "device"
    | "pageUrl"
    | "pageTitle"
  >
>;

export function chatError(code: string, message: string) {
  return new ConvexError({ code, message });
}

function normalizeContextString(
  value: string | null | undefined,
  label: string,
  maxLength: number,
) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    throw chatError("INVALID_CONTEXT", `${label} cannot be empty.`);
  }
  if (normalized.length > maxLength) {
    throw chatError(
      "INVALID_CONTEXT",
      `${label} cannot exceed ${maxLength} characters.`,
    );
  }
  return normalized;
}

function sanitizePageUrl(value: string | null | undefined) {
  const normalized = normalizeContextString(value, "Page URL", 2_048);
  if (normalized === undefined) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw chatError("INVALID_CONTEXT", "Page URL must be an absolute URL.");
  }

  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username ||
    parsed.password
  ) {
    throw chatError("INVALID_CONTEXT", "Page URL must use HTTP or HTTPS.");
  }

  const sanitized = `${parsed.origin}${parsed.pathname}`;
  if (sanitized.length > 2_048) {
    throw chatError("INVALID_CONTEXT", "Page URL is too long.");
  }
  return sanitized;
}

export function sanitizeVisitorContext(
  context: VisitorContextInput,
): VisitorContextPatch {
  const city = normalizeContextString(context.city, "City", 100);
  const rawCountry = normalizeContextString(context.country, "Country", 2);
  const country = rawCountry?.toUpperCase();
  if (
    country !== undefined &&
    (!/^[A-Z]{2}$/.test(country) || country === "XX")
  ) {
    throw chatError("INVALID_CONTEXT", "Country must be a two-letter ISO code.");
  }

  const timezone = normalizeContextString(context.timezone, "Timezone", 64);
  if (timezone !== undefined) {
    if (!TIMEZONE_PATTERN.test(timezone)) {
      throw chatError("INVALID_CONTEXT", "Timezone is invalid.");
    }
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone }).format(0);
    } catch {
      throw chatError("INVALID_CONTEXT", "Timezone is invalid.");
    }
  }
  const locale = normalizeContextString(context.locale, "Locale", 35);
  const device = normalizeContextString(context.device, "Device", 160);
  const pageUrl = sanitizePageUrl(context.pageUrl);
  const pageTitle = normalizeContextString(context.pageTitle, "Page title", 200);

  return {
    ...(city === undefined ? {} : { city }),
    ...(country === undefined ? {} : { country }),
    ...(timezone === undefined ? {} : { timezone }),
    ...(locale === undefined ? {} : { locale }),
    ...(device === undefined ? {} : { device }),
    ...(pageUrl === undefined ? {} : { pageUrl }),
    ...(pageTitle === undefined ? {} : { pageTitle }),
  };
}

export function normalizeBody(body: string) {
  const normalized = body.trim();
  if (!normalized) {
    throw chatError("INVALID_MESSAGE", "Message cannot be empty.");
  }
  if (normalized.length > 4_000) {
    throw chatError("INVALID_MESSAGE", "Message cannot exceed 4000 characters.");
  }
  return normalized;
}

export function normalizeClientMessageId(clientMessageId: string) {
  const normalized = clientMessageId.toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      normalized,
    )
  ) {
    throw chatError("INVALID_MESSAGE_ID", "clientMessageId must be a UUID.");
  }
  return normalized;
}

export function validateCapabilityToken(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) {
    throw chatError("INVALID_CAPABILITY", "Invalid visitor capability.");
  }
  return token;
}

export function generateCapabilityToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function validatePageSize(paginationOpts: { numItems: number }) {
  if (
    !Number.isInteger(paginationOpts.numItems) ||
    paginationOpts.numItems < 1 ||
    paginationOpts.numItems > MAX_PAGE_SIZE
  ) {
    throw chatError(
      "INVALID_PAGE_SIZE",
      `Page size must be an integer between 1 and ${MAX_PAGE_SIZE}.`,
    );
  }
}

export async function requireWorkspace(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
) {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (!workspace) {
    throw chatError("WORKSPACE_NOT_FOUND", "Workspace not found.");
  }
  return workspace;
}

export async function findVisitorByCapability(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
  token: string,
) {
  return await ctx.db
    .query("visitors")
    .withIndex("by_workspaceId_and_capabilityToken", (q) =>
      q
        .eq("workspaceId", workspaceId)
        .eq("capabilityToken", validateCapabilityToken(token)),
    )
    .unique();
}

export async function requireVisitor(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
  token: string,
  now?: number,
) {
  const visitor = await findVisitorByCapability(ctx, workspaceId, token);
  if (
    !visitor ||
    visitor.capabilityExpired ||
    (now !== undefined && visitor.capabilityExpiresAt <= now)
  ) {
    throw chatError(
      "INVALID_CAPABILITY",
      "Invalid or expired visitor capability.",
    );
  }
  return visitor;
}

export async function getOrCreateConversation(
  ctx: MutationCtx,
  visitor: Doc<"visitors">,
  now: number,
) {
  const existing = await ctx.db
    .query("conversations")
    .withIndex("by_visitorId", (q) => q.eq("visitorId", visitor._id))
    .unique();
  if (existing) {
    if (existing.workspaceId !== visitor.workspaceId) {
      throw chatError(
        "INVALID_CONVERSATION",
        "Conversation ownership is invalid.",
      );
    }
    return existing;
  }

  const conversationId = await ctx.db.insert("conversations", {
    workspaceId: visitor.workspaceId,
    visitorId: visitor._id,
    status: "open",
    hasMessages: false,
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    lastMessageAt: null,
    lastMessageAuthor: null,
    lastMessageBody: null,
    lastMessageSequence: 0,
    unreadCount: 0,
  });
  const conversation = await ctx.db.get("conversations", conversationId);
  if (!conversation) {
    throw chatError("INVALID_CONVERSATION", "Conversation could not be created.");
  }
  return conversation;
}

export async function getIdempotentMessage(
  ctx: MutationCtx,
  conversationId: Id<"conversations">,
  clientMessageId: string,
  author: Doc<"messages">["author"],
  body: string,
) {
  const normalizedId = normalizeClientMessageId(clientMessageId);
  const existing = await ctx.db
    .query("messages")
    .withIndex("by_clientMessageId", (q) => q.eq("clientMessageId", normalizedId))
    .unique();

  if (!existing) {
    return { existing: null, normalizedId };
  }
  if (
    existing.conversationId !== conversationId ||
    existing.author !== author ||
    existing.body !== body
  ) {
    throw chatError(
      "IDEMPOTENCY_COLLISION",
      "clientMessageId was already used for a different message.",
    );
  }
  return { existing, normalizedId };
}

export async function insertMessage(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  clientMessageId: string,
  author: Doc<"messages">["author"],
  body: string,
  now: number,
) {
  const messageId = await ctx.db.insert("messages", {
    workspaceId: conversation.workspaceId,
    conversationId: conversation._id,
    sequence: conversation.lastMessageSequence + 1,
    author,
    body,
    clientMessageId,
    createdAt: now,
  });
  const message = await ctx.db.get("messages", messageId);
  if (!message) {
    throw chatError("INVALID_MESSAGE", "Message could not be created.");
  }
  return message;
}

export function toMessageItem(message: Doc<"messages">) {
  return {
    _id: message._id,
    sequence: message.sequence,
    author: message.author,
    body: message.body,
    createdAt: message.createdAt,
  };
}

export function toVisitorSnapshot(visitor: Doc<"visitors">) {
  return {
    lastSeenAt: visitor.lastSeenAt,
    city: visitor.city ?? null,
    country: visitor.country ?? null,
    timezone: visitor.timezone ?? null,
    locale: visitor.locale ?? null,
    device: visitor.device ?? null,
    pageUrl: visitor.pageUrl ?? null,
    pageTitle: visitor.pageTitle ?? null,
  };
}

export function toConversationItem(
  conversation: Doc<"conversations">,
  visitor: Doc<"visitors">,
) {
  if (
    !conversation.hasMessages ||
    conversation.lastMessageAt === null ||
    conversation.lastMessageAuthor === null ||
    conversation.lastMessageBody === null
  ) {
    throw chatError("CONVERSATION_NOT_FOUND", "Conversation not found.");
  }

  return {
    _id: conversation._id,
    status: conversation.status,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    lastMessageAt: conversation.lastMessageAt,
    lastMessage: {
      author: conversation.lastMessageAuthor,
      body: conversation.lastMessageBody,
      createdAt: conversation.lastMessageAt,
    },
    unreadCount: conversation.unreadCount,
    visitor: toVisitorSnapshot(visitor),
  };
}
