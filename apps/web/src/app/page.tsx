import Link from "next/link";

import { ArrowRight02 } from "@/components/animate-ui/icons/hugeicons/arrow-right-02";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-6 py-3 sm:px-10 lg:px-16">
          <Link href="/" aria-label="Almonac home" className="inline-flex items-center gap-3">
            <span aria-hidden="true" className="logo-mark block aspect-[1317/1194] w-8 shrink-0" />
            <span className="text-[15px] font-medium tracking-[0.02em] text-foreground">Almonac</span>
          </Link>

          <Button
            render={<Link href="/login" />}
            size="lg"
            className="group h-[52px] rounded-xl px-5 text-[15px] font-semibold"
          >
            Sign in
            <ArrowRight02
              size={16}
              className="transition-transform duration-300 ease-out group-hover:translate-x-1"
            />
          </Button>
        </div>
      </header>

      <main className="flex-1">
        <h1 className="sr-only">Almonac</h1>
      </main>
    </div>
  );
}
