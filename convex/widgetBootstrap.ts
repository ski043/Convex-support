import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";
import { normalizeWidgetOrigin } from "../lib/widget-bootstrap-token";

export async function getWidgetOriginPolicy(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
  origin: string,
) {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (!workspace) return null;
  const normalizedOrigin = normalizeWidgetOrigin(origin);
  if (!normalizedOrigin) return null;
  const settings = await ctx.db
    .query("widgetSettings")
    .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
    .unique();
  const mode = settings?.originPolicy ?? "legacy_limited";
  const allowedOrigins = settings?.allowedOrigins ?? [];
  return {
    allowed: mode === "legacy_limited" || allowedOrigins.includes(normalizedOrigin),
    mode,
    policyVersion: settings?.securityUpdatedAt ?? settings?.updatedAt ?? 0,
    origin: normalizedOrigin,
  } as const;
}

export const getPolicy = query({
  args: {
    workspaceId: v.id("workspaces"),
    origin: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      allowed: v.boolean(),
      mode: v.union(v.literal("legacy_limited"), v.literal("enforced")),
      policyVersion: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const policy = await getWidgetOriginPolicy(ctx, args.workspaceId, args.origin);
    if (!policy) return null;
    return {
      allowed: policy.allowed,
      mode: policy.mode,
      policyVersion: policy.policyVersion,
    };
  },
});
