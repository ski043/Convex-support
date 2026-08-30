"use client";

import { AlertCircleIcon, RefreshCwIcon } from "lucide-react";
import { useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function KnowledgeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-1 items-start pt-10">
      <Alert variant="destructive" className="py-4">
        <AlertCircleIcon aria-hidden />
        <AlertTitle>Knowledge couldn’t be loaded</AlertTitle>
        <AlertDescription>
          Your sources were not changed. Try loading this area again.
        </AlertDescription>
        <div className="col-start-2 mt-3">
          <Button type="button" variant="outline" onClick={reset}>
            <RefreshCwIcon data-icon="inline-start" />
            Try again
          </Button>
        </div>
      </Alert>
    </div>
  );
}
