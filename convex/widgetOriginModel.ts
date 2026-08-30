import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const MAX_WIDGET_ORIGIN_OBSERVATIONS_PER_WORKSPACE = 100;
const MAX_WIDGET_ORIGIN_OVERFLOW_REPAIRS_PER_WRITE = 100;
const MAX_WIDGET_ORIGIN_CLEAR_ROWS_PER_MUTATION = 1_000;

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
        MAX_WIDGET_ORIGIN_OVERFLOW_REPAIRS_PER_WRITE,
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
    .take(MAX_WIDGET_ORIGIN_CLEAR_ROWS_PER_MUTATION + 1);
  if (observations.length > MAX_WIDGET_ORIGIN_CLEAR_ROWS_PER_MUTATION) {
    throw new ConvexError(
      "Origin discovery history is too large to clear safely in one request. Run the widget normally to repair the history, then try again.",
    );
  }
  await Promise.all(
    observations.map((observation) =>
      ctx.db.delete("widgetOriginObservations", observation._id),
    ),
  );
}
