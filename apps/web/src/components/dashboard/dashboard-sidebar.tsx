"use client";

import * as React from "react";

import { Menu01 } from "@/components/animate-ui/icons/hugeicons/menu-01";
import { ProfileDropdown } from "@/components/spectrumui/profiledropdown";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { HOSPITAL_LOGO, type SessionHospital, type SessionUser } from "@/lib/auth/session-view";

import { DashboardNav } from "./dashboard-nav";
import { HospitalSwitcher } from "./hospital-switcher";
import { LogoTile } from "./logo-tile";

function HospitalBrand({
  hospital,
  tileSize,
  showSlogan,
}: {
  hospital: SessionHospital;
  tileSize: number;
  showSlogan: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <LogoTile src={hospital.logo} alt={hospital.name + " logo"} size={tileSize} />
      <span className="min-w-0">
        <span className="block truncate text-[15px] leading-snug font-semibold text-foreground">
          {hospital.name}
        </span>
        {showSlogan ? (
          <span className="mt-0.5 block truncate text-[13px] leading-snug text-moss-bright">
            {hospital.type}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function DashboardSidebar({
  hospitals,
  user,
}: {
  hospitals: SessionHospital[];
  user: SessionUser;
}) {
  const [open, setOpen] = React.useState(false);
  const [currentId, setCurrentId] = React.useState(hospitals[0]?.id ?? "");
  const selected = hospitals.find((hospital) => hospital.id === currentId) ?? hospitals[0];
  const current: SessionHospital = selected ?? {
    id: "workspace",
    name: "Almonac",
    type: "No hospital access",
    logo: HOSPITAL_LOGO,
  };

  return (
    <>
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4 lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <button
                type="button"
                aria-label="Open navigation"
                className="rounded-lg p-2 text-moss-bright outline-none transition-colors hover:bg-bark/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            }
          >
            <Menu01 size={20} />
          </SheetTrigger>
          <SheetContent side="left" className="gap-0 border-border bg-ink-deep p-4">
            <SheetTitle className="sr-only">Dashboard navigation</SheetTitle>
            <div className="pr-10">
              <HospitalBrand hospital={current} tileSize={44} showSlogan={true} />
            </div>
            {hospitals.length > 0 ? (
              <div className="mt-4">
                <HospitalSwitcher
                  hospitals={hospitals}
                  currentId={current.id}
                  onSelect={setCurrentId}
                />
              </div>
            ) : null}
            <div className="mt-6">
              <DashboardNav onNavigate={() => setOpen(false)} />
            </div>
            <div className="mt-auto pt-4">
              <ProfileDropdown
                name={user.name}
                designation={user.designation}
                imageSrc={user.avatar}
                onNavigate={() => setOpen(false)}
              />
            </div>
          </SheetContent>
        </Sheet>
        <HospitalBrand hospital={current} tileSize={32} showSlogan={false} />
      </header>
      <aside className="sticky top-0 hidden h-svh w-72 shrink-0 flex-col border-r border-border bg-ink-deep p-4 lg:flex">
        <HospitalBrand hospital={current} tileSize={44} showSlogan={true} />
        {hospitals.length > 0 ? (
          <div className="mt-4">
            <HospitalSwitcher
              hospitals={hospitals}
              currentId={current.id}
              onSelect={setCurrentId}
            />
          </div>
        ) : null}
        <div className="mt-6">
          <DashboardNav />
        </div>
        <div className="mt-auto pt-4">
          <ProfileDropdown
            name={user.name}
            designation={user.designation}
            imageSrc={user.avatar}
          />
        </div>
      </aside>
    </>
  );
}
