import Link from "next/link";

import { CreateHospitalForm } from "@/components/admin/create-hospital-form";
import { DomainManager } from "@/components/admin/domain-manager";
import { StatusBadge } from "@/components/admin/status-badge";
import type { Domain, Hospital } from "@/lib/admin/model";
import {
  canManageOrganisation,
  getAdminContext,
  getVisibleOrganisations,
  readOrForbidden,
} from "@/lib/admin/page-data";

export const metadata = { title: "Facilities" };

// The session guard must resolve before this page renders.
export const instant = false;

export default async function FacilitiesPage({
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
    canManageOrganisation(context, "hospital.manage", selected.id);

  let hospitals: Hospital[] = [];
  let forbidden = false;
  const domains = new Map<string, Domain[]>();
  if (canManage && context !== null && selected !== undefined) {
    const loaded = await readOrForbidden(async () => {
      const list = (await context.api.listHospitals(context.token, selected.id)).items;
      const domainLists = await Promise.all(
        list.map(async (hospital) => {
          const page = await context.api.listDomains(context.token, hospital.id);
          return page.items;
        }),
      );
      return { list, domainLists };
    });
    if (loaded === null) {
      forbidden = true;
    } else {
      hospitals = loaded.list;
      hospitals.forEach((hospital, index) =>
        domains.set(hospital.id, loaded.domainLists[index] ?? []),
      );
    }
  }

  return (
    <div>
      <h1 className="font-display text-[2.05rem] leading-[1.15] font-medium tracking-[-0.02em] text-foreground">
        Facilities
      </h1>
      <p className="mt-3 text-[14.5px] leading-relaxed text-moss-bright">
        Hospitals and their verified domains. A hospital must have a verified primary domain before
        it can become active.
      </p>

      {organisations.length > 1 ? (
        <nav aria-label="Organisation" className="mt-6 flex flex-wrap gap-2">
          {organisations.map((organisation) => (
            <Link
              key={organisation.id}
              href={`/dashboard/facilities?organisation=${organisation.id}`}
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
          Your account cannot manage hospitals or domains.
        </div>
      ) : (
        <div className="mt-8 space-y-6">
          {hospitals.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-moss-bright">
              No hospitals in {selected.name} yet.
            </div>
          ) : (
            hospitals.map((hospital) => (
              <section key={hospital.id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-foreground">{hospital.name}</h2>
                    <p className="mt-0.5 font-mono text-xs text-moss-bright">
                      {hospital.slug} · {hospital.timezone}
                    </p>
                  </div>
                  <StatusBadge status={hospital.status} />
                </div>
                <div className="mt-4">
                  <DomainManager
                    hospitalId={hospital.id}
                    domains={domains.get(hospital.id) ?? []}
                    canManage={canManage}
                  />
                </div>
              </section>
            ))
          )}

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-4 text-sm font-semibold text-foreground">
              Add a hospital to {selected.name}
            </h2>
            <CreateHospitalForm organisationId={selected.id} />
          </section>
        </div>
      )}
    </div>
  );
}
