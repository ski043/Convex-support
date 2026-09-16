import { normalizeWidgetOrigin } from "./widget-bootstrap-token";

const workspacePattern = /^[A-Za-z0-9_-]{1,128}$/u;
const capabilityPattern = /^[0-9a-f]{64}$/u;

export type ParsedWidgetBootstrapRequest = {
  workspaceId: string;
  renewal: { capabilityToken: string; origin: string } | null;
};

export function parseWidgetBootstrapRequest(
  value: unknown,
): ParsedWidgetBootstrapRequest | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.workspaceId !== "string" ||
    !workspacePattern.test(record.workspaceId)
  ) {
    return null;
  }

  const hasParentOrigin = Object.hasOwn(record, "parentOrigin");
  const hasCapabilityToken = Object.hasOwn(record, "capabilityToken");
  if (!hasParentOrigin && !hasCapabilityToken) {
    return { workspaceId: record.workspaceId, renewal: null };
  }
  if (!hasParentOrigin || !hasCapabilityToken) return null;

  const origin = normalizeWidgetOrigin(
    typeof record.parentOrigin === "string" ? record.parentOrigin : null,
  );
  const capabilityToken =
    typeof record.capabilityToken === "string" &&
    capabilityPattern.test(record.capabilityToken)
      ? record.capabilityToken
      : null;
  if (!origin || !capabilityToken) return null;

  return {
    workspaceId: record.workspaceId,
    renewal: { capabilityToken, origin },
  };
}
