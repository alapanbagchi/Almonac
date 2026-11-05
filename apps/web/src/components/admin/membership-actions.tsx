"use client";

import * as React from "react";

import { FormError } from "@/components/form/form-error";
import { useShake } from "@/components/motion/use-shake";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  resendInvitation,
  revokeInvitation,
  revokeMembership,
  suspendMembership,
} from "@/lib/admin/actions";
import { useAdminMutation } from "@/lib/admin/mutations";
import { actionErrorMessage } from "@/lib/admin/result";

type Action = "suspend" | "revoke";

export function MembershipActions({ membershipId }: { membershipId: string }) {
  const { ref, shake } = useShake<HTMLDivElement>();
  const [action, setAction] = React.useState<Action | null>(null);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const suspend = useAdminMutation(suspendMembership);
  const revoke = useAdminMutation(revokeMembership);
  const pending = suspend.isPending || revoke.isPending;

  function run() {
    if (action === null) return;
    setError(null);
    const mutation = action === "suspend" ? suspend : revoke;
    mutation.mutate(
      { membershipId, reason: reason.trim() },
      {
        onSuccess: () => {
          setAction(null);
          setReason("");
        },
        onError: (failure) => {
          setError(actionErrorMessage(failure, "The membership could not be changed."));
          shake();
        },
      },
    );
  }

  return (
    <div ref={ref} className="space-y-2">
      <div className="flex gap-2">
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => {
            setError(null);
            setAction(action === "suspend" ? null : "suspend");
          }}
        >
          Suspend
        </Button>
        <Button
          type="button"
          size="xs"
          variant="destructive"
          onClick={() => {
            setError(null);
            setAction(action === "revoke" ? null : "revoke");
          }}
        >
          Revoke
        </Button>
      </div>
      {action === null ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <FormError message={error} />
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
    </div>
  );
}

export function InvitationActions({ invitationId }: { invitationId: string }) {
  const { ref, shake } = useShake<HTMLDivElement>();
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const resend = useAdminMutation(resendInvitation);
  const revoke = useAdminMutation(revokeInvitation);
  const pending = resend.isPending || revoke.isPending;

  function run(action: "resend" | "revoke") {
    setError(null);
    const mutation = action === "resend" ? resend : revoke;
    mutation.mutate(invitationId, {
      onSuccess: () => setConfirming(false),
      onError: (failure) => {
        setError(
          actionErrorMessage(
            failure,
            action === "resend"
              ? "The invitation could not be resent."
              : "The invitation could not be revoked.",
          ),
        );
        shake();
      },
    });
  }

  return (
    <div ref={ref} className="space-y-1">
      <FormError message={error} />
      <div className="flex gap-2">
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={pending}
          onClick={() => run("resend")}
        >
          Resend
        </Button>
        {confirming ? (
          <>
            <Button
              type="button"
              size="xs"
              variant="destructive"
              disabled={pending}
              onClick={() => run("revoke")}
            >
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
    </div>
  );
}
