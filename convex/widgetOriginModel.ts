import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const MAX_WIDGET_ORIGIN_OBSERVATIONS_PER_WORKSPACE = 100;
const MAX_WIDGET_ORIGIN_OVERFLOW_ROWS_READ = 100;
const WIDGET_ORIGIN_CLEAR_BATCH_SIZE = 100;

export type WidgetOriginClearBoundary = {
  lastSeenAt: number;
  creationTime: number;
};

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
  clearThrough?: WidgetOriginClearBoundary,
): Promise<{
  hasMore: boolean;
  clearThrough: WidgetOriginClearBoundary | null;
}> {
  const newest = clearThrough
    ? null
    : await ctx.db
        .query("widgetOriginObservations")
        .withIndex("by_workspaceId_and_lastSeenAt", (q) =>
          q.eq("workspaceId", workspaceId),
        )
        .order("desc")
        .first();
  const boundary =
    clearThrough ??
    (newest
      ? {
          lastSeenAt: newest.lastSeenAt,
          creationTime: newest._creationTime,
        }
      : null);
  if (!boundary) return { hasMore: false, clearThrough: null };

  const observations = await ctx.db
    .query("widgetOriginObservations")
    .withIndex("by_workspaceId_and_lastSeenAt", (q) =>
      q
        .eq("workspaceId", workspaceId)
        .lte("lastSeenAt", boundary.lastSeenAt),
    )
    .order("asc")
    .take(WIDGET_ORIGIN_CLEAR_BATCH_SIZE + 1);
  const eligible = observations.filter(
    (observation) =>
      observation.lastSeenAt < boundary.lastSeenAt ||
      observation._creationTime <= boundary.creationTime,
  );
  const batch = eligible.slice(0, WIDGET_ORIGIN_CLEAR_BATCH_SIZE);
  await Promise.all(
    batch.map((observation) =>
      ctx.db.delete("widgetOriginObservations", observation._id),
    ),
  );
  return {
    hasMore: eligible.length > WIDGET_ORIGIN_CLEAR_BATCH_SIZE,
    clearThrough: boundary,
  };
}
