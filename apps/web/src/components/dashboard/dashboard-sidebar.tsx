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
import { DashboardNav } from "./dashboard-nav";
import { DEFAULT_HOSPITAL_ID, DEFAULT_HOSPITAL_LOGO, HOSPITALS, type Hospital } from "./hospital";
import { HospitalSwitcher } from "./hospital-switcher";
import { LogoTile } from "./logo-tile";
import { CURRENT_USER } from "./profile";

function HospitalBrand({
  hospital,
  tileSize,
  showSlogan,
}: {
  hospital: Hospital;
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

export function DashboardSidebar() {
  const [open, setOpen] = React.useState(false);
  const [hospitals, setHospitals] = React.useState<Hospital[]>(HOSPITALS);
  const [currentId, setCurrentId] = React.useState(DEFAULT_HOSPITAL_ID);
  const current = hospitals.find((hospital) => hospital.id === currentId) ?? hospitals[0];

  const addHospital = (name: string, type: string) => {
    const hospital: Hospital = {
      id: "hospital-" + Date.now(),
      name,
      type,
      logo: DEFAULT_HOSPITAL_LOGO,
    };
    setHospitals((prev) => [...prev, hospital]);
    setCurrentId(hospital.id);
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
            <div className="mt-4">
              <HospitalSwitcher
                hospitals={hospitals}
                currentId={current.id}
                onSelect={setCurrentId}
                onAdd={addHospital}
              />
            </div>
            <div className="mt-6">
              <DashboardNav onNavigate={() => setOpen(false)} />
            </div>
            <div className="mt-auto pt-4">
              <ProfileDropdown
                name={CURRENT_USER.name}
                designation={CURRENT_USER.designation}
                imageSrc={CURRENT_USER.avatar}
                onNavigate={() => setOpen(false)}
              />
            </div>
          </SheetContent>
        </Sheet>
        <HospitalBrand hospital={current} tileSize={32} showSlogan={false} />
      </header>
      <aside className="sticky top-0 hidden h-svh w-72 shrink-0 flex-col border-r border-border bg-ink-deep p-4 lg:flex">
        <HospitalBrand hospital={current} tileSize={44} showSlogan={true} />
        <div className="mt-4">
          <HospitalSwitcher
            hospitals={hospitals}
            currentId={current.id}
            onSelect={setCurrentId}
            onAdd={addHospital}
          />
        </div>
        <div className="mt-6">
          <DashboardNav />
        </div>
        <div className="mt-auto pt-4">
          <ProfileDropdown
            name={CURRENT_USER.name}
            designation={CURRENT_USER.designation}
            imageSrc={CURRENT_USER.avatar}
          />
        </div>
      </aside>
    </>
  );
}
