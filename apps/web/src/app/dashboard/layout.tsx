import type { ReactNode } from "react";

import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col bg-background lg:flex-row">
      <DashboardSidebar />
      <main className="flex-1 px-6 py-10 lg:px-12">
        <div className="mx-auto w-full max-w-[760px]">{children}</div>
      </main>
    </div>
  );
}
