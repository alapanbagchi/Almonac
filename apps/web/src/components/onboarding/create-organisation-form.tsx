"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { SubmitAction } from "@/components/auth/form-parts";
import { FormError } from "@/components/form/form-error";
import { useShake } from "@/components/motion/use-shake";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createFirstOrganisation } from "@/lib/admin/actions";
import { useActionMutation } from "@/lib/admin/mutations";
import { actionErrorMessage, AdminActionError } from "@/lib/admin/result";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export function CreateOrganisationForm() {
  const router = useRouter();
  const { ref: formRef, shake } = useShake<HTMLFormElement>();
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const create = useActionMutation(createFirstOrganisation);

  const effectiveSlug = slugTouched ? slug : slugify(name);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    create.mutate(
      { name, slug: effectiveSlug },
      {
        onSuccess: () => {
          router.push("/dashboard");
          router.refresh();
        },
        onError: (failure) => {
          setError(
            failure instanceof AdminActionError && failure.code === "CONFLICT"
              ? "That organisation address is already in use."
              : actionErrorMessage(failure, "The organisation could not be created."),
          );
          shake();
        },
      },
    );
  }

  return (
    <form ref={formRef} noValidate className="flex flex-col gap-6" onSubmit={submit}>
      <FormError message={error} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="organisation-name">Organisation name</Label>
        <Input
          id="organisation-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="organization"
          placeholder="Riverside Health"
          maxLength={200}
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="organisation-slug">Organisation address</Label>
        <Input
          id="organisation-slug"
          value={effectiveSlug}
          onChange={(event) => {
            setSlugTouched(true);
            setSlug(event.target.value);
          }}
          autoComplete="off"
          placeholder="riverside-health"
          maxLength={63}
          pattern="[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
          required
        />
        <p className="text-sm text-moss-bright">
          Lowercase letters, numbers and dashes. Used in your workspace address.
        </p>
      </div>

      <SubmitAction
        pending={create.isPending}
        label="Create organisation"
        pendingLabel="Creating organisation"
      />
    </form>
  );
}
