"use client";

import * as React from "react";
import Link from "next/link";

import { ArrowRight02 } from "@/components/animate-ui/icons/hugeicons/arrow-right-02";
import { AuthShell } from "@/components/auth/form-parts";
import { VerificationMark } from "@/components/auth/verification-mark";
import { FormError } from "@/components/form/form-error";
import { buttonVariants } from "@/components/ui/button";
import { submitCredentials } from "@/lib/auth/browser";

type State =
  | { status: "verifying" }
  | { status: "verified" }
  | { status: "error"; message: string };

const SUBTITLES: Record<State["status"], string> = {
  verifying: "This only takes a moment.",
  verified: "Your email is verified. Sign in to create your first organisation.",
  error: "We could not verify this link.",
};

/**
 * The verification token arrives in the fragment so it never reaches a server
 * log. The fragment is cleared before the token is posted to our BFF.
 */
export function VerifyEmail() {
  const [state, setState] = React.useState<State>({ status: "verifying" });
  const started = React.useRef(false);

  React.useEffect(() => {
    // Strict mode runs the effect twice; the first run consumes the token.
    if (started.current) return;
    started.current = true;

    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    window.history.replaceState(null, "", "/verify-email");
    if (token === null || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
      queueMicrotask(() =>
        setState({ status: "error", message: "This verification link is incomplete." }),
      );
      return;
    }

    submitCredentials("/api/auth/verify-email", { token })
      .then((result) => {
        if (result.status === "verified") {
          setState({ status: "verified" });
          return;
        }
        setState({
          status: "error",
          message: result.message ?? "The email could not be verified.",
        });
      })
      .catch(() =>
        setState({ status: "error", message: "The email could not be verified." }),
      );
  }, []);

  return (
    <AuthShell
      title="Verify your email"
      subtitle={SUBTITLES[state.status]}
      mark={
        <VerificationMark
          status={state.status}
          className={
            state.status === "error"
              ? "size-16 text-destructive"
              : "size-16 text-parchment"
          }
        />
      }
    >
      {state.status === "verifying" ? (
        <p role="status" className="text-[15px] text-moss-bright">
          Checking your verification link...
        </p>
      ) : state.status === "verified" ? (
        <Link
          href="/login?verified=1&returnTo=/onboarding/organisation"
          className={buttonVariants({
            size: "lg",
            className: "group h-[52px] w-full rounded-xl text-[15px] font-semibold",
          })}
        >
          Continue to sign in
          <ArrowRight02
            size={16}
            className="transition-transform duration-300 ease-out group-hover:translate-x-1"
          />
        </Link>
      ) : (
        <div className="flex flex-col gap-5">
          <FormError message={state.message} />
          <p className="text-sm text-moss-bright">
            <Link
              href="/signup"
              className="font-medium text-foreground underline underline-offset-4"
            >
              Create the account again
            </Link>{" "}
            if the link has expired.
          </p>
        </div>
      )}
    </AuthShell>
  );
}
