import { connection } from "next/server";

import { FacilitiesView } from "./_components/facilities-view";

export const metadata = { title: "Facilities" };

// The session guard must resolve before this page renders.
export const instant = false;

export default async function FacilitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ organisation?: string }>;
}) {
  // Blocking on the request is what produces per-request scripts with a nonce.
  await connection();
  const params = await searchParams;
  return <FacilitiesView organisationId={params.organisation ?? null} />;
}
