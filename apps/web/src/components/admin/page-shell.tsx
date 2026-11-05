import type { ReactNode } from "react";

/** The heading every admin screen shares. */
export function AdminPageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <>
      <h1 className="font-display text-[2.05rem] leading-[1.15] font-medium tracking-[-0.02em] text-foreground">
        {title}
      </h1>
      <p className="mt-3 text-[14.5px] leading-relaxed text-moss-bright">{description}</p>
    </>
  );
}

export function AdminEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-moss-bright">
      {children}
    </div>
  );
}
