"use client";

import { useEffect } from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AlertTriangleIcon } from "@/components/ui/icons";

export default function Error({
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
    <div className="min-h-screen flex items-center justify-center bg-bg-deep px-4">
      <Card className="max-w-sm w-full">
        <CardBody className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-danger-light text-danger">
            <AlertTriangleIcon className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-semibold text-white mb-1">Something went wrong</h1>
          <p className="text-sm text-slate-400 mb-6">
            An unexpected error occurred. Please try again.
          </p>
          <Button tone="neutral" onClick={reset} fullWidth>
            Try again
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
