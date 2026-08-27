import type { ReactNode } from "react";
import {
  ClockIcon,
  FileTextIcon,
  MessageSquareIcon,
  ShieldCheckIcon,
  UserRoundIcon,
} from "lucide-react";
import { CobeGlobe } from "@/components/cobe-globe";
import { InboxStage } from "@/components/home/inbox-stage";
import { cn } from "@/lib/utils";

const features = [
  {
    id: "upload",
    className: "md:col-span-2",
    children: <UploadPolicy />,
  },
  {
    id: "grounded",
    className: "md:col-span-2",
    children: <GroundedReplies />,
  },
  {
    id: "handoff",
    className: "sm:col-span-2 md:col-span-2",
    children: <Handoff />,
  },
  {
    id: "inbox",
    className: "sm:col-span-2 md:col-span-3 p-0",
    children: <InboxFeature />,
  },
  {
    id: "install",
    className: "sm:col-span-2 md:col-span-3 p-0",
    children: <InstallFeature />,
  },
];

export function FeatureSection() {
  return (
    <section
      id="product"
      className="relative mx-auto w-full max-w-5xl scroll-mt-24 px-4 py-20 md:py-28"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-6">
        {features.map((feature) => (
          <FeatureCard key={feature.id} className={feature.className}>
            {feature.children}
          </FeatureCard>
        ))}
      </div>
    </section>
  );
}

function FeatureCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border bg-background px-8 pt-8 pb-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

function FeatureTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-lg font-medium text-foreground">{children}</h3>;
}

function FeatureDescription({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function CircleIcon({ children }: { children: ReactNode }) {
  return (
    <div className="relative mx-auto flex size-32 items-center justify-center rounded-full border bg-background shadow-xs outline outline-border outline-offset-4">
      <div className="absolute inset-0 scale-125 rounded-full bg-primary/10 blur-xl" />
      <span className="relative flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
        {children}
      </span>
    </div>
  );
}

function UploadPolicy() {
  return (
    <>
      <CircleIcon>
        <FileTextIcon className="size-8" />
      </CircleIcon>
      <div className="relative mt-8 flex flex-col gap-1.5 text-center">
        <FeatureTitle>Upload a policy or FAQ</FeatureTitle>
        <FeatureDescription>
          A PDF, Word doc, Markdown, or pasted text. The widget stays off until
          this is ready.
        </FeatureDescription>
      </div>
    </>
  );
}

function GroundedReplies() {
  return (
    <>
      <CircleIcon>
        <ShieldCheckIcon className="size-9" />
      </CircleIcon>
      <div className="relative mt-8 flex flex-col gap-1.5 text-center">
        <FeatureTitle>It stays inside what you uploaded</FeatureTitle>
        <FeatureDescription>
          Replies only use passages from the document you uploaded. Anything it
          does not cover gets an honest I don’t know.
        </FeatureDescription>
      </div>
    </>
  );
}

function Handoff() {
  return (
    <>
      <div className="relative min-h-32 overflow-hidden">
        <div className="absolute left-0 top-0 flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UserRoundIcon className="size-4" />
          </span>
          <span className="font-medium text-muted-foreground">Handoff</span>
        </div>
        <svg
          aria-hidden
          className="absolute -bottom-4 left-0 w-[130%] text-primary"
          fill="none"
          viewBox="0 0 320 120"
        >
          <path
            d="M0 106C38 88 47 72 82 76c35 4 45-32 73-23 28 9 42 25 70 10 28-15 30-64 50-44 20 20 29 16 45-4"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M0 106C38 88 47 72 82 76c35 4 45-32 73-23 28 9 42 25 70 10 28-15 30-64 50-44 20 20 29 16 45-4v105H0Z"
            fill="currentColor"
            opacity="0.12"
          />
        </svg>
      </div>
      <div className="relative z-10 mt-8 flex flex-col gap-1.5 text-center">
        <FeatureTitle>They can ask for you</FeatureTitle>
        <FeatureDescription>
          A control to reach you is always visible. After they tap it, the
          assistant leaves. The next line is yours.
        </FeatureDescription>
      </div>
    </>
  );
}

function InboxFeature() {
  return (
    <div className="grid h-full sm:grid-cols-2">
      <div className="relative z-10 flex flex-col gap-6 py-8 ps-8 pe-2">
        <span className="flex size-12 items-center justify-center rounded-full border bg-card shadow-xs outline outline-border/80 outline-offset-2 text-primary">
          <MessageSquareIcon className="size-5" />
        </span>
        <div className="flex flex-col gap-2">
          <FeatureTitle>You reply in the same conversation</FeatureTitle>
          <FeatureDescription>
            When someone asks for you, the thread lands in your inbox. You
            reply. They see it in the bubble they already have open.
          </FeatureDescription>
        </div>
      </div>
      <div className="relative aspect-video overflow-hidden sm:aspect-auto">
        <div className="absolute -bottom-1 -right-1 h-52 w-80 overflow-hidden rounded-tl-md border bg-card p-1">
          <div className="h-full overflow-hidden rounded-tl-sm border">
            <InboxStage className="w-[40rem] max-w-none -translate-x-[18rem] -translate-y-[22rem] rounded-none" />
          </div>
        </div>
      </div>
    </div>
  );
}

function InstallFeature() {
  return (
    <div className="relative min-h-72">
      <div className="relative z-10 flex max-w-xs flex-col gap-6 px-8 py-8">
        <span className="flex size-12 items-center justify-center rounded-full border bg-card shadow-xs outline outline-border/80 outline-offset-2 text-primary">
          <ClockIcon className="size-5" />
        </span>
        <div className="flex flex-col gap-2">
          <FeatureTitle>One snippet on your site</FeatureTitle>
          <FeatureDescription>
            A short script and your workspace id. A bubble appears. People stay
            on the page. Typing starts the conversation.
          </FeatureDescription>
        </div>
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 -right-12 size-64 sm:-bottom-24 sm:-right-16 sm:size-80 md:size-96"
      >
        <CobeGlobe className="size-full" />
      </div>
    </div>
  );
}
