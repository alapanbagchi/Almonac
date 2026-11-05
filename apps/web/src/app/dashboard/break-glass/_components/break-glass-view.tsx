"use client";

import { useQuery } from "@tanstack/react-query";

import { AdminPageHeader } from "@/components/admin/page-shell";
import { AdminError, AdminLoading } from "@/components/admin/query-state";
import { StatusBadge } from "@/components/admin/status-badge";
import { ReviewGrant, RevokeGrant } from "@/components/break-glass/grant-actions";
import { RequestGrantForm } from "@/components/break-glass/request-grant-form";
import type { BreakGlassGrant } from "@/lib/break-glass/model";
import { isStepUpFailure, type StepUpFailure } from "@/lib/auth/redirects";
import { breakGlassQuery } from "@/lib/admin/queries";
import { queryErrorMessage } from "@/lib/admin/result";

const FAILURE_TEXT: Record<StepUpFailure, string> = {
  credentials: "The password was not correct.",
  denied: "The request did not come from Almonac.",
  failed: "The identity check did not finish.",
  invalid: "The return address was not valid.",
  mfa: "This account requires multi-factor authentication.",
  session: "Your session ended before the check started.",
  unavailable: "The identity service is unavailable.",
};

export function BreakGlassView({ stepUp }: { stepUp: string | undefined }) {
  const query = useQuery(breakGlassQuery());
  const failure = isStepUpFailure(stepUp) ? stepUp : null;

  if (query.isPending) return <AdminLoading />;
  if (query.isError) {
    return (
      <AdminError
        message={queryErrorMessage(query.error, "The grants could not be loaded.")}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const { grants, hospitals, canRequest, canReview } = query.data;

  return (
    <div>
      <AdminPageHeader
        title="Break Glass"
        description="Time-boxed, read-only emergency access to one hospital. Every grant is audited, needs a recent identity check, and is reviewed after it ends."
      />

      {failure === null ? null : (
        <p
          role="alert"
          className="mt-6 rounded-xl border border-clay/40 bg-clay/10 px-4 py-3 text-sm text-parchment"
        >
          {FAILURE_TEXT[failure]} Try again.
        </p>
      )}

      <section className="mt-8 rounded-xl border border-border bg-ink-raised p-6">
        <h2 className="text-[15px] font-semibold text-foreground">Request emergency access</h2>
        <p className="mt-1 mb-5 text-[13px] leading-relaxed text-moss-bright">
          You become the subject of the grant. An independent reviewer examines it after it ends.
        </p>
        {canRequest && hospitals.length > 0 ? (
          <RequestGrantForm hospitals={hospitals} returnTo="/dashboard/break-glass" />
        ) : (
          <p className="text-sm text-moss-bright">
            {hospitals.length === 0
              ? "You have no hospital membership to request access for."
              : "Your account cannot request break-glass access."}
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-[15px] font-semibold text-foreground">Grants</h2>
        {grants.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-border p-10 text-center text-sm text-moss-bright">
            No grants yet.
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[62rem] text-left text-sm">
              <thead className="bg-muted/40 text-xs text-moss-bright">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Hospital</th>
                  <th className="px-4 py-2.5 font-medium">Mode</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Window</th>
                  <th className="px-4 py-2.5 font-medium">Reason</th>
                  <th className="px-4 py-2.5 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((grant) => (
                  <tr key={grant.id} className="border-t border-border/70 align-top">
                    <td className="px-4 py-3 text-xs">
                      {hospitalName(grant, hospitals)}
                      <span className="block text-moss-bright">{grant.id}</span>
                    </td>
                    <td className="px-4 py-3 text-xs capitalize">
                      {grant.approvalMode.replace("_", " ")}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={grant.status} />
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap text-moss-bright">
                      {new Date(grant.startsAt).toLocaleString()} –{" "}
                      {new Date(grant.endsAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-xs">{grant.reason}</td>
                    <td className="px-4 py-3">
                      <GrantAction grant={grant} canReview={canReview} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function hospitalName(
  grant: BreakGlassGrant,
  hospitals: { id: string; name: string }[],
): string {
  return hospitals.find((hospital) => hospital.id === grant.hospitalId)?.name ?? grant.hospitalId;
}

function GrantAction({ grant, canReview }: { grant: BreakGlassGrant; canReview: boolean }) {
  if (grant.status === "active" || grant.status === "approved") {
    return <RevokeGrant grantId={grant.id} />;
  }
  if (canReview && (grant.status === "expired" || grant.status === "revoked")) {
    return <ReviewGrant grantId={grant.id} />;
  }
  return <span className="text-xs text-moss-bright">Closed</span>;
}
