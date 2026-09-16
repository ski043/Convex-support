import type { Metadata } from "next";
import { AiSettingsCard } from "@/components/dashboard/knowledge/ai-settings-card";
import { KnowledgeBase } from "@/components/dashboard/knowledge/knowledge-base";
import { api } from "@/convex/_generated/api";
import { preloadAuthQuery } from "@/lib/auth-server";

export const metadata: Metadata = {
  title: "Knowledge — MarshalDesk",
  description: "Manage the sources MarshalDesk uses to answer support questions.",
};

export default async function KnowledgePage() {
  const [preloadedDocuments, preloadedAiSettings] = await Promise.all([
    preloadAuthQuery(api.knowledge.list),
    preloadAuthQuery(api.aiAutomation.getAiSettings),
  ]);

  return (
    <KnowledgeBase preloadedDocuments={preloadedDocuments}>
      <AiSettingsCard preloadedSettings={preloadedAiSettings} />
    </KnowledgeBase>
  );
}
