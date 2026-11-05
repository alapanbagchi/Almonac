"use client";

import { useQuery } from "@tanstack/react-query";

import { InvitationActions, MembershipActions } from "@/components/admin/membership-actions";
import { InviteForm } from "@/components/admin/invite-form";
import { AdminEmpty, AdminPageHeader } from "@/components/admin/page-shell";
import { OrganisationPicker } from "@/components/admin/organisation-picker";
import { AdminError, AdminLoading } from "@/components/admin/query-state";
import { StatusBadge } from "@/components/admin/status-badge";
import { usersQuery } from "@/lib/admin/queries";
import { queryErrorMessage } from "@/lib/admin/result";

export function UsersView({ organisationId }: { organisationId: string | null }) {
  const query = useQuery(usersQuery(organisationId));

  if (query.isPending) return <AdminLoading />;
  if (query.isError) {
    return (
      <AdminError
        message={queryErrorMessage(query.error, "The staff list could not be loaded.")}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const { organisations, selected, canManage, forbidden, memberships, invitations, roles, hospitals } =
    query.data;
  const hospitalNames = new Map(hospitals.map((hospital) => [hospital.id, hospital.name]));

  return (
    <div>
      <AdminPageHeader
        title="Users & Roles"
        description="Access comes from a membership. Organisation-wide roles never grant clinical access on their own."
      />
      <OrganisationPicker
        organisations={organisations}
        selectedId={selected?.id ?? null}
        basePath="/dashboard/users"
      />

      {selected === null ? (
        <AdminEmpty>No organisation is visible to your account.</AdminEmpty>
      ) : forbidden || !canManage ? (
        <AdminEmpty>Your account cannot manage staff or roles.</AdminEmpty>
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
