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
    // Resumes can recreate a row after an owner clears discovery, but they do
    // not refresh an existing row's display recency without a rate-limited
    // new-session bootstrap.
    if (!countSession) return;
    await ctx.db.patch("widgetOriginObservations", existing._id, {
      sessionCount: existing.sessionCount + 1,
      lastSeenAt: now,
    });
    return;
  }

  const retained = await ctx.db
    .query("widgetOriginObservations")
    .withIndex("by_workspaceId_and_lastSeenAt", (q) =>
      q.eq("workspaceId", workspaceId),
    )
    .order("desc")
    .take(MAX_WIDGET_ORIGIN_OBSERVATIONS_PER_WORKSPACE);
  if (retained.length >= MAX_WIDGET_ORIGIN_OBSERVATIONS_PER_WORKSPACE) {
    const oldest = retained.at(-1);
    if (oldest) {
      await ctx.db.delete("widgetOriginObservations", oldest._id);
    }
  }

  await ctx.db.insert("widgetOriginObservations", {
    workspaceId,
    origin,
    // A resumed capability can rediscover a cleared origin, but it is not a
    // new session bootstrap and must not inflate that metric.
    sessionCount: countSession ? 1 : 0,
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
