import type { Metadata } from "next";
import { WidgetSettings } from "@/components/dashboard/widget/widget-settings";
import { api } from "@/convex/_generated/api";
import { preloadAuthQuery } from "@/lib/auth-server";

export const metadata: Metadata = {
  title: "Widget — MarshalDesk",
  description: "Customize and install your MarshalDesk support widget.",
};

export default async function WidgetPage() {
  const [preloadedSettings, preloadedWorkspace] = await Promise.all([
    preloadAuthQuery(api.widgetSettings.get),
    preloadAuthQuery(api.workspaces.getCurrent),
  ]);

  return (
    <WidgetSettings
      preloadedSettings={preloadedSettings}
      preloadedWorkspace={preloadedWorkspace}
    />
  );
}
