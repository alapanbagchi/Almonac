import Link from "next/link";

import { CreateOrganisationForm } from "@/components/admin/create-organisation-form";
import { StatusBadge } from "@/components/admin/status-badge";
import { getAdminContext, getVisibleOrganisations, hasPermission } from "@/lib/admin/page-data";

export const metadata = { title: "Organizations" };

// The session guard must resolve before this page renders.
export const instant = false;

export default async function OrganizationsPage() {
  const [context, organisations] = await Promise.all([
    getAdminContext(),
    getVisibleOrganisations(),
  ]);
  const canCreate = context !== null && hasPermission(context, "platform.manage");

  return (
    <div>
      <h1 className="font-display text-[2.05rem] leading-[1.15] font-medium tracking-[-0.02em] text-foreground">
        Organizations
      </h1>
      <p className="mt-3 text-[14.5px] leading-relaxed text-moss-bright">
        Organisations own hospitals. Membership, not organisation ownership, grants access.
      </p>

      {canCreate ? (
        <section className="mt-8 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">New organisation</h2>
          <p className="mt-1 mb-4 text-[13px] text-moss-bright">
            The identity provider is provisioned before the organisation becomes active.
          </p>
          <CreateOrganisationForm />
        </section>
      ) : null}

      <section className="mt-8">
        {organisations.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-moss-bright">
            No organisations are visible to your account.
          </div>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {organisations.map((organisation) => (
              <li key={organisation.id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-foreground">
                      {organisation.name}
                    </h2>
                    <p className="mt-0.5 font-mono text-xs text-moss-bright">
                      {organisation.slug}
                    </p>
                  </div>
                  <StatusBadge status={organisation.status} />
                </div>
                <p className="mt-3 text-xs text-moss-bright">
                  Created {new Date(organisation.createdAt).toLocaleDateString()}
                  {organisation.zitadelOrgId === null
                    ? " · identity pending"
                    : " · identity provisioned"}
                </p>
                <div className="mt-4 flex flex-wrap gap-3 text-[13px]">
                  <Link
                    className="underline-offset-4 hover:underline"
                    href={`/dashboard/facilities?organisation=${organisation.id}`}
                  >
                    Facilities
                  </Link>
                  <Link
                    className="underline-offset-4 hover:underline"
                    href={`/dashboard/users?organisation=${organisation.id}`}
                  >
                    Staff and roles
                  </Link>
                  <Link
                    className="underline-offset-4 hover:underline"
                    href={`/dashboard/audit-log?organisation=${organisation.id}`}
                  >
                    Audit
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
