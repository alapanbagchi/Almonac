"use client";

import * as React from "react";
import { LoaderCircle } from "lucide-react";
import { z } from "zod";

import { ArrowRight02 } from "@/components/animate-ui/icons/hugeicons/arrow-right-02";
import { SubmitButton } from "@/components/form/submit-button";
import { cn } from "@/lib/utils";

const requiredText = (message: string) => z.string().trim().min(1, message);

/**
 * The single definition of a strong password: the meter checklist renders
 * these rules and the schema below enforces them, so the two can never drift.
 */
export const PASSWORD_RULES = [
  { label: "At least 8 characters", test: (value: string) => value.length >= 8 },
  { label: "One lowercase letter", test: (value: string) => /[a-z]/.test(value) },
  { label: "One uppercase letter", test: (value: string) => /[A-Z]/.test(value) },
  { label: "One number", test: (value: string) => /[0-9]/.test(value) },
  { label: "One symbol", test: (value: string) => /[^A-Za-z0-9]/.test(value) },
];

export const passwordSchema = z
  .string()
  .min(1, "Create a password")
  .superRefine((value, ctx) => {
    for (const rule of PASSWORD_RULES) {
      if (!rule.test(value)) ctx.addIssue({ code: "custom", message: rule.label });
    }
  });

export const signUpSchema = z.object({
  fullName: requiredText("Enter your full name"),
  email: requiredText("Enter your work email").email("Enter a valid email address"),
  password: passwordSchema,
});

export const signInSchema = z.object({
  email: requiredText("Enter your work email").email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export const leadingInputClass =
  "rounded-xl border-border bg-ink-raised pr-3.5 pl-11 text-[15px] leading-5";

export function LeadingInput({
  icon,
  invalid = false,
  children,
}: {
  icon: React.ReactElement<{ animate?: boolean | string }>;
  invalid?: boolean;
  children: React.ReactNode;
}) {
  const [active, setActive] = React.useState(false);
  return (
    <div
      className="relative"
      onFocus={() => setActive(true)}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setActive(false);
      }}
    >
      <span
        className={cn(
          "pointer-events-none absolute top-0 left-0 z-10 flex h-11 w-11 items-center justify-center transition-all duration-300",
          invalid ? "text-destructive" : active ? "text-foreground" : "text-moss-bright",
          active && "scale-110",
        )}
      >
        {React.cloneElement(icon, { animate: active })}
      </span>
      {children}
    </div>
  );
}

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden bg-background">
      <main className="relative z-10 mx-auto flex w-full max-w-[460px] flex-1 flex-col justify-center px-6 py-14 sm:py-16">
        <span
          role="img"
          aria-label="Almonac"
          className="logo-mark block aspect-[1317/1194] w-[64px] shrink-0"
        />

        <div className="step-in mt-10 flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <h1 className="font-display text-left text-[1.8rem] leading-[1.12] font-medium tracking-[-0.02em] text-balance text-foreground sm:text-[2.05rem]">
              {title}
            </h1>
            <p className="text-[15px] leading-relaxed text-moss-bright">{subtitle}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

export function SubmitAction({
  pending,
  label,
  pendingLabel,
  disabled = false,
}: {
  pending: boolean;
  label: string;
  pendingLabel: string;
  disabled?: boolean;
}) {
  return (
    <SubmitButton
      size="lg"
      disabled={pending || disabled}
      aria-busy={pending}
      className="group h-[52px] w-full rounded-xl text-[15px] font-semibold"
    >
      {pending ? (
        <>
          <span className="sr-only">{pendingLabel}</span>
          <LoaderCircle size={18} aria-hidden="true" className="animate-spin" />
        </>
      ) : (
        <>
          {label}
          <ArrowRight02
            size={16}
            className="transition-transform duration-300 ease-out group-hover:translate-x-1"
          />
        </>
      )}
    </SubmitButton>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p
      role="alert"
      className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      {message}
    </p>
  );
}
