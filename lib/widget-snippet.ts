const workspacePlaceholder = "YOUR_WORKSPACE_ID";
const originPlaceholder = "https://YOUR_MARSHALDESK_ORIGIN";

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function normalizedOrigin(origin: string | null | undefined) {
  if (!origin) return originPlaceholder;

  try {
    const url = new URL(origin);
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin === origin
    ) {
      return url.origin;
    }
  } catch {
    // The explicit placeholder below is safer than emitting a malformed URL.
  }

  return originPlaceholder;
}

export function widgetInstallSnippet(
  workspaceId: string | null | undefined,
  origin: string | null | undefined,
) {
  return widgetInstallSnippetParts(workspaceId, origin)
    .map((parts) => parts.join(""))
    .join("\n");
}

export function widgetInstallSnippetParts(
  workspaceId: string | null | undefined,
  origin: string | null | undefined,
) {
  const src = `${normalizedOrigin(origin)}/widget.js`;
  const workspace = workspaceId?.trim() || workspacePlaceholder;

  return [
    ["<", "script"],
    ["  src=", `"${escapeHtmlAttribute(src)}"`],
    ["  data-workspace=", `"${escapeHtmlAttribute(workspace)}"`],
    ["  async"],
    [">", "</", "script", ">"],
  ];
}
