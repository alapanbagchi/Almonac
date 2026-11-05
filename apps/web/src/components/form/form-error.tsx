"use client";

import { AlertCircle } from "lucide-react";

/**
 * Announces a failed submission above the fields. Field-level validation
 * stays next to its input; this banner is only for the request as a whole.
 */
export function FormError({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <div
      role="alert"
      className="col-span-full flex w-full items-start gap-2.5 rounded-lg bg-destructive px-3.5 py-3 text-sm leading-snug text-destructive-foreground"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
