"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

import { ArrowDown01 } from "@/components/animate-ui/icons/hugeicons/arrow-down-01";
import { Check } from "@/components/animate-ui/icons/hugeicons/check";
import { Clock01 } from "@/components/animate-ui/icons/hugeicons/clock-01";
import { Logout01 } from "@/components/animate-ui/icons/hugeicons/logout-01";
import { Settings02 } from "@/components/animate-ui/icons/hugeicons/settings-02";

type ProfileIcon = React.ComponentType<{
  size?: number;
  className?: string;
  animate?: boolean;
}>;

const MENU_ITEMS: { href: string; label: string; icon: ProfileIcon }[] = [
  { href: "/dashboard/audit-log", label: "Activity log", icon: Clock01 },
  { href: "/dashboard/settings", label: "Settings", icon: Settings02 },
];

const rowClass =
  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm outline-none transition-all duration-200 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring/50";

export function ProfileDropdown({
  name,
  designation,
  imageSrc,
  onNavigate,
}: {
  name: string;
  designation: string;
  imageSrc: string;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = React.useState(false);

  const handleSignOut = () => {
    onNavigate?.();
    // TODO: replace with real sign-out when auth lands.
    router.push("/registration");
  };

  return (
    <div className="relative">
      <AnimatePresence>
        {isOpen ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-x-0 bottom-full mb-2 overflow-hidden rounded-xl border border-border bg-ink-raised shadow-lg"
          >
            <div className="space-y-0.5 p-2">
              {MENU_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={rowClass + " text-moss-bright hover:bg-bark-raised/60 hover:pl-4 hover:text-foreground"}
                >
                  <item.icon size={18} />
                  <span>{item.label}</span>
                </Link>
              ))}
              <button
                type="button"
                onClick={handleSignOut}
                className={rowClass + " w-full text-destructive hover:bg-destructive/10 hover:pl-4"}
              >
                <Logout01 size={18} />
                <span>Sign out</span>
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <button
        type="button"
        data-slot="profile-chip"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-3 rounded-xl border border-border bg-ink-raised p-3 text-left outline-none transition-colors hover:bg-bark-raised/40 focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="size-10 shrink-0 overflow-hidden rounded-full bg-bark-raised">
          <Image
            src={imageSrc}
            alt={name}
            width={40}
            height={40}
            className="size-10 rounded-full object-cover"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-foreground">{name}</span>
            <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-parchment">
              <Check size={10} className="text-ink" />
            </span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-moss-bright">{designation}</span>
        </span>
        <ArrowDown01
          size={16}
          className={"shrink-0 text-moss-bright transition-transform duration-300 " + (isOpen ? "rotate-180" : "")}
        />
      </button>
    </div>
  );
}
