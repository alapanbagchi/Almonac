"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { adminRequest } from "@/lib/admin/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Action = "suspend" | "revoke";

export function MembershipActions({ membershipId }: { membershipId: string }) {
  const router = useRouter();
  const [action, setAction] = React.useState<Action | null>(null);
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function run() {
    if (action === null) return;
    setPending(true);
    setError(null);
    try {
      await adminRequest(`memberships/${membershipId}/${action}`, "POST", {
        reason: reason.trim(),
      });
      setAction(null);
      setReason("");
      router.refresh();
    } catch {
      setError("The membership could not be changed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => setAction(action === "suspend" ? null : "suspend")}
        >
          Suspend
        </Button>
        <Button
          type="button"
          size="xs"
          variant="destructive"
          onClick={() => setAction(action === "revoke" ? null : "revoke")}
        >
          Revoke
        </Button>
      </div>
      {action === null ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason for the audit record"
            maxLength={500}
            className="h-8 w-56 text-xs"
          />
          <Button
            type="button"
            size="xs"
            disabled={pending || reason.trim() === ""}
            onClick={run}
          >
            Confirm {action}
          </Button>
        </div>
      )}
      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function InvitationActions({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function resend() {
    setPending(true);
    setError(null);
    try {
      await adminRequest(`invitations/${invitationId}/resend`, "POST");
      router.refresh();
    } catch {
      setError("The invitation could not be resent.");
    } finally {
      setPending(false);
    }
  }

  async function revoke() {
    setPending(true);
    setError(null);
    try {
      await adminRequest(`invitations/${invitationId}/revoke`, "POST");
      setConfirming(false);
      router.refresh();
    } catch {
      setError("The invitation could not be revoked.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Button type="button" size="xs" variant="outline" disabled={pending} onClick={resend}>
          Resend
        </Button>
        {confirming ? (
          <>
            <Button type="button" size="xs" variant="destructive" disabled={pending} onClick={revoke}>
              Confirm revoke
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="xs"
            variant="destructive"
            disabled={pending}
            onClick={() => setConfirming(true)}
          >
            Revoke
          </Button>
        )}
      </div>
      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}