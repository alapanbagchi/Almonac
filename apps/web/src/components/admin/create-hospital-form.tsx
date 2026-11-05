"use client";

import * as React from "react";

import { FormError } from "@/components/form/form-error";
import { SubmitButton } from "@/components/form/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useShake } from "@/components/motion/use-shake";
import { createHospital } from "@/lib/admin/actions";
import { useAdminMutation } from "@/lib/admin/mutations";
import { adminKeys } from "@/lib/admin/queries";
import { actionErrorMessage, AdminActionError } from "@/lib/admin/result";

export function CreateHospitalForm({ organisationId }: { organisationId: string }) {
  const { ref: formRef, shake } = useShake<HTMLFormElement>();
  const [error, setError] = React.useState<string | null>(null);
  const create = useAdminMutation(createHospital, adminKeys.facilities(organisationId));

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setError(null);
    create.mutate(
      {
        organisationId,
        name: String(form.get("name") ?? ""),
        slug: String(form.get("slug") ?? ""),
        timezone: String(form.get("timezone") ?? "UTC"),
      },
      {
        onSuccess: () => formElement.reset(),
        onError: (failure) => {
          setError(
            failure instanceof AdminActionError && failure.code === "CONFLICT"
              ? "A hospital with this slug already exists."
              : actionErrorMessage(failure, "The hospital could not be created."),
          );
          shake();
        },
      },
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      className="grid gap-3 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end"
    >
      <FormError message={error} />
      <div className="space-y-1.5">
        <Label htmlFor={`hospital-name-${organisationId}`}>Hospital</Label>
        <Input
          id={`hospital-name-${organisationId}`}
          name="name"
          required
          maxLength={200}
          autoComplete="off"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`hospital-slug-${organisationId}`}>Slug</Label>
        <Input
          id={`hospital-slug-${organisationId}`}
          name="slug"
          required
          maxLength={63}
          pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
          autoComplete="off"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`hospital-timezone-${organisationId}`}>Time zone</Label>
        <Input
          id={`hospital-timezone-${organisationId}`}
          name="timezone"
          defaultValue="UTC"
          maxLength={64}
        />
      </div>
      <SubmitButton disabled={create.isPending}>
        {create.isPending ? "Adding..." : "Add hospital"}
      </SubmitButton>
    </form>
  );
}
