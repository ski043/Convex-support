import {
  createClient,
  type AuthFunctions,
  type GenericCtx,
} from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { env, query } from "./_generated/server";
import authConfig from "./auth.config";
import { ensureWorkspaceForAuthUser } from "./workspaceModel";

const authFunctions: AuthFunctions = internal.auth;

export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      onCreate: async (ctx, authUser) => {
        await ensureWorkspaceForAuthUser(ctx, authUser);
      },
    },
  },
});

export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

export function createAuth(ctx: GenericCtx<DataModel>) {
  return betterAuth({
    appName: "MarshalDesk",
    baseURL: env.SITE_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [convex({ authConfig })],
  });
}

export const getCurrentUser = query({
  args: {},
  returns: v.object({
    name: v.string(),
    email: v.string(),
  }),
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);

    return {
      name: user.name,
      email: user.email,
    };
  },
});
