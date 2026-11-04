"use client";

import * as React from "react";
import Link from "next/link";
import { useForm } from "@tanstack/react-form";

import { Key01 } from "@/components/animate-ui/icons/hugeicons/key-01";
import { Mail01 } from "@/components/animate-ui/icons/hugeicons/mail-01";
import {
  AuthShell,
  FormError,
  LeadingInput,
  SubmitAction,
  leadingInputClass,
  signInSchema,
} from "@/components/auth/form-parts";
import { ValidatedField } from "@/components/form/validated-field";
import { Input } from "@/components/ui/input";
import { submitCredentials } from "@/lib/auth/browser";

export function SignInForm({
  returnTo,
  message,
  verified = false,
}: {
  returnTo: string;
  message: string | null;
  verified?: boolean;
}) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(message);

  const form = useForm({
    defaultValues: { email: "", password: "" },
    canSubmitWhenInvalid: true,
    onSubmit: async ({ value }) => {
      setPending(true);
      setError(null);
      // Keep a fragment such as an invitation token from the sign-in page.
      const target = `${returnTo}${window.location.hash}`;
      const result = await submitCredentials("/api/auth/password", { ...value, returnTo: target });
      if (result.redirectUrl !== undefined) {
        window.location.assign(result.redirectUrl);
        return;
      }
      setError(result.message ?? "The email or password is not correct.");
      setPending(false);
    },
  });

  const ssoHref = `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <AuthShell
      title="Sign in to Almonac"
      subtitle="Use the email and password for your account."
    >
      <form
        noValidate
        className="flex flex-col gap-8"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div className="flex flex-col gap-5">
          <ValidatedField
            form={form}
            name="email"
            label="Work email"
            schema={signInSchema.shape.email}
            id="work-email"
          >
            {({ input, invalid }) => (
              <LeadingInput icon={<Mail01 size={18} />} invalid={invalid}>
                <Input
                  {...input}
                  type="email"
                  autoComplete="email"
                  placeholder="name@hospital.com"
                  className={leadingInputClass}
                />
              </LeadingInput>
            )}
          </ValidatedField>

          <ValidatedField
            form={form}
            name="password"
            label="Password"
            schema={signInSchema.shape.password}
            id="password"
          >
            {({ input, invalid }) => (
              <LeadingInput icon={<Key01 size={18} />} invalid={invalid}>
                <Input
                  {...input}
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className={leadingInputClass}
                />
              </LeadingInput>
            )}
          </ValidatedField>
        </div>

        {verified && error === null ? (
          <p
            role="status"
            className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-foreground"
          >
            Your email is verified. Sign in to continue.
          </p>
        ) : null}

        <FormError message={error} />

        <SubmitAction pending={pending} label="Sign in" pendingLabel="Signing in" />

        <div className="flex flex-col gap-3 text-sm text-moss-bright">
          <p>
            New to Almonac?{" "}
            <Link href="/signup" className="font-medium text-foreground underline underline-offset-4">
              Create an account
            </Link>
          </p>
          <p>
            Use a passkey, multi-factor device or hospital single sign-on?{" "}
            <a href={ssoHref} className="font-medium text-foreground underline underline-offset-4">
              Continue with single sign-on
            </a>
          </p>
        </div>
      </form>
    </AuthShell>
  );
}
