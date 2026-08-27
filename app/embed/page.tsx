import { WidgetEmbed } from "@/components/widget/widget-embed";
import type { Id } from "@/convex/_generated/dataModel";
import {
  WIDGET_DEFAULT_OPEN_SEARCH_PARAM,
  WIDGET_PARENT_ORIGIN_SEARCH_PARAM,
  WIDGET_WORKSPACE_SEARCH_PARAM,
  validWidgetParentOrigin,
} from "@/lib/widget-embed-contract";

const workspacePattern = /^[A-Za-z0-9_-]{1,128}$/;

function firstSearchParam(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}

export default async function EmbedPage({ searchParams }: PageProps<"/embed">) {
  const params = await searchParams;
  const workspaceId = firstSearchParam(params[WIDGET_WORKSPACE_SEARCH_PARAM]);
  const parentOrigin = validWidgetParentOrigin(
    firstSearchParam(params[WIDGET_PARENT_ORIGIN_SEARCH_PARAM]),
  );
  const defaultOpen =
    firstSearchParam(params[WIDGET_DEFAULT_OPEN_SEARCH_PARAM]) === "1";

  if (!workspaceId || !workspacePattern.test(workspaceId) || !parentOrigin) {
    return null;
  }

  return (
    <WidgetEmbed
      workspaceId={workspaceId as Id<"workspaces">}
      parentOrigin={parentOrigin}
      defaultOpen={defaultOpen}
    />
  );
}
