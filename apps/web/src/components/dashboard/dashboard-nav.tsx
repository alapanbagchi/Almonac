"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ArrowDown01 } from "@/components/animate-ui/icons/hugeicons/arrow-down-01";
import { Clock01 } from "@/components/animate-ui/icons/hugeicons/clock-01";
import { Globe02 } from "@/components/animate-ui/icons/hugeicons/globe-02";
import { Home03 } from "@/components/animate-ui/icons/hugeicons/home-03";
import { Location01 } from "@/components/animate-ui/icons/hugeicons/location-01";
import { Settings02 } from "@/components/animate-ui/icons/hugeicons/settings-02";
import { UserRound } from "@/components/animate-ui/icons/hugeicons/user-round";

type NavIcon = React.ComponentType<{
  size?: number;
  className?: string;
  animate?: boolean;
}>;

interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const TOP_LEVEL: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: Home03 },
];

const GROUPS: NavGroup[] = [
  {
    label: "Manage",
    items: [
      { href: "/dashboard/organizations", label: "Organizations", icon: Globe02 },
      { href: "/dashboard/facilities", label: "Facilities", icon: Location01 },
      { href: "/dashboard/users", label: "Users & Roles", icon: UserRound },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/dashboard/audit-log", label: "Audit Log", icon: Clock01 },
      { href: "/dashboard/settings", label: "Settings", icon: Settings02 },
    ],
  },
];

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const [hovered, setHovered] = React.useState(false);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={
        active
          ? "flex items-center gap-3 rounded-lg bg-bark-raised/25 px-3 py-1.75 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50"
          : "flex items-center gap-3 rounded-lg px-3 py-1.75 text-sm text-moss-bright outline-none transition-colors hover:bg-bark/20 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      }
    >
      <Icon size={18} animate={active || hovered} />
      <span>{item.label}</span>
    </Link>
  );
}

function NavGroupSection({
  group,
  pathname,
  onNavigate,
}: {
  group: NavGroup;
  pathname: string;
  onNavigate?: () => void;
}) {
  const containsActive = group.items.some((item) => item.href === pathname);
  const [open, setOpen] = React.useState(true);
  const [lastPathname, setLastPathname] = React.useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    if (containsActive) setOpen(true);
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg px-3 py-1.75 text-[13px] font-semibold text-moss-bright outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
        {group.label}
        <span className={"transition-transform duration-300 " + (open ? "" : "-rotate-90")}>
          <ArrowDown01 size={16} animate={open} />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-0.5 space-y-0.5">
        {group.items.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={item.href === pathname}
            onNavigate={onNavigate}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function DashboardNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Dashboard" className="space-y-0.5">
      {TOP_LEVEL.map((item) => (
        <NavLink
          key={item.href}
          item={item}
          active={item.href === pathname}
          onNavigate={onNavigate}
        />
      ))}
      {GROUPS.map((group) => (
        <div key={group.label} className="pt-2">
          <NavGroupSection
            group={group}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        </div>
      ))}
    </nav>
  );
}
