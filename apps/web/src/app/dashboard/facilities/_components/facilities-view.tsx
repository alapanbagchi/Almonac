"use client";

import { useQuery } from "@tanstack/react-query";

import { CreateHospitalForm } from "@/components/admin/create-hospital-form";
import { DomainManager } from "@/components/admin/domain-manager";
import { AdminEmpty, AdminPageHeader } from "@/components/admin/page-shell";
import { OrganisationPicker } from "@/components/admin/organisation-picker";
import { AdminError, AdminLoading } from "@/components/admin/query-state";
import { StatusBadge } from "@/components/admin/status-badge";
import { facilitiesQuery } from "@/lib/admin/queries";
import { queryErrorMessage } from "@/lib/admin/result";

export function FacilitiesView({ organisationId }: { organisationId: string | null }) {
  const query = useQuery(facilitiesQuery(organisationId));

  if (query.isPending) return <AdminLoading />;
  if (query.isError) {
    return (
      <AdminError
        message={queryErrorMessage(query.error, "The facilities could not be loaded.")}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const { organisations, selected, canManage, forbidden, hospitals } = query.data;

  return (
    <div>
      <AdminPageHeader
        title="Facilities"
        description="Hospitals and their verified domains. A hospital must have a verified primary domain before it can become active."
      />
      <OrganisationPicker
        organisations={organisations}
        selectedId={selected?.id ?? null}
        basePath="/dashboard/facilities"
      />

      {selected === null ? (
        <AdminEmpty>No organisation is visible to your account.</AdminEmpty>
      ) : forbidden || !canManage ? (
        <AdminEmpty>Your account cannot manage hospitals or domains.</AdminEmpty>
      ) : (
        <div className="mt-8 space-y-6">
          {hospitals.length === 0 ? (
            <AdminEmpty>No hospitals in {selected.name} yet.</AdminEmpty>
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
                    domains={hospital.domains}
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
