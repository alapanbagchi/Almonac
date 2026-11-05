"use client";

import * as React from "react";

import { FormError } from "@/components/form/form-error";
import { SubmitButton } from "@/components/form/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useShake } from "@/components/motion/use-shake";
import { addDomain, setPrimaryDomain, verifyDomain } from "@/lib/admin/actions";
import type { Domain } from "@/lib/admin/model";
import { useAdminMutation } from "@/lib/admin/mutations";
import { actionErrorMessage, AdminActionError } from "@/lib/admin/result";
import { StatusBadge } from "./status-badge";

function domainMessage(error: unknown, fallback: string): string {
  if (error instanceof AdminActionError && error.code === "CONFLICT") {
    return "That domain is already registered.";
  }
  return actionErrorMessage(error, fallback);
}

export function DomainManager({
  hospitalId,
  domains,
  canManage,
}: {
  hospitalId: string;
  domains: Domain[];
  canManage: boolean;
}) {
  const { ref, shake } = useShake<HTMLDivElement>();
  const { ref: addRef, shake: shakeAdd } = useShake<HTMLFormElement>();
  const [error, setError] = React.useState<string | null>(null);
  const [addError, setAddError] = React.useState<string | null>(null);
  const [token, setToken] = React.useState<{ domain: string; value: string } | null>(null);

  const add = useAdminMutation(addDomain);
  const verify = useAdminMutation(verifyDomain);
  const primary = useAdminMutation(setPrimaryDomain);
  const pending = add.isPending || verify.isPending || primary.isPending;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setAddError(null);
    add.mutate(
      { hospitalId, domain: String(form.get("domain") ?? "").trim().toLowerCase() },
      {
        onSuccess: (created) => {
          setToken({ domain: created.domain.domain, value: created.token });
          formElement.reset();
        },
        onError: (failure) => {
          setAddError(domainMessage(failure, "The domain could not be added."));
          shakeAdd();
        },
      },
    );
  }

  function makePrimary(domain: Domain) {
    setError(null);
    primary.mutate(
      { hospitalId, domainId: domain.id },
      {
        onError: (failure) => {
          setError(domainMessage(failure, "The primary domain could not be changed."));
          shake();
        },
      },
    );
  }

  return (
    <div ref={ref} className="space-y-3">
      <FormError message={error} />
      {domains.length === 0 ? (
        <p className="text-sm text-moss-bright">No domains yet.</p>
      ) : (
        <ul className="space-y-2">
          {domains.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 px-3 py-2"
            >
              <span className="font-mono text-[13px]">{item.domain}</span>
              <StatusBadge status={item.verifiedAt === null ? "pending" : "active"} />
              {item.verifiedAt !== null && item.retiredAt === null ? (
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={!canManage || pending}
                  onClick={() => makePrimary(item)}
                >
                  Make primary
                </Button>
              ) : null}
              {item.verifiedAt === null && canManage ? (
                <form
                  className="flex items-center gap-1.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    setError(null);
                    verify.mutate(
                      {
                        hospitalId,
                        domainId: item.id,
                        token: String(form.get("token") ?? ""),
                      },
                      {
                        onError: (failure) => {
                          setError(
                            domainMessage(
                              failure,
                              "The domain could not be verified. Check the token and try again.",
                            ),
                          );
                          shake();
                        },
                      },
                    );
                  }}
                >
                  <Input
                    name="token"
                    aria-label={`Verification token for ${item.domain}`}
                    placeholder="TXT token"
                    maxLength={128}
                    className="h-7 w-44 text-xs"
                  />
                  <SubmitButton size="xs" variant="outline" disabled={pending}>
                    Verify
                  </SubmitButton>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <form ref={addRef} onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <FormError message={addError} />
          <div className="space-y-1.5">
            <Label htmlFor={`domain-${hospitalId}`}>Add a domain</Label>
            <Input
              id={`domain-${hospitalId}`}
              name="domain"
              required
              maxLength={253}
              placeholder="hospital.example.org"
              autoComplete="off"
              className="h-8 w-64 text-sm"
            />
          </div>
          <SubmitButton size="sm" variant="outline" disabled={pending}>
            Add
          </SubmitButton>
        </form>
      ) : null}

      {token === null ? null : (
        <div className="rounded-lg border border-border bg-bark-raised/40 p-3 text-sm text-foreground">
          <p className="font-medium">Publish this TXT record for {token.domain}:</p>
          <code className="mt-1 block break-all font-mono text-xs">{token.value}</code>
        </div>
      )}
    </div>
  );
}
