import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Dashboard — MarshalDesk",
  description: "Manage your MarshalDesk support workspace.",
};

export default function DashboardPage() {
  redirect("/dashboard/widget");
}
