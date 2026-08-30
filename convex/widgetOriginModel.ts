import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const MAX_WIDGET_ORIGIN_OBSERVATIONS_PER_WORKSPACE = 100;

export async function recordWidgetOriginObservation(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  origin: string,
  now: number,
  countSession = true,
) {
  const existing = await ctx.db
    .query("widgetOriginObservations")
    .withIndex("by_workspaceId_and_origin", (q) =>
      q.eq("workspaceId", workspaceId).eq("origin", origin),
    )
    .unique();
  if (existing) {
    await ctx.db.patch("widgetOriginObservations", existing._id, {
      ...(countSession ? { sessionCount: existing.sessionCount + 1 } : {}),
      lastSeenAt: now,
    });
    return;
  }

  // A resumed capability is not a new session bootstrap. If its observation
  // was cleared while the session remained valid, wait for a genuinely new
  // session before recreating the row.
  if (!countSession) return;

  const retained = await ctx.db
    .query("widgetOriginObservations")
    .withIndex("by_workspaceId_and_lastSeenAt", (q) =>
      q.eq("workspaceId", workspaceId),
    )
    .order("desc")
    .take(MAX_WIDGET_ORIGIN_OBSERVATIONS_PER_WORKSPACE);
  if (retained.length >= MAX_WIDGET_ORIGIN_OBSERVATIONS_PER_WORKSPACE) return;

  await ctx.db.insert("widgetOriginObservations", {
    workspaceId,
    origin,
    sessionCount: 1,
    firstSeenAt: now,
    lastSeenAt: now,
  });
}

export async function clearWidgetOriginObservations(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
) {
  const observations = await ctx.db
    .query("widgetOriginObservations")
    .withIndex("by_workspaceId_and_lastSeenAt", (q) =>
      q.eq("workspaceId", workspaceId),
    )
    .take(MAX_WIDGET_ORIGIN_OBSERVATIONS_PER_WORKSPACE);
  await Promise.all(
    observations.map((observation) =>
      ctx.db.delete("widgetOriginObservations", observation._id),
    ),
  );
}
