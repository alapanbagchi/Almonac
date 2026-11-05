"use client";

import * as React from "react";

import { FormError } from "@/components/form/form-error";
import { SubmitButton } from "@/components/form/submit-button";
import { useShake } from "@/components/motion/use-shake";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createInvitation } from "@/lib/admin/actions";
import type { Hospital, Role } from "@/lib/admin/model";
import { useAdminMutation } from "@/lib/admin/mutations";
import { actionErrorMessage, AdminActionError } from "@/lib/admin/result";

export function InviteForm({
  organisationId,
  hospitals,
  roles,
}: {
  organisationId: string;
  hospitals: Hospital[];
  roles: Role[];
}) {
  const { ref: formRef, shake } = useShake<HTMLFormElement>();
  const [error, setError] = React.useState<string | null>(null);
  const [hospitalId, setHospitalId] = React.useState("");
  const [roleId, setRoleId] = React.useState("");
  const invite = useAdminMutation(createInvitation);

  const available = roles.filter((role) =>
    hospitalId === "" ? role.scope === "organisation" : role.scope === "hospital",
  );

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setError(null);
    invite.mutate(
      {
        organisationId,
        email: String(form.get("email") ?? "").trim(),
        hospitalId: hospitalId === "" ? null : hospitalId,
        roleIds: roleId === "" ? [] : [roleId],
      },
      {
        onSuccess: () => {
          formElement.reset();
          setHospitalId("");
          setRoleId("");
        },
        onError: (failure) => {
          setError(
            failure instanceof AdminActionError && failure.code === "CONFLICT"
              ? "That person cannot be invited. Check the email and existing membership."
              : actionErrorMessage(failure, "The invitation could not be sent."),
          );
          shake();
        },
      },
    );
  }

  return (
    <form ref={formRef} onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <FormError message={error} />
      <div className="space-y-1.5">
        <Label htmlFor="invite-email">Work email</Label>
        <Input
          id="invite-email"
          name="email"
          type="email"
          required
          maxLength={320}
          autoComplete="off"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="invite-hospital">Hospital</Label>
        <select
          id="invite-hospital"
          className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm"
          value={hospitalId}
          onChange={(event) => {
            setHospitalId(event.target.value);
            setRoleId("");
          }}
        >
          <option value="">Whole organisation</option>
          {hospitals.map((hospital) => (
            <option key={hospital.id} value={hospital.id}>
              {hospital.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="invite-role">Role</Label>
        <select
          id="invite-role"
          required
          className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm"
          value={roleId}
          onChange={(event) => setRoleId(event.target.value)}
        >
          <option value="">Choose a role</option>
          {available.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <SubmitButton disabled={invite.isPending || roleId === ""}>
          {invite.isPending ? "Sending..." : "Send invitation"}
        </SubmitButton>
      </div>
    </form>
  );
}
