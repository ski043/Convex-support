import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { api } from "@/convex/_generated/api";
import { isAuthenticated, preloadAuthQuery } from "@/lib/auth-server";

export const metadata: Metadata = {
  title: "Dashboard — MarshalDesk",
  description: "Your authenticated MarshalDesk workspace.",
};

export default async function DashboardPage() {
  if (!(await isAuthenticated())) {
    redirect("/login");
  }

  const preloadedUser = await preloadAuthQuery(api.auth.getCurrentUser);

  return <DashboardClient preloadedUser={preloadedUser} />;
}
