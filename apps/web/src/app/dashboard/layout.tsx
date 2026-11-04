import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { buttonVariants } from "@/components/ui/button";
import { getSession } from "@/lib/auth/session";
import { toSessionHospitals, toSessionUser } from "@/lib/auth/session-view";

// The dashboard must not render a shell before the session is known.
export const instant = false;

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  let session: Awaited<ReturnType<typeof getSession>>;
  try {
    session = await getSession();
  } catch {
    return <DashboardUnavailable />;
  }
  if (session === null) redirect("/login?returnTo=/dashboard");
  if (
    session.memberships.length === 0 &&
    !session.permissions.includes("platform.manage")
  ) {
    redirect("/onboarding/organisation");
  }

  const hospitals = toSessionHospitals(session);
  const user = toSessionUser(session);

  return (
    <div className="flex min-h-svh flex-col bg-background lg:flex-row">
      <DashboardSidebar hospitals={hospitals} user={user} />
      <main className="flex-1 px-6 py-10 lg:px-12">
        <div className="mx-auto w-full max-w-[760px]">{children}</div>
      </main>
    </div>
  );
}

function DashboardUnavailable() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-[440px] text-center">
        <span aria-hidden="true" className="logo-mark block aspect-[1317/1194] w-16 shrink-0" />
        <p className="mt-8 text-[12px] font-medium tracking-[0.18em] text-moss-bright uppercase">
          Workspace unavailable
        </p>
        <h1 className="mt-3 font-display text-[2.05rem] leading-[1.15] font-medium text-parchment">
          We could not load your workspace
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-moss-bright" role="status">
          The session service did not respond. Try again in a moment.
        </p>
        <a href="/dashboard" className={buttonVariants({ className: "mt-8" })}>
          Try again
        </a>
      </div>
    </main>
  );
}
