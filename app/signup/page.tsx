import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { SignupForm } from "@/components/auth/signup-form";
import { isAuthenticated } from "@/lib/auth-server";

export const metadata: Metadata = {
  title: "Sign up — MarshalDesk",
  description: "Create your MarshalDesk account.",
};

export default async function SignupPage() {
  if (await isAuthenticated()) {
    redirect("/dashboard");
  }

  return (
    <AuthPageShell>
      <SignupForm />
    </AuthPageShell>
  );
}
