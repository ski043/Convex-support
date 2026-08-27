import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { api } from "@/convex/_generated/api";
import { isAuthenticated, preloadAuthQuery } from "@/lib/auth-server";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  if (!(await isAuthenticated())) {
    redirect("/login");
  }

  const preloadedUser = await preloadAuthQuery(api.auth.getCurrentUser);

  return <DashboardClient preloadedUser={preloadedUser}>{children}</DashboardClient>;
}
