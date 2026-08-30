export const MAX_AUTOMATIC_CLEANUP_ATTEMPTS = 5;

export function cleanupRetryDelayMs(nextAttempt: number) {
  return Math.min(30_000, 1_000 * 2 ** Math.max(0, nextAttempt - 1));
}

export type CleanupAttemptResult = "deleted" | "retry_scheduled" | "exhausted";

export type CleanupAttemptDependencies = {
  deleteStorage: () => Promise<void>;
  deleteDocument: () => Promise<void>;
  recordFailure: (args: {
    nextAttempt: number;
    exhausted: boolean;
  }) => Promise<void>;
  scheduleRetry: (args: {
    nextAttempt: number;
    delayMs: number;
  }) => Promise<void>;
};

/** Keeps the storage syscall mockable while all production effects remain in
 * one scheduled mutation transaction. */
export async function runCleanupAttempt(
  attempt: number,
  dependencies: CleanupAttemptDependencies,
): Promise<CleanupAttemptResult> {
  try {
    await dependencies.deleteStorage();
    await dependencies.deleteDocument();
    return "deleted";
  } catch {
    const nextAttempt = attempt + 1;
    const exhausted = nextAttempt >= MAX_AUTOMATIC_CLEANUP_ATTEMPTS;
    await dependencies.recordFailure({ nextAttempt, exhausted });
    if (exhausted) return "exhausted";
    await dependencies.scheduleRetry({
      nextAttempt,
      delayMs: cleanupRetryDelayMs(nextAttempt),
    });
    return "retry_scheduled";
  }
}
