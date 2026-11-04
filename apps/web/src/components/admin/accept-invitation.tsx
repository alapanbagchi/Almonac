"use client";

import * as React from "react";
import Link from "next/link";

import { adminRequest } from "@/lib/admin/client";

type State =
  | { status: "accepting" }
  | { status: "accepted" }
  | { status: "error"; message: string };

export function AcceptInvitation() {
  const [state, setState] = React.useState<State>({ status: "accepting" });

  React.useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    window.history.replaceState(null, "", "/invitations/accept");
    if (token === null || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
      queueMicrotask(() =>
        setState({ status: "error", message: "This invitation link is incomplete." }),
      );
      return;
    }

    adminRequest("invitations/accept", "POST", { token })
      .then(() => setState({ status: "accepted" }))
      .catch((error: unknown) => {
        const code = error instanceof Error ? error.message : "ADMIN_FAILED";
        setState({
          status: "error",
          message:
            code === "CONFLICT"
              ? "This invitation has expired or was already used. Ask an administrator to resend it."
              : code === "FORBIDDEN"
                ? "This invitation was issued to a different account."
                : "The invitation could not be accepted.",
        });
      });
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-16">
      <div className="rounded-2xl border border-border bg-card p-8">
        <h1 className="font-display text-2xl font-medium tracking-[-0.02em]">
          Accept invitation
        </h1>
        {state.status === "accepting" ? (
          <p className="mt-3 text-sm text-moss-bright" role="status">
            Checking your invitation...
          </p>
        ) : state.status === "accepted" ? (
          <>
            <p className="mt-3 text-sm text-moss-bright" role="status">
              You now have access. The invitation is recorded in the audit log.
            </p>
            <Link
              className="mt-6 inline-flex rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
              href="/dashboard"
            >
              Open the dashboard
            </Link>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm text-destructive" role="alert">
              {state.message}
            </p>
            <Link
              className="mt-6 inline-flex rounded-lg border border-border px-3 py-2 text-sm"
              href="/dashboard"
            >
              Return to the dashboard
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
