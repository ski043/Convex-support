import type { Metadata } from "next";
import { KnowledgeBase } from "@/components/dashboard/knowledge/knowledge-base";
import { api } from "@/convex/_generated/api";
import { preloadAuthQuery } from "@/lib/auth-server";

export const metadata: Metadata = {
  title: "Knowledge — MarshalDesk",
  description: "Manage the sources MarshalDesk uses to answer support questions.",
};

export default async function KnowledgePage() {
  const preloadedDocuments = await preloadAuthQuery(api.knowledge.list);

  return <KnowledgeBase preloadedDocuments={preloadedDocuments} />;
}
