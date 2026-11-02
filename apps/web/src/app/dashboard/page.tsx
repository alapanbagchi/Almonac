import * as React from "react";
import Link from "next/link";

import { Clock01 } from "@/components/animate-ui/icons/hugeicons/clock-01";
import { Globe02 } from "@/components/animate-ui/icons/hugeicons/globe-02";
import { Location01 } from "@/components/animate-ui/icons/hugeicons/location-01";
import { Settings02 } from "@/components/animate-ui/icons/hugeicons/settings-02";
import { UserRound } from "@/components/animate-ui/icons/hugeicons/user-round";

export const metadata = { title: "Overview" };

type SectionIcon = React.ComponentType<{
  size?: number;
  className?: string;
  animate?: boolean;
}>;

const SECTIONS: { href: string; label: string; description: string; icon: SectionIcon }[] = [
  { href: "/dashboard/organizations", label: "Organizations", description: "Companies and teams you administer.", icon: Globe02 },
  { href: "/dashboard/facilities", label: "Facilities", description: "Hospitals and care sites.", icon: Location01 },
  { href: "/dashboard/users", label: "Users & Roles", description: "Admins, members, permissions.", icon: UserRound },
  { href: "/dashboard/audit-log", label: "Audit Log", description: "Activity and compliance trail.", icon: Clock01 },
  { href: "/dashboard/settings", label: "Settings", description: "Workspace preferences.", icon: Settings02 },
];

export default function DashboardPage() {
  return (
    <div>
      <h1 className="font-display text-[2.05rem] leading-[1.15] font-medium tracking-[-0.02em] text-foreground">
        Overview
      </h1>
      <p className="mt-3 text-[14.5px] leading-relaxed text-moss-bright">
        Your workspace is ready.
      </p>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <Link
              key={section.href}
              href={section.href}
              className="group flex items-start gap-3 rounded-xl border border-border bg-ink-raised p-4 outline-none transition-colors hover:border-moss focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="mt-0.5 text-moss-bright transition-colors group-hover:text-foreground">
                <Icon size={18} />
              </span>
              <span>
                <span className="block text-sm font-medium text-foreground">{section.label}</span>
                <span className="mt-0.5 block text-[13px] leading-relaxed text-moss-bright">{section.description}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
