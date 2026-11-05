"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { AdminEmpty, AdminPageHeader } from "@/components/admin/page-shell";
import { OrganisationPicker } from "@/components/admin/organisation-picker";
import { AdminError, AdminLoading } from "@/components/admin/query-state";
import { StatusBadge } from "@/components/admin/status-badge";
import { auditQuery } from "@/lib/admin/queries";
import { queryErrorMessage } from "@/lib/admin/result";

export function AuditLogView({
  organisationId,
  cursor,
}: {
  organisationId: string | null;
  cursor: string | undefined;
}) {
  const query = useQuery(auditQuery(organisationId, cursor));

  if (query.isPending) return <AdminLoading />;
  if (query.isError) {
    return (
      <AdminError
        message={queryErrorMessage(query.error, "The audit log could not be loaded.")}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const { organisations, selected, canRead, forbidden, entries, nextCursor } = query.data;

  return (
    <div>
      <AdminPageHeader
        title="Audit Log"
        description="Append-only records of authentication and administration actions. Entries cannot be edited or deleted."
      />
      <OrganisationPicker
        organisations={organisations}
        selectedId={selected?.id ?? null}
        basePath="/dashboard/audit-log"
      />

      {selected === null ? (
        <AdminEmpty>No organisation is visible to your account.</AdminEmpty>
      ) : forbidden || !canRead ? (
        <AdminEmpty>Your account cannot read the audit log.</AdminEmpty>
      ) : entries.length === 0 ? (
        <AdminEmpty>No audit entries yet.</AdminEmpty>
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
                {entries.map((entry) => (
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
          {nextCursor === null ? null : (
            <Link
              className="inline-flex rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted"
              href={`/dashboard/audit-log?organisation=${selected.id}&before=${encodeURIComponent(nextCursor)}`}
            >
              Older entries
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
