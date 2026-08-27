import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { authComponent } from "./auth";
import { chatError } from "./chatModel";
import { findWorkspaceByAuthUserId } from "./workspaceModel";

export async function requireOwnerWorkspace(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw chatError("UNAUTHENTICATED", "Authentication required.");
  }

  const tokenWorkspace = await ctx.db
    .query("workspaces")
    .withIndex("by_ownerTokenIdentifier", (q) =>
      q.eq("ownerTokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (tokenWorkspace) {
    return tokenWorkspace;
  }

  // Legacy workspaces are linked to the Better Auth component user ID. Keep
  // that lookup as a fallback while new callers use the canonical JWT token ID.
  const authUser = await authComponent.getAuthUser(ctx);
  const legacyWorkspace = await findWorkspaceByAuthUserId(ctx, authUser._id);
  if (!legacyWorkspace) {
    throw chatError("WORKSPACE_NOT_FOUND", "Owner workspace not found.");
  }
  return legacyWorkspace;
}

export async function requireOwnedConversation(
  ctx: QueryCtx | MutationCtx,
  conversationId: Id<"conversations">,
) {
  const workspace = await requireOwnerWorkspace(ctx);
  const conversation = await ctx.db.get("conversations", conversationId);
  if (
    !conversation ||
    conversation.workspaceId !== workspace._id ||
    !conversation.hasMessages
  ) {
    throw chatError("CONVERSATION_NOT_FOUND", "Conversation not found.");
  }
  return { workspace, conversation };
}
