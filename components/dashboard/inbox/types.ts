import type { PaginatedQueryItem } from "convex/react";
import type { api } from "@/convex/_generated/api";

export type InboxConversation = PaginatedQueryItem<
  typeof api.inbox.listConversations
>;

export type InboxMessage = PaginatedQueryItem<typeof api.inbox.listMessages>;

export type ConversationId = InboxConversation["_id"];

export function conversationLabel(conversation: InboxConversation) {
  return `Visitor ${conversation._id.slice(-4).toUpperCase()}`;
}

export function visitorInitials(label: string) {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
