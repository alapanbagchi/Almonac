import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/form-parts";
import { CreateOrganisationForm } from "@/components/onboarding/create-organisation-form";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Create your organisation",
};

// The page reads the session on every request.
export const instant = false;

export default async function OnboardingPage() {
  const session = await getSession();
  if (session === null) redirect("/login?returnTo=/onboarding/organisation");
  if (session.memberships.length > 0) redirect("/dashboard");

  return (
    <AuthShell
      title="Create your first organisation"
      subtitle="An organisation owns your hospitals, staff and clinical settings."
    >
      <CreateOrganisationForm />
    </AuthShell>
  );
}
