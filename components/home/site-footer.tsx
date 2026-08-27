import Link from "next/link";
import { Logo } from "@/components/logo";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-12">
        <div className="flex flex-col justify-between gap-10 sm:flex-row sm:items-end">
          <div className="flex max-w-sm flex-col gap-4">
            <Link href="/" className="w-fit">
              <Logo />
            </Link>
            <p className="text-[13px] leading-relaxed text-muted-foreground text-pretty">
              A help desk that answers from your document, and hands you the
              thread when it can’t.
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
            <Link className="text-muted-foreground hover:text-foreground" href="#product">
              Product
            </Link>
            <Link className="text-muted-foreground hover:text-foreground" href="#faq">
              FAQ
            </Link>
            <Link className="text-muted-foreground hover:text-foreground" href="/login">
              Log in
            </Link>
            <Link className="text-muted-foreground hover:text-foreground" href="/signup">
              Get started
            </Link>
          </nav>
        </div>
        <p className="text-[12px] text-muted-foreground">
          One owner. One workspace. One widget.
        </p>
      </div>
    </footer>
  );
}
