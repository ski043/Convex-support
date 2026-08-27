import { Presence } from "@convex-dev/presence";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { chatError, requireVisitor } from "./chatModel";
import { requireOwnedConversation } from "./chatOwner";

export const TYPING_HEARTBEAT_INTERVAL_MS = 1_500;

const MAX_PRESENCE_ROWS = 104;
const MAX_OWNER_DISPLAY_NAME_LENGTH = 40;
const DEFAULT_OWNER_DISPLAY_NAME = "MarshalDesk support";
const ROOM_PREFIX = "typing:conversation:";
const PARTICIPANT_SEPARATOR = "|";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const heartbeatResultValidator = v.object({
  roomToken: v.string(),
  sessionToken: v.string(),
});

const typingSummaryValidator = v.object({
  visitorTyping: v.boolean(),
  ownerTyping: v.boolean(),
  ownerDisplayName: v.union(v.string(), v.null()),
});

type TypingRole = "visitor" | "owner";
type PresenceData = {
  role: TypingRole;
  typing: boolean;
  displayName?: string;
};
type PresenceRow = {
  userId: string;
  online: boolean;
  data?: unknown;
};

const presence = new Presence<string, string>(components.presence);

const NOT_TYPING = {
  visitorTyping: false,
  ownerTyping: false,
  ownerDisplayName: null,
} as const;

function validateSessionId(sessionId: string) {
  const normalized = sessionId.toLowerCase();
  if (sessionId.length !== 36 || !UUID_PATTERN.test(normalized)) {
    throw chatError("INVALID_SESSION_ID", "sessionId must be a UUID.");
  }
  return normalized;
}

function roomIdFor(conversationId: Id<"conversations">) {
  return `${ROOM_PREFIX}${conversationId}`;
}

function visitorParticipantId(
  conversation: Doc<"conversations">,
  sessionId: string,
) {
  return [
    roomIdFor(conversation._id),
    "visitor",
    conversation.visitorId,
    validateSessionId(sessionId),
  ].join(PARTICIPANT_SEPARATOR);
}

function ownerParticipantId(
  conversation: Doc<"conversations">,
  sessionId: string,
) {
  return [
    roomIdFor(conversation._id),
    "owner",
    conversation.workspaceId,
    validateSessionId(sessionId),
  ].join(PARTICIPANT_SEPARATOR);
}

function isExpectedParticipantId(
  userId: string,
  conversation: Doc<"conversations">,
) {
  const parts = userId.split(PARTICIPANT_SEPARATOR);
  if (parts.length !== 4 || !UUID_PATTERN.test(parts[3] ?? "")) {
    return false;
  }

  const expectedRoomId = roomIdFor(conversation._id);
  const [roomId, role, principalId] = parts;
  return (
    roomId === expectedRoomId &&
    ((role === "visitor" && principalId === conversation.visitorId) ||
      (role === "owner" && principalId === conversation.workspaceId))
  );
}

function parsePresenceData(value: unknown): PresenceData | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const data = value as Record<string, unknown>;
  if (
    (data.role !== "visitor" && data.role !== "owner") ||
    typeof data.typing !== "boolean"
  ) {
    return null;
  }
  if (
    data.displayName !== undefined &&
    (typeof data.displayName !== "string" ||
      data.displayName.length > MAX_OWNER_DISPLAY_NAME_LENGTH)
  ) {
    return null;
  }
  if (data.role === "visitor" && data.displayName !== undefined) {
    return null;
  }

  return data.role === "owner" && data.displayName !== undefined
    ? { role: data.role, typing: data.typing, displayName: data.displayName }
    : { role: data.role, typing: data.typing };
}

function assertRowsBelongToConversation(
  rows: PresenceRow[],
  conversation: Doc<"conversations">,
) {
  if (
    rows.length === 0 ||
    rows.some((row) => !isExpectedParticipantId(row.userId, conversation))
  ) {
    throw chatError("INVALID_ROOM_TOKEN", "Invalid presence room token.");
  }
}

function summarizeRows(rows: PresenceRow[]) {
  let visitorTyping = false;
  let ownerTyping = false;
  const typingOwnerNames: string[] = [];

  for (const row of rows) {
    const data = parsePresenceData(row.data);
    if (!row.online || data?.typing !== true) {
      continue;
    }
    if (data.role === "visitor") {
      visitorTyping = true;
    } else {
      ownerTyping = true;
      if (data.displayName !== undefined) {
        typingOwnerNames.push(data.displayName);
      }
    }
  }

  typingOwnerNames.sort();
  return {
    visitorTyping,
    ownerTyping,
    ownerDisplayName: typingOwnerNames[0] ?? null,
  };
}

