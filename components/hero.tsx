import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrowserFrame } from "@/components/home/browser-frame";
import { InboxStage } from "@/components/home/inbox-stage";

export function HeroSection() {
  return (
    <section className="relative mx-auto w-full max-w-5xl overflow-hidden px-4 pt-16">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(30%_55%_at_15%_0%,var(--color-primary),transparent)] opacity-10"
      />
      <div className="relative flex max-w-2xl flex-col gap-5">
        <Link
          className="group flex w-fit items-center gap-3 rounded-sm border bg-card p-1 shadow-xs transition-transform duration-300 hover:-translate-y-0.5"
          href="#product"
        >
          <span className="rounded-xs border bg-card px-1.5 py-0.5 text-xs shadow-sm">
            Grounded
          </span>
          <span className="text-xs">Answers only from your document</span>
          <span className="block h-5 border-l" />
          <ArrowRightIcon className="mr-1 size-3 transition-transform duration-150 group-hover:translate-x-1" />
        </Link>

        <h1 className="text-balance text-4xl font-medium leading-tight text-foreground md:text-5xl">
          The only help desk designed for the AI agent era.
        </h1>

        <p className="text-sm text-muted-foreground sm:text-lg md:text-xl">
          Upload your refund policy, paste one snippet on your site, and people
          get answers from that document. When it does not cover them, you take
          over in the same thread.
        </p>

        <div className="flex w-fit items-center gap-3 pt-2">
          <Button nativeButton={false} render={<Link href="/signup" />}>
            Get started
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/login" />}
          >
            Log in
          </Button>
        </div>
      </div>
      <div className="relative mt-8 sm:mt-12 md:mt-20">
        <div
          aria-hidden
          className="absolute -inset-x-20 inset-y-0 -translate-y-1/3 rounded-full bg-primary/10 blur-[50px]"
        />
        <div className="relative -mr-56 overflow-hidden sm:mr-0">
          <BrowserFrame url="marshaldesk.com/inbox">
            <InboxStage className="rounded-none" />
          </BrowserFrame>
        </div>
      </div>
    </section>
  );
}
