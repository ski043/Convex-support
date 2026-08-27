"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const secondaryActionClassName = cn(
  buttonVariants({ variant: "ghost", size: "sm" }),
  "rounded-full text-xs text-[#e1e0cc] hover:bg-white/10 hover:text-[#e1e0cc] dark:hover:bg-white/10 sm:text-sm",
);

const primaryActionClassName = cn(
  buttonVariants({ size: "sm" }),
  "rounded-full bg-primary text-xs text-black hover:scale-[1.03] hover:bg-primary sm:text-sm",
);

export function NavbarAuthActions() {
  const { data: session, isPending } = authClient.useSession();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function handleSignOut() {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);
    setSignOutError(null);

    try {
      const result = await authClient.signOut();

      if (result.error) {
        setSignOutError(result.error.message ?? "We could not sign you out.");
      }
    } catch (caughtError) {
      setSignOutError(
        caughtError instanceof Error
          ? caughtError.message
          : "We could not sign you out.",
      );
    } finally {
      setIsSigningOut(false);
    }
  }

  if (isPending) {
    return (
      <div
        aria-busy="true"
        aria-label="Checking your session"
        className="flex shrink-0 items-center gap-1.5 sm:gap-2"
      >
        <span aria-hidden="true" className={cn(secondaryActionClassName, "invisible")}>
          Log in
        </span>
        <span aria-hidden="true" className={cn(primaryActionClassName, "invisible")}>
          Get started
        </span>
      </div>
    );
  }

  if (session?.session) {
    return (
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={secondaryActionClassName}
          onClick={handleSignOut}
          disabled={isSigningOut}
        >
          {isSigningOut ? <Spinner data-icon="inline-start" /> : null}
          {isSigningOut ? "Signing out…" : "Sign out"}
        </Button>
        <Link href="/dashboard" className={primaryActionClassName}>
          Dashboard
        </Link>
        {signOutError ? (
          <span className="sr-only" role="alert">
            {signOutError}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
      <Link href="/login" className={secondaryActionClassName}>
        Log in
      </Link>
      <Link href="/signup" className={primaryActionClassName}>
        Get started
      </Link>
    </div>
  );
}
