import { connection } from "next/server";

import { AuditLogView } from "./_components/audit-log-view";

export const metadata = { title: "Audit Log" };

// The session guard must resolve before this page renders.
export const instant = false;

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ organisation?: string; before?: string }>;
}) {
  // Blocking on the request is what produces per-request scripts with a nonce.
  await connection();
  const params = await searchParams;
  return (
    <AuditLogView
      organisationId={params.organisation ?? null}
      cursor={params.before}
    />
  );
}