async function findVisitorConversation(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
  token: string,
  currentTime?: number,
) {
  const visitor = await requireVisitor(ctx, workspaceId, token, currentTime);
  const conversation = await ctx.db
    .query("conversations")
    .withIndex("by_visitorId", (q) => q.eq("visitorId", visitor._id))
    .unique();
  if (!conversation) {
    return null;
  }
  if (
    visitor.workspaceId !== workspaceId ||
    conversation.workspaceId !== workspaceId ||
    conversation.visitorId !== visitor._id
  ) {
    throw chatError("CONVERSATION_NOT_FOUND", "Conversation not found.");
  }
  return conversation.hasMessages ? conversation : null;
}

async function getOwnerDisplayName(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
) {
  const workspaceSettings = await ctx.db
    .query("widgetSettings")
    .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
    .unique();
  const identity = await ctx.auth.getUserIdentity();
  const settings =
    workspaceSettings ??
    (identity
      ? await ctx.db
          .query("widgetSettings")
          .withIndex("by_ownerTokenIdentifier", (q) =>
            q.eq("ownerTokenIdentifier", identity.tokenIdentifier),
          )
          .unique()
      : null);
  const normalized = settings?.displayName.trim() ?? "";
  return normalized
    ? normalized.slice(0, MAX_OWNER_DISPLAY_NAME_LENGTH)
    : DEFAULT_OWNER_DISPLAY_NAME;
}

async function listTyping(
  ctx: QueryCtx,
  conversation: Doc<"conversations">,
  roomToken: string,
) {
  const rows = await presence.list(ctx, roomToken, MAX_PRESENCE_ROWS);
  assertRowsBelongToConversation(rows, conversation);
  return summarizeRows(rows);
}

export const heartbeatVisitor = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    token: v.string(),
    sessionId: v.string(),
  },
  returns: v.union(heartbeatResultValidator, v.null()),
  handler: async (ctx, args) => {
    const conversation = await findVisitorConversation(
      ctx,
      args.workspaceId,
      args.token,
      Date.now(),
    );
    if (!conversation) {
      return null;
    }

    const roomId = roomIdFor(conversation._id);
    const userId = visitorParticipantId(conversation, args.sessionId);
    return await presence.heartbeat(
      ctx,
      roomId,
      userId,
      validateSessionId(args.sessionId),
      TYPING_HEARTBEAT_INTERVAL_MS,
    );
  },
});

export const heartbeatOwner = mutation({
  args: {
    conversationId: v.id("conversations"),
    sessionId: v.string(),
  },
  returns: heartbeatResultValidator,
  handler: async (ctx, args) => {
    const { conversation } = await requireOwnedConversation(
      ctx,
      args.conversationId,
    );
    const roomId = roomIdFor(conversation._id);
    const userId = ownerParticipantId(conversation, args.sessionId);
    return await presence.heartbeat(
      ctx,
      roomId,
      userId,
      validateSessionId(args.sessionId),
      TYPING_HEARTBEAT_INTERVAL_MS,
    );
  },
});

export const listForVisitor = query({
  args: {
    workspaceId: v.id("workspaces"),
    token: v.string(),
    roomToken: v.string(),
  },
  returns: typingSummaryValidator,
  handler: async (ctx, args) => {
    const conversation = await findVisitorConversation(
      ctx,
      args.workspaceId,
      args.token,
    );
    return conversation
      ? await listTyping(ctx, conversation, args.roomToken)
      : NOT_TYPING;
  },
});

export const listForOwner = query({
  args: {
    conversationId: v.id("conversations"),
    roomToken: v.string(),
  },
  returns: typingSummaryValidator,
  handler: async (ctx, args) => {
    const { conversation } = await requireOwnedConversation(
      ctx,
      args.conversationId,
    );
    return await listTyping(ctx, conversation, args.roomToken);
  },
});

export const setVisitorTyping = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    token: v.string(),
    sessionId: v.string(),
    typing: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const conversation = await findVisitorConversation(
      ctx,
      args.workspaceId,
      args.token,
      Date.now(),
    );
    if (!conversation) {
      return null;
    }
    await presence.updateRoomUser(
      ctx,
      roomIdFor(conversation._id),
      visitorParticipantId(conversation, args.sessionId),
      { role: "visitor", typing: args.typing } satisfies PresenceData,
    );
    return null;
  },
});

export const setOwnerTyping = mutation({
  args: {
    conversationId: v.id("conversations"),
    sessionId: v.string(),
    typing: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace, conversation } = await requireOwnedConversation(
      ctx,
      args.conversationId,
    );
    await presence.updateRoomUser(
      ctx,
      roomIdFor(conversation._id),
      ownerParticipantId(conversation, args.sessionId),
      {
        role: "owner",
        typing: args.typing,
        displayName: await getOwnerDisplayName(ctx, workspace._id),
      } satisfies PresenceData,
    );
    return null;
  },
});

export const disconnect = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await presence.disconnect(ctx, args.sessionToken);
    return null;
  },
});
