import { Suspense } from "react";

import { StatusBadge } from "@/components/admin/status-badge";
import { ReviewGrant, RevokeGrant } from "@/components/break-glass/grant-actions";
import { RequestGrantForm } from "@/components/break-glass/request-grant-form";
import { createBreakGlassApi } from "@/lib/break-glass/api";
import type { BreakGlassGrant } from "@/lib/break-glass/model";
import { loadWebConfig } from "@/lib/auth/config";
import { isStepUpFailure, type StepUpFailure } from "@/lib/auth/redirects";
import { getSession, getSessionToken } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export const metadata = { title: "Break Glass" };

// The session guard must resolve before this page renders.
export const instant = false;

const FAILURE_TEXT: Record<StepUpFailure, string> = {
  denied: "The request did not come from Almonac.",
  failed: "The identity check did not finish.",
  invalid: "The return address was not valid.",
  session: "Your session ended before the check started.",
  unavailable: "The identity service is unavailable.",
};

export default function BreakGlassPage({
  searchParams,
}: {
  searchParams: Promise<{ stepUp?: string }>;
}) {
  return (
    <Suspense fallback={<BreakGlassSkeleton />}>
      <BreakGlassContent searchParams={searchParams} />
    </Suspense>
  );
}

async function BreakGlassContent({
  searchParams,
}: {
  searchParams: Promise<{ stepUp?: string }>;
}) {
  const session = await getSession();
  const token = await getSessionToken();
  if (session === null || token === null) redirect("/login?returnTo=/dashboard/break-glass");

  const config = loadWebConfig();
  const grants = await createBreakGlassApi({ baseUrl: config.apiUrl }).listGrants(token, null);
  const hospitals = session.memberships.flatMap((membership) =>
    membership.hospitalId === null
      ? []
      : [{ id: membership.hospitalId, name: membership.hospitalName ?? membership.hospitalId }],
  );
  const canRequest = session.permissions.includes("break_glass.request");
  const canReview =
    session.permissions.includes("break_glass.approve") ||
    session.permissions.includes("platform.manage");

  const params = await searchParams;
  const failure = isStepUpFailure(params.stepUp) ? params.stepUp : null;

  return (
    <div>
      <h1 className="font-display text-[2.05rem] leading-[1.15] font-medium tracking-[-0.02em] text-foreground">
        Break Glass
      </h1>
      <p className="mt-3 max-w-[68ch] text-[14.5px] leading-relaxed text-moss-bright">
        Time-boxed, read-only emergency access to one hospital. Every grant is audited, needs a
        recent identity check, and is reviewed after it ends.
      </p>

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

function BreakGlassSkeleton() {
  return (
    <div role="status" aria-label="Loading break-glass access" className="space-y-4">
      <div className="h-9 w-64 animate-pulse rounded-lg bg-muted" />
      <div className="h-28 animate-pulse rounded-xl bg-muted" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
