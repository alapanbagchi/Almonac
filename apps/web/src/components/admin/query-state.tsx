"use client";

import { AdminEmpty } from "./page-shell";

/** A quiet placeholder while a screen's first read is in flight. */
export function AdminLoading() {
  return (
    <div role="status" className="mt-8 space-y-4">
      <span className="sr-only">Loading</span>
      <div className="h-28 animate-pulse rounded-xl border border-border bg-card" />
      <div className="h-28 animate-pulse rounded-xl border border-border bg-card" />
      <div className="h-28 animate-pulse rounded-xl border border-border bg-card" />
    </div>
  );
}

export function AdminError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="mt-8">
      <AdminEmpty>
        <p role="alert">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
        >
          Try again
        </button>
      </AdminEmpty>
    </div>
  );
}
