import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={cn("size-7", className)}
    >
      <path
        d="M5 18V7l7 7.5L19 7v11"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.25 20.25h17.5"
        className="stroke-primary"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-1", className)}>
      <LogoMark />
      <span className="text-base font-medium tracking-tight">
        Marshal <span className="text-primary">Desk</span>
      </span>
    </span>
  );
}
