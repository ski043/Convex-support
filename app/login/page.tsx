import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { LoginForm } from "@/components/auth/login-form";
import { isAuthenticated } from "@/lib/auth-server";

export const metadata: Metadata = {
  title: "Log in — MarshalDesk",
  description: "Sign in to your MarshalDesk account.",
};

export default async function LoginPage() {
  if (await isAuthenticated()) {
    redirect("/dashboard");
  }

  return (
    <AuthPageShell>
      <LoginForm />
    </AuthPageShell>
  );
}
