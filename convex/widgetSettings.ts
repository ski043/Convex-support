import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { authComponent } from "./auth";
import { widgetSettingsValidator } from "./schema";
import {
  ensureWorkspaceForAuthUser,
  findWorkspaceByAuthUserId,
} from "./workspaceModel";
import { normalizeWidgetOrigin } from "../lib/widget-bootstrap-token";

const MAX_DISPLAY_NAME_LENGTH = 40;
const MAX_GREETING_LENGTH = 120;
const MAX_ALLOWED_ORIGINS = 20;

const defaultWidgetSettings = {
  displayName: "MarshalDesk support",
  greeting: "Hi there! How can we help today?",
  theme: "blue",
  position: "bottomRight",
} as const;

async function requireOwner(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) {
    throw new ConvexError("Unauthenticated");
  }

  const authUser = await authComponent.getAuthUser(ctx);

  return {
    authUser,
    ownerTokenIdentifier: identity.tokenIdentifier,
  };
}

export async function getRecentWidgetOriginObservations(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
) {
  const observations = await ctx.db
    .query("widgetOriginObservations")
    .withIndex("by_workspaceId_and_lastSeenAt", (q) =>
      q.eq("workspaceId", workspaceId),
    )
    .order("desc")
    .take(MAX_ALLOWED_ORIGINS + 1);
  return {
    origins: observations.slice(0, MAX_ALLOWED_ORIGINS).map((observation) => ({
      origin: observation.origin,
      sessionCount: observation.sessionCount,
      firstSeenAt: observation.firstSeenAt,
      lastSeenAt: observation.lastSeenAt,
    })),
    isTruncated: observations.length > MAX_ALLOWED_ORIGINS,
  };
}

export const get = query({
  args: {},
  returns: widgetSettingsValidator,
  handler: async (ctx) => {
    const { authUser, ownerTokenIdentifier } = await requireOwner(ctx);
    const workspace = await findWorkspaceByAuthUserId(ctx, authUser._id);
    const workspaceSettings = workspace
      ? await ctx.db
          .query("widgetSettings")
          .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspace._id))
          .unique()
      : null;
    const settings =
      workspaceSettings ??
      (await ctx.db
        .query("widgetSettings")
        .withIndex("by_ownerTokenIdentifier", (q) =>
          q.eq("ownerTokenIdentifier", ownerTokenIdentifier),
        )
        .unique());

    if (!settings) {
      return defaultWidgetSettings;
    }

    return {
      displayName: settings.displayName,
      greeting: settings.greeting,
      theme: settings.theme,
      position: settings.position,
    };
  },
});

export const save = mutation({
  args: widgetSettingsValidator.fields,
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.displayName.length > MAX_DISPLAY_NAME_LENGTH) {
      throw new ConvexError(
        `Display name cannot exceed ${MAX_DISPLAY_NAME_LENGTH} characters.`,
      );
    }

    if (args.greeting.length > MAX_GREETING_LENGTH) {
      throw new ConvexError(`Greeting cannot exceed ${MAX_GREETING_LENGTH} characters.`);
    }

    const { authUser, ownerTokenIdentifier } = await requireOwner(ctx);
    const workspaceId = await ensureWorkspaceForAuthUser(ctx, authUser);
    const workspaceSettings = await ctx.db
      .query("widgetSettings")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
      .unique();
    const existing =
      workspaceSettings ??
      (await ctx.db
        .query("widgetSettings")
        .withIndex("by_ownerTokenIdentifier", (q) =>
          q.eq("ownerTokenIdentifier", ownerTokenIdentifier),
        )
        .unique());
    const updatedAt = Date.now();

    if (existing) {
      await ctx.db.patch("widgetSettings", existing._id, {
        ...args,
        workspaceId,
        securityUpdatedAt:
          existing.securityUpdatedAt ?? existing.updatedAt,
        updatedAt,
      });
    } else {
      await ctx.db.insert("widgetSettings", {
        ownerTokenIdentifier,
        workspaceId,
        ...args,
        securityUpdatedAt: 0,
        updatedAt,
      });
    }

    return null;
  },
});

export const getSecurity = query({
  args: {},
  returns: v.object({
    allowedOrigins: v.array(v.string()),
    originPolicy: v.union(v.literal("legacy_limited"), v.literal("enforced")),
  }),
  handler: async (ctx) => {
    const { authUser, ownerTokenIdentifier } = await requireOwner(ctx);
    const workspace = await findWorkspaceByAuthUserId(ctx, authUser._id);
    const settings = workspace
      ? await ctx.db
          .query("widgetSettings")
          .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspace._id))
          .unique()
      : await ctx.db
          .query("widgetSettings")
          .withIndex("by_ownerTokenIdentifier", (q) =>
            q.eq("ownerTokenIdentifier", ownerTokenIdentifier),
          )
          .unique();
    return {
      allowedOrigins: settings?.allowedOrigins ?? [],
      originPolicy: settings?.originPolicy ?? "legacy_limited",
    };
  },
});

export const getRecentOrigins = query({
  args: {},
  returns: v.object({
    origins: v.array(
      v.object({
        origin: v.string(),
        sessionCount: v.number(),
        firstSeenAt: v.number(),
        lastSeenAt: v.number(),
      }),
    ),
    isTruncated: v.boolean(),
  }),
  handler: async (ctx) => {
    const { authUser } = await requireOwner(ctx);
    const workspace = await findWorkspaceByAuthUserId(ctx, authUser._id);
    if (!workspace) return { origins: [], isTruncated: false };
    return await getRecentWidgetOriginObservations(ctx, workspace._id);
  },
});

export const saveSecurity = mutation({
  args: { allowedOrigins: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.allowedOrigins.length < 1 || args.allowedOrigins.length > MAX_ALLOWED_ORIGINS) {
      throw new ConvexError(
        `Configure between 1 and ${MAX_ALLOWED_ORIGINS} allowed origins.`,
      );
    }
    const normalized = args.allowedOrigins.map((origin) => {
      const value = normalizeWidgetOrigin(origin.trim());
      if (!value) {
        throw new ConvexError(
          "Allowed origins must be exact HTTP(S) origins without a path.",
        );
      }
      return value;
    });
    const allowedOrigins = [...new Set(normalized)].sort();
    const { authUser, ownerTokenIdentifier } = await requireOwner(ctx);
    const workspaceId = await ensureWorkspaceForAuthUser(ctx, authUser);
    const settings = await ctx.db
      .query("widgetSettings")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
      .unique();
    const updatedAt = Date.now();
    if (settings) {
      await ctx.db.patch("widgetSettings", settings._id, {
        allowedOrigins,
        originPolicy: "enforced",
        securityUpdatedAt: updatedAt,
        updatedAt,
      });
    } else {
      await ctx.db.insert("widgetSettings", {
        ownerTokenIdentifier,
        workspaceId,
        ...defaultWidgetSettings,
        allowedOrigins,
        originPolicy: "enforced",
        securityUpdatedAt: updatedAt,
        updatedAt,
      });
    }
    return null;
  },
});
