/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as chatModel from "../chatModel.js";
import type * as chatOwner from "../chatOwner.js";
import type * as chatValidators from "../chatValidators.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as inbox from "../inbox.js";
import type * as typingPresence from "../typingPresence.js";
import type * as widgetChat from "../widgetChat.js";
import type * as widgetChatInternal from "../widgetChatInternal.js";
import type * as widgetSettings from "../widgetSettings.js";
import type * as workspaceModel from "../workspaceModel.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  chatModel: typeof chatModel;
  chatOwner: typeof chatOwner;
  chatValidators: typeof chatValidators;
  health: typeof health;
  http: typeof http;
  inbox: typeof inbox;
  typingPresence: typeof typingPresence;
  widgetChat: typeof widgetChat;
  widgetChatInternal: typeof widgetChatInternal;
  widgetSettings: typeof widgetSettings;
  workspaceModel: typeof workspaceModel;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  presence: import("@convex-dev/presence/_generated/component.js").ComponentApi<"presence">;
  rag: import("@convex-dev/rag/_generated/component.js").ComponentApi<"rag">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
