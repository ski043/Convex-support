import { ConvexStatus } from "./convex-status";

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center bg-[radial-gradient(circle_at_top,_#ffffff,_#f4f4f5_55%,_#e4e4e7)] px-5 py-16 font-sans dark:bg-[radial-gradient(circle_at_top,_#27272a,_#09090b_60%)]">
      <div className="flex w-full max-w-2xl flex-col items-center gap-10">
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-amber-700 dark:text-amber-400">
            Next.js + Convex
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-zinc-950 dark:text-white sm:text-5xl">
            The backend is wired in.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-zinc-600 dark:text-zinc-300">
            This page calls a Convex query in real time. Use the database check
            below to verify the complete read-and-write path.
          </p>
        </div>

        <ConvexStatus />
      </div>
    </main>
  );
}
