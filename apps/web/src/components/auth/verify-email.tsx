"use client";

import * as React from "react";
import Link from "next/link";

import { submitCredentials } from "@/lib/auth/browser";

type State =
  | { status: "verifying" }
  | { status: "verified" }
  | { status: "error"; message: string };

/**
 * The verification token arrives in the fragment so it never reaches a server
 * log. The fragment is cleared before the token is posted to our BFF.
 */
export function VerifyEmail() {
  const [state, setState] = React.useState<State>({ status: "verifying" });

  React.useEffect(() => {
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
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-16">
      <div className="rounded-2xl border border-border bg-card p-8">
        <h1 className="font-display text-2xl font-medium tracking-[-0.02em]">
          Verify your email
        </h1>
        {state.status === "verifying" ? (
          <p className="mt-3 text-sm text-moss-bright" role="status">
            Checking your verification link...
          </p>
        ) : state.status === "verified" ? (
          <>
            <p className="mt-3 text-sm text-moss-bright" role="status">
              Your email is verified. Sign in to create your first organisation.
            </p>
            <Link
              className="mt-6 inline-flex rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
              href="/login?verified=1&returnTo=/onboarding/organisation"
            >
              Continue to sign in
            </Link>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm text-destructive" role="alert">
              {state.message}
            </p>
            <Link
              className="mt-6 inline-flex rounded-lg border border-border px-3 py-2 text-sm"
              href="/signup"
            >
              Create the account again
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
