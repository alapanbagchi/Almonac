"use client";

import { Button } from "@/components/ui/button";

export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60svh] items-center justify-center">
      <div className="w-full max-w-[440px] text-center">
        <p className="text-[12px] font-medium tracking-[0.18em] text-moss-bright uppercase">
          Workspace unavailable
        </p>
        <h1 className="mt-3 font-display text-[2.05rem] leading-[1.15] font-medium text-parchment">
          Something went wrong
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-moss-bright" role="status">
          The page did not load. Try again in a moment.
        </p>
        <Button onClick={reset} className="mt-8">
          Try again
        </Button>
      </div>
    </div>
  );
}
