import { connection } from "next/server";

import { UsersView } from "./_components/users-view";

export const metadata = { title: "Users & Roles" };

// The session guard must resolve before this page renders.
export const instant = false;

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ organisation?: string }>;
}) {
  // Blocking on the request is what produces per-request scripts with a nonce.
  await connection();
  const params = await searchParams;
  return <UsersView organisationId={params.organisation ?? null} />;
}
