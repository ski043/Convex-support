import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/50">
      <nav className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
        <Link href="/" className="rounded-md" aria-label="MarshalDesk home">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 md:flex">
            <Button
              size="sm"
              variant="ghost"
              nativeButton={false}
              render={<Link href="#product" />}
            >
              Product
            </Button>
            <Button
              size="sm"
              variant="ghost"
              nativeButton={false}
              render={<Link href="#faq" />}
            >
              FAQ
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            nativeButton={false}
            render={<Link href="/login" />}
          >
            Log in
          </Button>
          <Button
            size="sm"
            nativeButton={false}
            render={<Link href="/signup" />}
          >
            Get started
          </Button>
        </div>
      </nav>
    </header>
  );
}
