"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { FormError } from "@/components/form/form-error";
import { useShake } from "@/components/motion/use-shake";
import { adminRequest } from "@/lib/admin/client";
import { SubmitButton } from "@/components/form/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateHospitalForm({ organisationId }: { organisationId: string }) {
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
      await adminRequest(`organisations/${organisationId}/hospitals`, "POST", {
        name: String(form.get("name") ?? ""),
        slug: String(form.get("slug") ?? ""),
        timezone: String(form.get("timezone") ?? "UTC"),
      });
      formElement.reset();
      router.refresh();
    } catch {
      setError("The hospital could not be created.");
      shake();
    } finally {
      setPending(false);
    }
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
      <SubmitButton disabled={pending}>
        {pending ? "Adding..." : "Add hospital"}
      </SubmitButton>
    </form>
  );
}
