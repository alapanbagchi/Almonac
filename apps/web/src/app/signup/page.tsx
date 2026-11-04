import type { Metadata } from "next";
import { connection } from "next/server";

import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = {
  title: "Sign up",
  description: "Create an Almonac account.",
};

// The sign-up screen must render per request so its scripts carry the CSP
// nonce. See src/proxy.ts.
export const instant = false;

export default async function SignUpPage() {
  // Blocking on the request is what produces per-request scripts with a nonce.
  await connection();
  return <SignUpForm />;
}
