"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";

export function ConvexStatus() {
  const health = useQuery(api.health.check);
  const databaseCheck = useQuery(api.health.getDatabaseCheck);
  const runDatabaseCheck = useMutation(api.health.runDatabaseCheck);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isConnected = health?.status === "ok";

  async function handleDatabaseCheck() {
    setIsRunning(true);
    setError(null);

    try {
      await runDatabaseCheck({});
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The database check failed.",
      );
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <section className="w-full max-w-2xl overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-[0_24px_80px_-36px_rgba(24,24,27,0.35)] dark:border-zinc-700 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 px-6 py-5 dark:border-zinc-700 sm:px-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Integration status
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-950 dark:text-white">
              Convex smoke test
            </h2>
          </div>
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${
              isConnected
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300"
                : "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300"
            }`}
          >
            <span
              className={`size-2 rounded-full ${
                isConnected ? "bg-emerald-500" : "animate-pulse bg-amber-500"
              }`}
            />
            {isConnected ? "Connected" : "Connecting"}
          </span>
        </div>
      </div>

      <div className="grid gap-6 px-6 py-6 sm:grid-cols-[1fr_auto] sm:items-end sm:px-8 sm:py-8">
        <div>
          <p className="text-sm font-semibold text-zinc-950 dark:text-white">
            Database write
          </p>
          <p className="mt-2 max-w-md text-sm leading-6 text-zinc-600 dark:text-zinc-300">
            {databaseCheck
              ? `Last successful write: ${new Date(
                  databaseCheck.completedAt,
                ).toLocaleString()}`
              : "Run a real mutation to confirm that reads, writes, and live updates all work."}
          </p>
          {error ? (
            <p className="mt-3 text-sm font-medium text-red-700 dark:text-red-300">
              {error}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={handleDatabaseCheck}
          disabled={!isConnected || isRunning}
          className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400"
        >
          {isRunning ? "Checking…" : "Test database"}
        </button>
      </div>
    </section>
  );
}
