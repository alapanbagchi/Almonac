import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { AuthShell } from "@/components/auth/form-parts";
import { SignInForm } from "@/components/auth/sign-in-form";
import { loginErrorMessage } from "@/lib/auth/login-error";
import { normaliseReturnTo } from "@/lib/auth/return-to";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Almonac.",
};

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// The sign-in screen must render per request so its scripts carry the CSP
// nonce. See src/proxy.ts.
export const instant = false;

export default async function LoginPage({ searchParams }: LoginPageProps) {
  // Blocking on the request is what produces per-request scripts with a nonce.
  await connection();

  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginContent searchParams={searchParams} />
    </Suspense>
  );
}

async function LoginContent({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo);
  return (
    <SignInForm
      returnTo={returnTo}
      message={loginErrorMessage(params.error)}
      verified={params.verified === "1"}
    />
  );
}

function LoginFallback() {
  return (
    <AuthShell
      title="Sign in to Almonac"
      subtitle="Use the email and password for your account."
    >
      <p role="status" className="text-sm text-moss-bright">
        Loading the sign-in form.
      </p>
    </AuthShell>
  );
}

function safeReturnTo(value: string | string[] | undefined): string {
  try {
    return normaliseReturnTo(typeof value === "string" ? value : undefined, "/dashboard");
  } catch {
    return "/dashboard";
  }
}
