import { AcceptInvitation } from "@/components/admin/accept-invitation";
import { ClaimInvitation } from "@/components/auth/claim-invitation";
import { getSession } from "@/lib/auth/session";

export const metadata = { title: "Accept invitation" };

// The session guard must resolve before this page renders.
export const instant = false;

export default async function AcceptInvitationPage() {
  const session = await getSession();
  return session === null ? <ClaimInvitation /> : <AcceptInvitation />;
}
