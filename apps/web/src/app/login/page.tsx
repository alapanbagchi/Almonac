import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ArrowRight02 } from "@/components/animate-ui/icons/hugeicons/arrow-right-02";
import { Button } from "@/components/ui/button";
import { loginErrorMessage } from "@/lib/auth/login-error";
import { normaliseReturnTo } from "@/lib/auth/return-to";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Almonac.",
};

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default function LoginPage({ searchParams }: LoginPageProps) {
  return (
    <Suspense fallback={<LoginPanel />}>
      <LoginContent searchParams={searchParams} />
    </Suspense>
  );
}

async function LoginContent({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  return (
    <LoginPanel
      message={loginErrorMessage(params.error)}
      loginHref={loginHref(params.returnTo)}
    />
  );
}

function LoginPanel({ message = null, loginHref = "/api/auth/login" }: {
  message?: string | null;
  loginHref?: string;
}) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl items-center px-6 py-3 sm:px-10 lg:px-16">
          <Link href="/" aria-label="Almonac home" className="inline-flex items-center gap-3">
            <span aria-hidden="true" className="logo-mark block aspect-[1317/1194] w-8 shrink-0" />
            <span className="text-[15px] font-medium tracking-[0.02em] text-foreground">
              Almonac
            </span>
          </Link>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="step-in w-full max-w-[440px]">
          <div className="flex flex-col items-center text-center">
            <span
              aria-hidden="true"
              className="logo-mark block aspect-[1317/1194] w-16 shrink-0"
            />
            <p className="mt-8 text-[12px] font-medium tracking-[0.18em] text-moss-bright uppercase">
              Secure access
            </p>
            <h1 className="mt-3 font-display text-[2.05rem] leading-[1.15] font-medium text-parchment">
              Sign in to Almonac
            </h1>
            <p className="mt-3 max-w-[34ch] text-[15px] leading-relaxed text-moss-bright">
              Use the email address your hospital invited. You will continue to the identity
              service to enter your password.
            </p>
          </div>

          {message === null ? null : (
            <p
              role="alert"
              className="mt-7 rounded-xl border border-clay/40 bg-clay/10 px-4 py-3 text-center text-[14px] leading-relaxed text-parchment"
            >
              {message}
            </p>
          )}

          <div className="mt-8 rounded-2xl border border-bark bg-ink-raised p-6 sm:p-8">
            <Button
              render={<a href={loginHref} />}
              className="group h-[52px] w-full rounded-xl text-[15px] font-semibold"
            >
              Continue to sign in
              <ArrowRight02
                size={16}
                className="transition-transform duration-300 ease-out group-hover:translate-x-1"
              />
            </Button>
            <p className="mt-4 text-center text-[12px] leading-relaxed text-moss">
              Almonac never sees your password. Your hospital identity service verifies it.
            </p>
          </div>

          <p className="mt-6 text-center text-[13px] leading-relaxed text-moss-bright">
            Access is by invitation. Contact your hospital administrator if you need an account.
          </p>
        </div>
      </main>
    </div>
  );
}

function loginHref(returnTo: unknown): string {
  const target = safeReturnTo(returnTo);
  return `/api/auth/login?returnTo=${encodeURIComponent(target)}`;
}

function safeReturnTo(value: unknown): string {
  try {
    return normaliseReturnTo(value, "/dashboard");
  } catch {
    return "/dashboard";
  }
}
