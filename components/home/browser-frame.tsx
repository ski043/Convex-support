import type { ReactNode } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  LockIcon,
  PlusIcon,
  ShareIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function BrowserFrame({
  url,
  children,
  className,
}: {
  url: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border bg-muted shadow-2xl ring-1 ring-foreground/5",
        className,
      )}
    >
      <div aria-hidden className="flex h-11 items-center gap-3 px-4">
        <div className="flex flex-1 items-center gap-3">
          <div className="flex shrink-0 items-center gap-2">
            <span className="size-3 rounded-full bg-destructive" />
            <span className="size-3 rounded-full bg-primary/70" />
            <span className="size-3 rounded-full bg-primary" />
          </div>
          <div className="hidden shrink-0 items-center gap-1 text-muted-foreground/70 sm:flex">
            <ChevronLeftIcon className="size-4" />
            <ChevronRightIcon className="size-4" />
          </div>
        </div>
        <div className="flex h-7 min-w-0 max-w-full items-center justify-center gap-1.5 rounded-md bg-background px-3 text-xs text-muted-foreground shadow-xs ring-1 ring-border/70 sm:w-80">
          <LockIcon className="size-3 shrink-0" />
          <span className="truncate">{url}</span>
        </div>
        <div className="hidden flex-1 items-center justify-end gap-3 text-muted-foreground/70 sm:flex">
          <ShareIcon className="size-4" />
          <PlusIcon className="size-4" />
        </div>
      </div>
      <div className="border-t">{children}</div>
    </div>
  );
}
