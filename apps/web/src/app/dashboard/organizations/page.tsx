import { connection } from "next/server";

import { OrganizationsView } from "./_components/organizations-view";

export const metadata = { title: "Organizations" };

// The session guard must resolve before this page renders.
export const instant = false;

export default async function OrganizationsPage() {
  // Blocking on the request is what produces per-request scripts with a nonce.
  await connection();
  return <OrganizationsView />;
}
