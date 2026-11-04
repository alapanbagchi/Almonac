"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { FormError, SubmitAction } from "@/components/auth/form-parts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const effectiveSlug = slugTouched ? slug : slugify(name);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/onboarding/organisation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, slug: effectiveSlug }),
      });
      if (response.ok) {
        router.push("/dashboard");
        router.refresh();
        return;
      }
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(payload?.error?.message ?? "The organisation could not be created.");
    } catch {
      setError("The service did not respond. Try again shortly.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate className="flex flex-col gap-6" onSubmit={submit}>
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

      <FormError message={error} />

      <SubmitAction
        pending={pending}
        label="Create organisation"
        pendingLabel="Creating organisation"
      />
    </form>
  );
}
