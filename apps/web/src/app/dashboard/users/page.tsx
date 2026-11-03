import Link from "next/link";

import { InvitationActions, MembershipActions } from "@/components/admin/membership-actions";
import { InviteForm } from "@/components/admin/invite-form";
import { StatusBadge } from "@/components/admin/status-badge";
import type { Hospital, Invitation, Membership, Role } from "@/lib/admin/model";
import {
  canManageOrganisation,
  getAdminContext,
  getVisibleOrganisations,
  readOrForbidden,
} from "@/lib/admin/page-data";

export const metadata = { title: "Users & Roles" };

// The session guard must resolve before this page renders.
export const instant = false;

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ organisation?: string }>;
}) {
  const [context, organisations, params] = await Promise.all([
    getAdminContext(),
    getVisibleOrganisations(),
    searchParams,
  ]);
  const selected =
    organisations.find((organisation) => organisation.id === params.organisation) ??
    organisations[0];

  const canManage =
    context !== null &&
    selected !== undefined &&
    canManageOrganisation(context, "membership.manage", selected.id);

  let memberships: Membership[] = [];
  let invitations: Invitation[] = [];
  let roles: Role[] = [];
  let hospitals: Hospital[] = [];
  let forbidden = false;
  if (canManage && context !== null && selected !== undefined) {
    const lists = await readOrForbidden(() =>
      Promise.all([
        context.api.listMemberships(context.token, selected.id),
        context.api.listInvitations(context.token, selected.id),
        context.api.listRoles(context.token, selected.id),
        context.api.listHospitals(context.token, selected.id),
      ]),
    );
    if (lists === null) {
      forbidden = true;
    } else {
      [memberships, invitations, roles, hospitals] = lists;
    }
  }
  const hospitalNames = new Map(hospitals.map((hospital) => [hospital.id, hospital.name]));

  return (
    <div>
      <h1 className="font-display text-[2.05rem] leading-[1.15] font-medium tracking-[-0.02em] text-foreground">
        Users &amp; Roles
      </h1>
      <p className="mt-3 text-[14.5px] leading-relaxed text-moss-bright">
        Access comes from a membership. Organisation-wide roles never grant clinical access on
        their own.
      </p>

      {organisations.length > 1 ? (
        <nav aria-label="Organisation" className="mt-6 flex flex-wrap gap-2">
          {organisations.map((organisation) => (
            <Link
              key={organisation.id}
              href={`/dashboard/users?organisation=${organisation.id}`}
              aria-current={organisation.id === selected?.id ? "page" : undefined}
              className={
                organisation.id === selected?.id
                  ? "rounded-full bg-bark-raised/40 px-3 py-1 text-sm text-foreground"
                  : "rounded-full border border-border px-3 py-1 text-sm text-moss-bright hover:text-foreground"
              }
            >
              {organisation.name}
            </Link>
          ))}
        </nav>
      ) : null}

      {selected === undefined ? (
        <div className="mt-8 rounded-xl border border-dashed border-border p-10 text-center text-sm text-moss-bright">
          No organisation is visible to your account.
        </div>
      ) : !canManage || forbidden ? (
        <div className="mt-8 rounded-xl border border-dashed border-border p-10 text-center text-sm text-moss-bright">
          Your account cannot manage staff or roles.
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-4 text-sm font-semibold text-foreground">
              Invite someone to {selected.name}
            </h2>
            <InviteForm organisationId={selected.id} hospitals={hospitals} roles={roles} />
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-foreground">
              Members ({memberships.length})
            </h2>
            {memberships.length === 0 ? (
              <p className="text-sm text-moss-bright">No members yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[46rem] text-left text-sm">
                  <thead className="bg-muted/40 text-xs text-moss-bright">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Person</th>
                      <th className="px-4 py-2.5 font-medium">Scope</th>
                      <th className="px-4 py-2.5 font-medium">Roles</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {memberships.map((membership) => (
                      <tr key={membership.id} className="border-t border-border/70">
                        <td className="px-4 py-3">
                          <p className="text-foreground">{membership.displayName}</p>
                          <p className="text-xs text-moss-bright">{membership.email}</p>
                        </td>
                        <td className="px-4 py-3 text-[13px]">
                          {membership.hospitalId === null
                            ? "Organisation"
                            : (hospitalNames.get(membership.hospitalId) ?? "Hospital")}
                        </td>
                        <td className="px-4 py-3 text-[13px]">
                          {membership.roles.length === 0 ? "None" : membership.roles.join(", ")}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={membership.status} />
                        </td>
                        <td className="px-4 py-3">
                          {membership.status === "active" ? (
                            <MembershipActions membershipId={membership.id} />
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-foreground">
              Invitations ({invitations.length})
            </h2>
            {invitations.length === 0 ? (
              <p className="text-sm text-moss-bright">No invitations yet.</p>
            ) : (
              <ul className="space-y-2">
                {invitations.map((invitation) => (
                  <li
                    key={invitation.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
                  >
                    <div>
                      <p className="text-sm text-foreground">{invitation.email}</p>
                      <p className="text-xs text-moss-bright">
                        {invitation.kind === "existing_user" ? "Existing user" : "New user"} ·{" "}
                        {invitation.hospitalId === null
                          ? "Organisation"
                          : (hospitalNames.get(invitation.hospitalId) ?? "Hospital")}{" "}
                        · expires {new Date(invitation.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={invitation.status} />
                      {invitation.status === "pending" ? (
                        <InvitationActions invitationId={invitation.id} />
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
