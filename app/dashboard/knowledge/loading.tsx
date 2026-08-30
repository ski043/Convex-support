import { Skeleton } from "@/components/ui/skeleton";

export default function KnowledgeLoading() {
  return (
    <div
      className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-8 pb-10"
      aria-label="Loading knowledge base"
      aria-busy="true"
    >
      <div className="flex max-w-2xl flex-col gap-3">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-5 w-full max-w-xl" />
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    </div>
  );
}
