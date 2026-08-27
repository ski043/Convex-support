import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import {
  ensureWorkspaceForAuthUser,
  findWorkspaceByAuthUserId,
} from "./workspaceModel";

const workspaceSummaryValidator = v.object({
  _id: v.id("workspaces"),
  name: v.string(),
});

export const getCurrent = query({
  args: {},
  returns: v.union(v.null(), workspaceSummaryValidator),
  handler: async (ctx) => {
    const authUser = await authComponent.getAuthUser(ctx);
    const workspace = await findWorkspaceByAuthUserId(ctx, authUser._id);

    if (!workspace) {
      return null;
    }

    return {
      _id: workspace._id,
      name: workspace.name,
    };
  },
});

export const ensureCurrent = mutation({
  args: {},
  returns: v.id("workspaces"),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new ConvexError("Unauthenticated");
    }

    const authUser = await authComponent.getAuthUser(ctx);
    const workspaceId = await ensureWorkspaceForAuthUser(ctx, authUser);

    const legacySettings = await ctx.db
      .query("widgetSettings")
      .withIndex("by_ownerTokenIdentifier", (q) =>
        q.eq("ownerTokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (legacySettings && !legacySettings.workspaceId) {
      await ctx.db.patch("widgetSettings", legacySettings._id, { workspaceId });
    }

    return workspaceId;
  },
});
