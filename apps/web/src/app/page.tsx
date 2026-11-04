import Link from "next/link";
import { connection } from "next/server";

import { ArrowRight02 } from "@/components/animate-ui/icons/hugeicons/arrow-right-02";
import { buttonVariants } from "@/components/ui/button";

// A nonce CSP needs request-time rendering: a static page is built before
// any request headers exist, so its scripts cannot carry a nonce.
export const instant = false;

export default async function Home() {
  // Blocking on the request is what produces per-request scripts with a nonce.
  await connection();

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-6 py-3 sm:px-10 lg:px-16">
          <Link href="/" aria-label="Almonac home" className="inline-flex items-center gap-3">
            <span aria-hidden="true" className="logo-mark block aspect-[1317/1194] w-8 shrink-0" />
            <span className="text-[15px] font-medium tracking-[0.02em] text-foreground">Almonac</span>
          </Link>

          <Link
            href="/login"
            className={buttonVariants({
              size: "lg",
              className: "group h-[52px] rounded-xl px-5 text-[15px] font-semibold",
            })}
          >
            Sign in
            <ArrowRight02
              size={16}
              className="transition-transform duration-300 ease-out group-hover:translate-x-1"
            />
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <h1 className="sr-only">Almonac</h1>
      </main>
    </div>
  );
}
