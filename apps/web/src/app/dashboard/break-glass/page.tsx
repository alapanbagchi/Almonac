import { connection } from "next/server";

import { BreakGlassView } from "./_components/break-glass-view";

export const metadata = { title: "Break Glass" };

// The session guard must resolve before this page renders.
export const instant = false;

export default async function BreakGlassPage({
  searchParams,
}: {
  searchParams: Promise<{ stepUp?: string }>;
}) {
  // Blocking on the request is what produces per-request scripts with a nonce.
  await connection();
  const params = await searchParams;
  return <BreakGlassView stepUp={params.stepUp} />;
}
