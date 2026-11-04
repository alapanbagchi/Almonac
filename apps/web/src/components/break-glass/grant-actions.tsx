"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { SubmitButton } from "@/components/form/submit-button";
import { breakGlassRequest, BreakGlassRequestError } from "@/lib/break-glass/client";

// The API answers with the codes documented in apps/api/AGENTS.md; the
// specific reason travels in the message and is not shown to the browser.
function failureMessage(error: unknown): string {
  if (error instanceof BreakGlassRequestError) {
    if (error.code === "CONFLICT") return "This grant already changed. Reload the page.";
    if (error.code === "RULE_VIOLATION") return "The grant does not allow that action now.";
    if (error.code === "FORBIDDEN") return "Your account cannot change this grant.";
  }
  return "The action could not be completed.";
}

export function RevokeGrant({ grantId }: { grantId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setError(null);
    try {
      await breakGlassRequest(`grants/${grantId}/revoke`, "POST", {
        reason: String(form.get("reason") ?? "").trim(),
      });
      formElement.reset();
      router.refresh();
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <label htmlFor={`revoke-${grantId}`} className="sr-only">
        Revocation reason
      </label>
      <input
        id={`revoke-${grantId}`}
        name="reason"
        required
        minLength={1}
        maxLength={500}
        placeholder="Reason for ending access"
        className="h-9 rounded-lg border border-input bg-card px-3 text-sm"
      />
      <SubmitButton variant="outline" size="sm" disabled={pending}>
        {pending ? "Ending..." : "End access"}
      </SubmitButton>
      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

export function ReviewGrant({ grantId }: { grantId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setError(null);
    try {
      await breakGlassRequest(`grants/${grantId}/review`, "POST", {
        decision: String(form.get("decision") ?? "upheld"),
        notes: String(form.get("notes") ?? "").trim() || null,
      });
      formElement.reset();
      router.refresh();
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <label htmlFor={`decision-${grantId}`} className="sr-only">
        Review decision
      </label>
      <select
        id={`decision-${grantId}`}
        name="decision"
        className="h-9 rounded-lg border border-input bg-card px-3 text-sm"
      >
        <option value="upheld">Upheld</option>
        <option value="overturned">Overturned</option>
        <option value="escalated">Escalated</option>
      </select>
      <label htmlFor={`notes-${grantId}`} className="sr-only">
        Review notes
      </label>
      <input
        id={`notes-${grantId}`}
        name="notes"
        maxLength={1000}
        placeholder="Notes (optional)"
        className="h-9 rounded-lg border border-input bg-card px-3 text-sm"
      />
      <SubmitButton variant="outline" size="sm" disabled={pending}>
        {pending ? "Recording..." : "Record review"}
      </SubmitButton>
      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
