import type { MutationCtx, QueryCtx } from "./_generated/server";

type AuthUser = {
  _id: string;
  name: string;
};

export async function findWorkspaceByAuthUserId(
  ctx: QueryCtx | MutationCtx,
  authUserId: string,
) {
  return await ctx.db
    .query("workspaces")
    .withIndex("by_ownerAuthUserId", (q) => q.eq("ownerAuthUserId", authUserId))
    .unique();
}

export async function ensureWorkspaceForAuthUser(ctx: MutationCtx, authUser: AuthUser) {
  const existing = await findWorkspaceByAuthUserId(ctx, authUser._id);

  if (existing) {
    return existing._id;
  }

  const ownerName = authUser.name.trim();

  return await ctx.db.insert("workspaces", {
    name: ownerName ? `${ownerName}'s workspace` : "My workspace",
    ownerAuthUserId: authUser._id,
  });
}
