import Link from "next/link";

import { StatusBadge } from "@/components/admin/status-badge";
import {
  canManageOrganisation,
  getAdminContext,
  getVisibleOrganisations,
  readOrForbidden,
} from "@/lib/admin/page-data";

export const metadata = { title: "Audit Log" };

// The session guard must resolve before this page renders.
export const instant = false;

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ organisation?: string; before?: string }>;
}) {
  const [context, organisations, params] = await Promise.all([
    getAdminContext(),
    getVisibleOrganisations(),
    searchParams,
  ]);
  const selected =
    organisations.find((organisation) => organisation.id === params.organisation) ??
    organisations[0];
  const canRead =
    context !== null &&
    selected !== undefined &&
    canManageOrganisation(context, "audit.read", selected.id);
  const page =
    context !== null && selected !== undefined && canRead
      ? await readOrForbidden(() =>
          context.api.listAudit(context.token, selected.id, params.before),
        )
      : null;
  const forbidden = canRead && page === null;

  return (
    <div>
      <h1 className="font-display text-[2.05rem] leading-[1.15] font-medium tracking-[-0.02em] text-foreground">
        Audit Log
      </h1>
      <p className="mt-3 text-[14.5px] leading-relaxed text-moss-bright">
        Append-only records of authentication and administration actions. Entries cannot be edited
        or deleted.
      </p>

      {organisations.length > 1 ? (
        <nav aria-label="Organisation" className="mt-6 flex flex-wrap gap-2">
          {organisations.map((organisation) => (
            <Link
              key={organisation.id}
              href={`/dashboard/audit-log?organisation=${organisation.id}`}
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
      ) : !canRead || forbidden ? (
        <div className="mt-8 rounded-xl border border-dashed border-border p-10 text-center text-sm text-moss-bright">
          Your account cannot read the audit log.
        </div>
      ) : page === null || page.entries.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-border p-10 text-center text-sm text-moss-bright">
          No audit entries yet.
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[58rem] text-left text-sm">
              <thead className="bg-muted/40 text-xs text-moss-bright">
                <tr>
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="px-4 py-2.5 font-medium">Event</th>
                  <th className="px-4 py-2.5 font-medium">Actor</th>
                  <th className="px-4 py-2.5 font-medium">Outcome</th>
                  <th className="px-4 py-2.5 font-medium">Target</th>
                  <th className="px-4 py-2.5 font-medium">Request</th>
                </tr>
              </thead>
              <tbody>
                {page.entries.map((entry) => (
                  <tr key={entry.id} className="border-t border-border/70 align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-moss-bright">
                      {new Date(entry.occurredAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{entry.eventType}</td>
                    <td className="px-4 py-3 text-xs">
                      {entry.actorType}
                      {entry.actorUserId === null ? null : (
                        <span className="block text-moss-bright">{entry.actorUserId}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={entry.outcome} />
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {entry.targetType ?? "—"}
                      {entry.targetId === null ? null : (
                        <span className="block text-moss-bright">{entry.targetId}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-moss-bright">
                      {entry.requestId ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {page.nextCursor === null ? null : (
            <Link
              className="inline-flex rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted"
              href={`/dashboard/audit-log?organisation=${selected.id}&before=${encodeURIComponent(page.nextCursor)}`}
            >
              Older entries
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
