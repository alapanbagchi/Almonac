"use client";

import * as React from "react";
import Link from "next/link";
import { useForm } from "@tanstack/react-form";

import { Key01 } from "@/components/animate-ui/icons/hugeicons/key-01";
import { UserRound } from "@/components/animate-ui/icons/hugeicons/user-round";
import {
  AuthShell,
  LeadingInput,
  PASSWORD_RULES,
  SubmitAction,
  leadingInputClass,
  signUpSchema,
} from "@/components/auth/form-parts";
import { FormError } from "@/components/form/form-error";
import { ValidatedField, updateFieldValue } from "@/components/form/validated-field";
import { useShake } from "@/components/motion/use-shake";
import { PasswordStrengthInput } from "@/components/spectrumui/password-strength";
import { Input } from "@/components/ui/input";
import { submitCredentials } from "@/lib/auth/browser";

type TokenState = { status: "reading" } | { status: "invalid" } | { status: "ready"; token: string };

/**
 * Creates the account an invitation was sent to. The token arrives in the URL
 * fragment, so it never reaches a server log, and is cleared before the form
 * is shown.
 */
export function ClaimInvitation() {
  const [tokenState, setTokenState] = React.useState<TokenState>({ status: "reading" });
  const started = React.useRef(false);
  const { ref: formRef, shake } = useShake<HTMLFormElement>();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Strict mode runs the effect twice; the first run consumes the token.
    if (started.current) return;
    started.current = true;

    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    window.history.replaceState(null, "", "/invitations/accept");
    // Defer: the token is external to React and the read must not cascade a render.
    queueMicrotask(() =>
      setTokenState(
        token !== null && /^[A-Za-z0-9_-]{32,128}$/.test(token)
          ? { status: "ready", token }
          : { status: "invalid" },
      ),
    );
  }, []);

  const form = useForm({
    defaultValues: { fullName: "", password: "" },
    canSubmitWhenInvalid: true,
    onSubmit: async ({ value }) => {
      if (tokenState.status !== "ready") return;
      setPending(true);
      setError(null);
      const result = await submitCredentials("/api/auth/invitation-registration", {
        ...value,
        token: tokenState.token,
        returnTo: "/dashboard",
      });
      if (result.redirectUrl !== undefined) {
        window.location.assign(result.redirectUrl);
        return;
      }
      setError(result.message ?? "The account could not be created.");
      shake();
      setPending(false);
    },
  });

  if (tokenState.status === "invalid") {
    return (
      <AuthShell title="Accept invitation" subtitle="This invitation link is incomplete.">
        <p className="text-sm text-moss-bright">
          Ask an administrator to send the invitation again, or{" "}
          <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
            sign in
          </Link>{" "}
          if you already have an account.
        </p>
      </AuthShell>
    );
  }

  if (tokenState.status === "reading") {
    return (
      <AuthShell title="Accept invitation" subtitle="Checking your invitation link.">
        <p className="text-sm text-moss-bright" role="status">
          One moment...
        </p>
      </AuthShell>
    );
  }

  const signInHref = `/login?returnTo=/invitations/accept#token=${tokenState.token}`;

  return (
    <AuthShell
      title="Accept your invitation"
      subtitle="Choose your name and a password to create your account."
    >
      <form
        ref={formRef}
        noValidate
        className="flex flex-col gap-8"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div className="flex flex-col gap-5">
          <FormError message={error} />
          <ValidatedField
            form={form}
            name="fullName"
            label="Full name"
            schema={signUpSchema.shape.fullName}
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
            name="password"
            label="Password"
            schema={signUpSchema.shape.password}
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

        <SubmitAction
          pending={pending}
          label="Create account"
          pendingLabel="Creating account"
        />

        <p className="text-sm text-moss-bright">
          Already have an account?{" "}
          <Link href={signInHref} className="font-medium text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
