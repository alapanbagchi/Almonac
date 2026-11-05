"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "@tanstack/react-form";

import { Key01 } from "@/components/animate-ui/icons/hugeicons/key-01";
import { Mail01 } from "@/components/animate-ui/icons/hugeicons/mail-01";
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

export function SignUpForm() {
  const router = useRouter();
  const { ref: formRef, shake } = useShake<HTMLFormElement>();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const form = useForm({
    defaultValues: { fullName: "", email: "", password: "" },
    // Always run full submit validation: without this, TanStack skips
    // validateAllFields on attempt #1 when a coinciding blur already
    // invalidated the form, so only the blurred field shows an error.
    canSubmitWhenInvalid: true,
    onSubmit: async ({ value }) => {
      setPending(true);
      setError(null);
      const result = await submitCredentials("/api/auth/signup", value);
      if (result.status === "verification_sent") {
        router.push("/signup/check-email");
        return;
      }
      setError(result.message ?? "The account could not be created.");
      shake();
      setPending(false);
    },
  });

  return (
    <AuthShell
      title="Create your account"
      subtitle="Start with your work email. We will send a verification link before you create your first organisation."
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
            name="email"
            label="Work email"
            schema={signUpSchema.shape.email}
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
          <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
