import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const MAX_WIDGET_ORIGIN_OBSERVATIONS_PER_WORKSPACE = 100;
const MAX_WIDGET_ORIGIN_OVERFLOW_ROWS_READ = 100;
const WIDGET_ORIGIN_CLEAR_BATCH_SIZE = 100;

async function repairWidgetOriginObservationOverflow(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  slotsNeeded: 0 | 1,
) {
  const oldestWindow = await ctx.db
    .query("widgetOriginObservations")
    .withIndex("by_workspaceId_and_lastSeenAt", (q) =>
      q.eq("workspaceId", workspaceId),
    )
    .order("asc")
    .take(
      MAX_WIDGET_ORIGIN_OBSERVATIONS_PER_WORKSPACE +
        MAX_WIDGET_ORIGIN_OVERFLOW_ROWS_READ,
    );
  const retainedBeforeWrite =
    MAX_WIDGET_ORIGIN_OBSERVATIONS_PER_WORKSPACE - slotsNeeded;
  const overflow = Math.max(0, oldestWindow.length - retainedBeforeWrite);
  await Promise.all(
    oldestWindow
      .slice(0, overflow)
      .map((observation) =>
        ctx.db.delete("widgetOriginObservations", observation._id),
      ),
  );
}

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
    await repairWidgetOriginObservationOverflow(ctx, workspaceId, 0);
    return;
  }

  await repairWidgetOriginObservationOverflow(ctx, workspaceId, 1);

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
    .take(WIDGET_ORIGIN_CLEAR_BATCH_SIZE + 1);
  const batch = observations.slice(0, WIDGET_ORIGIN_CLEAR_BATCH_SIZE);
  await Promise.all(
    batch.map((observation) =>
      ctx.db.delete("widgetOriginObservations", observation._id),
    ),
  );
  return observations.length > WIDGET_ORIGIN_CLEAR_BATCH_SIZE;
}
