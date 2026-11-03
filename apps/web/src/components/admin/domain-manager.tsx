"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { adminRequest } from "@/lib/admin/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createdDomainSchema, type Domain } from "@/lib/admin/model";
import { StatusBadge } from "./status-badge";

export function DomainManager({
  hospitalId,
  domains,
  canManage,
}: {
  hospitalId: string;
  domains: Domain[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [token, setToken] = React.useState<{ domain: string; value: string } | null>(null);

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setError(null);
    try {
      const result = await adminRequest(`hospitals/${hospitalId}/domains`, "POST", {
        domain: String(form.get("domain") ?? "").trim().toLowerCase(),
      });
      const created = createdDomainSchema.safeParse(result);
      if (!created.success) throw new Error("ADMIN_INVALID_RESPONSE");
      setToken({ domain: created.data.domain.domain, value: created.data.token });
      formElement.reset();
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message === "DOMAIN_TAKEN"
          ? "That domain is already registered."
          : "The domain could not be added.",
      );
    } finally {
      setPending(false);
    }
  }

  async function verify(domain: Domain, value: string) {
    setPending(true);
    setError(null);
    try {
      await adminRequest(`hospitals/${hospitalId}/domains/${domain.id}/verify`, "POST", {
        token: value,
      });
      router.refresh();
    } catch {
      setError("The domain could not be verified. Check the token and try again.");
    } finally {
      setPending(false);
    }
  }

  async function makePrimary(domain: Domain) {
    setPending(true);
    setError(null);
    try {
      await adminRequest(`hospitals/${hospitalId}/domains/${domain.id}/primary`, "POST");
      router.refresh();
    } catch {
      setError("The primary domain could not be changed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
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
                    void verify(item, String(form.get("token") ?? ""));
                  }}
                >
                  <Input
                    name="token"
                    aria-label={`Verification token for ${item.domain}`}
                    placeholder="TXT token"
                    maxLength={128}
                    className="h-7 w-44 text-xs"
                  />
                  <Button type="submit" size="xs" variant="outline" disabled={pending}>
                    Verify
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
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
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            Add
          </Button>
        </form>
      ) : null}

      {token === null ? null : (
        <div className="rounded-lg border border-border bg-bark-raised/40 p-3 text-sm text-foreground">
          <p className="font-medium">Publish this TXT record for {token.domain}:</p>
          <code className="mt-1 block break-all font-mono text-xs">{token.value}</code>
        </div>
      )}
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
