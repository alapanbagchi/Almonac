"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { StepUpPrompt } from "@/components/auth/step-up-prompt";
import { FormError } from "@/components/form/form-error";
import { useShake } from "@/components/motion/use-shake";
import { SubmitButton } from "@/components/form/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { breakGlassRequest, BreakGlassRequestError } from "@/lib/break-glass/client";

function message(error: unknown): string {
  if (error instanceof BreakGlassRequestError) {
    if (error.code === "CONFLICT") {
      return "An open emergency grant already exists for this hospital.";
    }
    if (error.code === "RULE_VIOLATION") {
      return "The request does not meet the break-glass rules. Check the reason and duration.";
    }
    if (error.code === "FORBIDDEN") {
      return "Your account cannot request break-glass access at this hospital.";
    }
  }
  return "The request could not be sent.";
}

export function RequestGrantForm({
  hospitals,
  returnTo,
}: {
  hospitals: { id: string; name: string }[];
  returnTo: string;
}) {
  const router = useRouter();
  const { ref: formRef, shake } = useShake<HTMLFormElement>();
  const [pending, setPending] = React.useState(false);
  const [stepUp, setStepUp] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setError(null);
    try {
      await breakGlassRequest("grants", "POST", {
        hospitalId: String(form.get("hospitalId") ?? ""),
        mode: "emergency",
        reason: String(form.get("reason") ?? "").trim(),
        durationMinutes: Number(form.get("durationMinutes") ?? 60),
      });
      formElement.reset();
      router.refresh();
    } catch (failure) {
      if (
        failure instanceof BreakGlassRequestError &&
        failure.code === "STEP_UP_REQUIRED"
      ) {
        setStepUp(true);
        return;
      }
      setError(message(failure));
      shake();
    } finally {
      setPending(false);
    }
  }

  if (stepUp) return <StepUpPrompt returnTo={returnTo} />;

  return (
    <form ref={formRef} onSubmit={submit} className="grid gap-3">
      <FormError message={error} />
      <div className="space-y-1.5">
        <Label htmlFor="grant-hospital">Hospital</Label>
        <select
          id="grant-hospital"
          name="hospitalId"
          required
          className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm"
        >
          <option value="">Choose a hospital</option>
          {hospitals.map((hospital) => (
            <option key={hospital.id} value={hospital.id}>
              {hospital.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="grant-reason">Reason</Label>
        <textarea
          id="grant-reason"
          name="reason"
          required
          minLength={1}
          maxLength={500}
          rows={3}
          className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm"
        />
        <p className="text-xs text-moss-bright">
          The reason is recorded in the audit log. Do not include patient data.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="grant-duration">Duration</Label>
        <Input
          id="grant-duration"
          name="durationMinutes"
          type="number"
          min={1}
          max={240}
          step={1}
          defaultValue={60}
          required
        />
        <p className="text-xs text-moss-bright">
          At most four hours. Access is read-only and ends automatically.
        </p>
      </div>
      <SubmitButton disabled={pending}>
        {pending ? "Requesting..." : "Request emergency access"}
      </SubmitButton>
    </form>
  );
}
