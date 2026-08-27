export const WIDGET_MESSAGE_MARKER = "marshaldesk-widget-v1";

export const WIDGET_WORKSPACE_SEARCH_PARAM = "workspaceId";
export const WIDGET_PARENT_ORIGIN_SEARCH_PARAM = "parentOrigin";
export const WIDGET_DEFAULT_OPEN_SEARCH_PARAM = "open";

export const WIDGET_BOOTSTRAP_MESSAGE_TYPE = "bootstrap";
export const WIDGET_CONTEXT_MESSAGE_TYPE = "context";
export const WIDGET_READY_MESSAGE_TYPE = "ready";
export const WIDGET_TOKEN_MESSAGE_TYPE = "token";
export const WIDGET_FRAME_MESSAGE_TYPE = "frame";

export const WIDGET_COOKIE_PREFIX = "marshaldesk_vid_";
export const WIDGET_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export const WIDGET_PANEL_WIDTH = 380;
export const WIDGET_PANEL_HEIGHT = 560;
export const WIDGET_FRAME_PADDING = 16;
export const WIDGET_LAUNCHER_SIZE = 56;
export const WIDGET_OPEN_GAP = 12;
export const WIDGET_CLOSED_FRAME_SIZE =
  WIDGET_LAUNCHER_SIZE + WIDGET_FRAME_PADDING * 2;
export const WIDGET_OPEN_FRAME_WIDTH =
  WIDGET_PANEL_WIDTH + WIDGET_FRAME_PADDING * 2;
export const WIDGET_OPEN_FRAME_HEIGHT =
  WIDGET_PANEL_HEIGHT +
  WIDGET_OPEN_GAP +
  WIDGET_LAUNCHER_SIZE +
  WIDGET_FRAME_PADDING * 2;

export type WidgetTheme = "blue" | "green" | "red" | "amber" | "zinc";
export type WidgetPosition = "bottomLeft" | "bottomRight";

export type WidgetPageContext = {
  pageUrl: string | null;
  pageTitle: string | null;
};

export type WidgetVisitorContext = WidgetPageContext & {
  city: string | null;
  country: string | null;
  timezone: string | null;
  locale: string | null;
  device: string | null;
};

export type WidgetBootstrapMessage = {
  marker: typeof WIDGET_MESSAGE_MARKER;
  type: typeof WIDGET_BOOTSTRAP_MESSAGE_TYPE;
  token: string | null;
  context: WidgetPageContext;
};

export type WidgetContextMessage = {
  marker: typeof WIDGET_MESSAGE_MARKER;
  type: typeof WIDGET_CONTEXT_MESSAGE_TYPE;
  context: WidgetPageContext;
};

export type WidgetReadyMessage = {
  marker: typeof WIDGET_MESSAGE_MARKER;
  type: typeof WIDGET_READY_MESSAGE_TYPE;
};

export type WidgetTokenMessage = {
  marker: typeof WIDGET_MESSAGE_MARKER;
  type: typeof WIDGET_TOKEN_MESSAGE_TYPE;
  token: string;
};

export type WidgetFrameMessage = {
  marker: typeof WIDGET_MESSAGE_MARKER;
  type: typeof WIDGET_FRAME_MESSAGE_TYPE;
  position: WidgetPosition;
  width: number;
  height: number;
};

export function validWidgetParentOrigin(value: string | undefined) {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      value !== url.origin
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}
