import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";

export function AuthPageShell({ children }: { children: ReactNode }) {
  return (
    <main className="dark relative flex min-h-dvh flex-1 items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div
        aria-hidden="true"
        className="bg-noise pointer-events-none absolute inset-0 opacity-[0.035]"
      />
      <div className="relative flex w-full max-w-sm flex-col gap-8">
        <Link
          href="/"
          aria-label="MarshalDesk home"
          className="mx-auto rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Logo />
        </Link>
        {children}
      </div>
    </main>
  );
}
