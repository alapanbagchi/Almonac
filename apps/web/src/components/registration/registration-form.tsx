"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { LoaderCircle } from "lucide-react";

import { ArrowRight02 } from "@/components/animate-ui/icons/hugeicons/arrow-right-02";
import { Key01 } from "@/components/animate-ui/icons/hugeicons/key-01";
import { Mail01 } from "@/components/animate-ui/icons/hugeicons/mail-01";
import { UserRound } from "@/components/animate-ui/icons/hugeicons/user-round";
import { ValidatedField, updateFieldValue } from "@/components/form/validated-field";
import {
  PasswordStrengthInput,
  type PasswordRule,
} from "@/components/spectrumui/password-strength";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const requiredText = (message: string) => z.string().trim().min(1, message);

/**
 * The single definition of a strong password: the meter checklist renders
 * these rules and the schema below enforces them, so the two can never drift.
 */
export const PASSWORD_RULES: PasswordRule[] = [
  { label: "At least 8 characters", test: (value) => value.length >= 8 },
  { label: "One lowercase letter", test: (value) => /[a-z]/.test(value) },
  { label: "One uppercase letter", test: (value) => /[A-Z]/.test(value) },
  { label: "One number", test: (value) => /[0-9]/.test(value) },
  { label: "One symbol", test: (value) => /[^A-Za-z0-9]/.test(value) },
];

export const passwordSchema = z
  .string()
  .min(1, "Create a password")
  .superRefine((value, ctx) => {
    for (const rule of PASSWORD_RULES) {
      if (!rule.test(value))
        ctx.addIssue({ code: "custom", message: rule.label });
    }
  });

export const accountSchema = z.object({
  fullName: requiredText("Enter your full name"),
  email: requiredText("Enter your work email").email("Enter a valid email address"),
  password: passwordSchema,
});

const leadingInputClass =
  "rounded-xl border-border bg-ink-raised pr-3.5 pl-11 text-[15px] leading-5";

function LeadingIcon({
  active = false,
  invalid = false,
  children,
}: {
  active?: boolean;
  invalid?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute top-0 left-0 z-10 flex h-11 w-11 items-center justify-center transition-all duration-300",
        invalid ? "text-destructive" : active ? "text-foreground" : "text-moss-bright",
        active && "scale-110",
      )}
    >
      {children}
    </span>
  );
}

function LeadingInput({
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
      <LeadingIcon active={active} invalid={invalid}>{React.cloneElement(icon, { animate: active })}</LeadingIcon>
      {children}
    </div>
  );
}

export function RegistrationForm() {
  const router = useRouter();
  const [isLoading, setIsLoading] = React.useState(false);
  const form = useForm({
    defaultValues: { fullName: "", email: "", password: "" },
    // Always run full submit validation: without this, TanStack skips
    // validateAllFields on attempt #1 when a coinciding blur already
    // invalidated the form, so only the blurred field shows an error.
    canSubmitWhenInvalid: true,
    onSubmit: async () => {
      setIsLoading(true);
      // TODO: replace the simulated latency with the real registration API call.
      await new Promise((resolve) => setTimeout(resolve, 900));
      router.push("/dashboard");
    },
  });

  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden bg-background">
      <main className="relative z-10 mx-auto flex w-full max-w-[460px] flex-1 flex-col justify-center px-6 py-14 sm:py-16">
        <span
          role="img"
          aria-label="Almonac"
          className="logo-mark block aspect-[1317/1194] w-[64px] shrink-0"
        />

        <div className="step-in mt-10">
          <form
            noValidate
            className="flex flex-col gap-8"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <h1 className="font-display text-left text-[1.8rem] leading-[1.12] font-medium tracking-[-0.02em] text-balance text-foreground sm:text-[2.05rem]">
              Create your admin account
            </h1>

            <div className="flex flex-col gap-5">
              <ValidatedField
                form={form}
                name="fullName"
                label="Full name"
                schema={accountSchema.shape.fullName}
                id="full-name"
              >
                {({ input, invalid }) => (
                  <LeadingInput icon={<UserRound size={18} />} invalid={invalid}>
                    <Input
                      {...input}
                      autoComplete="name"
                      placeholder="Enter your full name"
                      className={leadingInputClass}
                    />
                  </LeadingInput>
                )}
              </ValidatedField>

              <ValidatedField
                form={form}
                name="email"
                label="Work email"
                schema={accountSchema.shape.email}
                id="work-email"
              >
                {({ input, invalid }) => (
                  <LeadingInput icon={<Mail01 size={18} />} invalid={invalid}>
                    <Input
                      {...input}
                      type="email"
                      autoComplete="email"
                      placeholder="name@company.com"
                      className={leadingInputClass}
                    />
                  </LeadingInput>
                )}
              </ValidatedField>

              <ValidatedField
                form={form}
                name="password"
                label="Password"
                schema={accountSchema.shape.password}
                id="password"
              >
                {({ field, input, invalid }) => (
                  <LeadingInput icon={<Key01 size={18} />} invalid={invalid}>
                    <PasswordStrengthInput
                      id={input.id}
                      name={input.name}
                      value={String(field.state.value ?? "")}
                      onValueChange={(next) => updateFieldValue(field, next)}
                      onBlur={input.onBlur}
                      placeholder="Create a strong password"
                      autoComplete="new-password"
                      rules={PASSWORD_RULES}
                      invalid={invalid}
                      describedBy={input["aria-describedby"]}
                      inputClassName="pl-11"
                    />
                  </LeadingInput>
                )}
              </ValidatedField>
            </div>

            <Button
              type="submit"
              size="lg"
              disabled={isLoading}
              aria-busy={isLoading}
              className="group h-[52px] w-full rounded-xl text-[15px] font-semibold"
            >
              {isLoading ? (
                <>
                  <span className="sr-only">Creating account</span>
                  <LoaderCircle size={18} aria-hidden="true" className="animate-spin" />
                </>
              ) : (
                <>
                  Create account
                  <ArrowRight02 size={16} className="transition-transform duration-300 ease-out group-hover:translate-x-1" />
                </>
              )}
            </Button>

            <div className="flex items-center gap-4">
              <span aria-hidden="true" className="h-px flex-1 bg-border" />
              <p className="text-sm whitespace-nowrap text-moss-bright">
                Already have an account?{" "}
                <a href="#" className="font-medium text-foreground underline underline-offset-4">
                  Sign in
                </a>
              </p>
              <span aria-hidden="true" className="h-px flex-1 bg-border" />
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
