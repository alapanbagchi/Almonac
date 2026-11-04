import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { AuthShell } from "@/components/auth/form-parts";

export const metadata: Metadata = {
  title: "Check your email",
  description: "Confirm the verification link for your new Almonac account.",
};

// The screen must render per request so its scripts carry the CSP nonce.
export const instant = false;

export default async function CheckEmailPage() {
  // Blocking on the request is what produces per-request scripts with a nonce.
  await connection();
  return (
    <AuthShell
      title="Check your email"
      subtitle="We sent a verification link to your work email. Open the link to finish creating your account."
    >
      <div className="flex flex-col gap-5 text-sm text-moss-bright">
        <p role="status">
          The link is valid for 30 minutes. If it does not arrive, check the spam folder or
          create the account again with the same address.
        </p>
        <p>
          Already verified?{" "}
          <Link
            href="/login?verified=1"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
