"use client";

import { usePreloadedAuthQuery } from "@convex-dev/better-auth/nextjs/client";
import type { Preloaded } from "convex/react";
import { LogOutIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import type { api } from "@/convex/_generated/api";
import { authClient } from "@/lib/auth-client";

export function DashboardClient({
  preloadedUser,
}: {
  preloadedUser: Preloaded<typeof api.auth.getCurrentUser>;
}) {
  const router = useRouter();
  const user = usePreloadedAuthQuery(preloadedUser);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);
    setError(null);

    try {
      const result = await authClient.signOut();

      if (result.error) {
        setError(result.error.message ?? "We could not sign you out.");
        return;
      }

      router.replace("/");
      router.refresh();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "We could not sign you out.",
      );
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <div className="dark relative flex min-h-dvh flex-1 flex-col bg-background">
      <div
        aria-hidden="true"
        className="bg-noise pointer-events-none absolute inset-0 opacity-[0.035]"
      />

      <header className="relative border-b border-border bg-background/80 backdrop-blur-sm">
        <nav className="mx-auto flex h-16 w-full max-w-4xl items-center justify-between px-4">
          <Link href="/" aria-label="MarshalDesk home" className="rounded-md">
            <Logo />
          </Link>
          <Button
            type="button"
            variant="outline"
            onClick={handleSignOut}
            disabled={isSigningOut}
          >
            {isSigningOut ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <LogOutIcon data-icon="inline-start" />
            )}
            {isSigningOut ? "Signing out…" : "Sign out"}
          </Button>
        </nav>
      </header>

      <main className="relative mx-auto flex w-full max-w-4xl flex-1 px-4 py-14 sm:py-20">
        <section className="flex w-full flex-col gap-8">
          <div className="flex max-w-2xl flex-col gap-2">
            <p className="text-sm text-muted-foreground">Dashboard</p>
            <h1 className="font-heading text-3xl font-medium tracking-tight sm:text-4xl">
              {user ? `Welcome back, ${user.name}` : "Loading your workspace…"}
            </h1>
            <p className="text-muted-foreground">
              Your MarshalDesk workspace is ready when you are.
            </p>
          </div>

          {error ? (
            <Alert variant="destructive" aria-live="polite">
              <AlertTitle>Couldn’t sign out</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Card className="w-full">
            <CardHeader>
              <CardTitle>Account details</CardTitle>
              <CardDescription>
                The identity connected to this workspace.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {user ? (
                <dl className="grid gap-6 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <dt className="text-sm text-muted-foreground">Full name</dt>
                    <dd className="font-medium">{user.name}</dd>
                  </div>
                  <div className="flex flex-col gap-1">
                    <dt className="text-sm text-muted-foreground">Email</dt>
                    <dd className="break-words font-medium">{user.email}</dd>
                  </div>
                </dl>
              ) : (
                <div
                  className="flex items-center gap-2 text-muted-foreground"
                  aria-live="polite"
                >
                  <Spinner />
                  <span>Confirming your session…</span>
                </div>
              )}
            </CardContent>
            <CardFooter>
              <p className="text-muted-foreground">
                Your session is protected by Better Auth and Convex.
              </p>
            </CardFooter>
          </Card>
        </section>
      </main>
    </div>
  );
}
