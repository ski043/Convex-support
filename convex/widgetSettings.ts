import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { authComponent } from "./auth";
import { widgetSettingsValidator } from "./schema";
import {
  ensureWorkspaceForAuthUser,
  findWorkspaceByAuthUserId,
} from "./workspaceModel";

const MAX_DISPLAY_NAME_LENGTH = 40;
const MAX_GREETING_LENGTH = 120;

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
        updatedAt,
      });
    } else {
      await ctx.db.insert("widgetSettings", {
        ownerTokenIdentifier,
        workspaceId,
        ...args,
        updatedAt,
      });
    }

    return null;
  },
});
