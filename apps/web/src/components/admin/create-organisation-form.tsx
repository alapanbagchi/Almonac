"use client";

import * as React from "react";

import { FormError } from "@/components/form/form-error";
import { SubmitButton } from "@/components/form/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useShake } from "@/components/motion/use-shake";
import { createOrganisation } from "@/lib/admin/actions";
import { useAdminMutation } from "@/lib/admin/mutations";
import { actionErrorMessage, AdminActionError } from "@/lib/admin/result";

function messageFor(error: unknown): string {
  if (error instanceof AdminActionError && error.code === "CONFLICT") {
    return "That slug is already in use.";
  }
  return actionErrorMessage(error, "The organisation could not be created.");
}

export function CreateOrganisationForm() {
  const { ref: formRef, shake } = useShake<HTMLFormElement>();
  const [error, setError] = React.useState<string | null>(null);
  const create = useAdminMutation(createOrganisation);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setError(null);
    create.mutate(
      {
        name: String(form.get("name") ?? ""),
        slug: String(form.get("slug") ?? ""),
      },
      {
        onSuccess: () => formElement.reset(),
        onError: (failure) => {
          setError(messageFor(failure));
          shake();
        },
      },
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
    >
      <FormError message={error} />
      <div className="space-y-1.5">
        <Label htmlFor="organisation-name">Name</Label>
        <Input id="organisation-name" name="name" required maxLength={200} autoComplete="off" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="organisation-slug">Slug</Label>
        <Input
          id="organisation-slug"
          name="slug"
          required
          maxLength={63}
          pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
          autoComplete="off"
        />
      </div>
      <SubmitButton disabled={create.isPending}>
        {create.isPending ? "Creating..." : "Create"}
      </SubmitButton>
    </form>
  );
}
