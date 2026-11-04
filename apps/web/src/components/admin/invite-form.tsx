"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { adminRequest } from "@/lib/admin/client";
import { SubmitButton } from "@/components/form/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Hospital, Role } from "@/lib/admin/model";

export function InviteForm({
  organisationId,
  hospitals,
  roles,
}: {
  organisationId: string;
  hospitals: Hospital[];
  roles: Role[];
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hospitalId, setHospitalId] = React.useState("");
  const [roleId, setRoleId] = React.useState("");

  const available = roles.filter((role) =>
    hospitalId === "" ? role.scope === "organisation" : role.scope === "hospital",
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setError(null);
    try {
      await adminRequest(`organisations/${organisationId}/invitations`, "POST", {
        email: String(form.get("email") ?? "").trim(),
        displayName: String(form.get("displayName") ?? "").trim() || undefined,
        hospitalId: hospitalId === "" ? null : hospitalId,
        roleIds: roleId === "" ? [] : [roleId],
      });
      formElement.reset();
      setHospitalId("");
      setRoleId("");
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message === "IDENTITY_CONFLICT"
          ? "That person cannot be invited. Check the email and existing membership."
          : "The invitation could not be sent.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
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
        <Label htmlFor="invite-name">Display name</Label>
        <Input id="invite-name" name="displayName" maxLength={200} autoComplete="off" />
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
        <SubmitButton disabled={pending || roleId === ""}>
          {pending ? "Sending..." : "Send invitation"}
        </SubmitButton>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {error}
        </p>
      )}
    </form>
  );
}
