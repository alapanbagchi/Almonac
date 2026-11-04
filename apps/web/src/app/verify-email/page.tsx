import type { Metadata } from "next";
import { connection } from "next/server";

import { VerifyEmail } from "@/components/auth/verify-email";

export const metadata: Metadata = {
  title: "Verify email",
  description: "Confirm the email address for your Almonac account.",
};

// The screen must render per request so its scripts carry the CSP nonce.
export const instant = false;

export default async function VerifyEmailPage() {
  // Blocking on the request is what produces per-request scripts with a nonce.
  await connection();
  return <VerifyEmail />;
}
