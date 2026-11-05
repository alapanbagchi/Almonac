"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { FormError } from "@/components/form/form-error";
import { useShake } from "@/components/motion/use-shake";
import { adminRequest } from "@/lib/admin/client";
import { SubmitButton } from "@/components/form/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message === "CONFLICT") {
    return "That slug is already in use.";
  }
  return "The organisation could not be created.";
}

export function CreateOrganisationForm() {
  const router = useRouter();
  const { ref: formRef, shake } = useShake<HTMLFormElement>();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setError(null);
    try {
      await adminRequest("organisations", "POST", {
        name: String(form.get("name") ?? ""),
        slug: String(form.get("slug") ?? ""),
      });
      formElement.reset();
      router.refresh();
    } catch (failure) {
      setError(errorMessage(failure));
      shake();
    } finally {
      setPending(false);
    }
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
      <SubmitButton disabled={pending}>
        {pending ? "Creating..." : "Create"}
      </SubmitButton>
    </form>
  );
}
