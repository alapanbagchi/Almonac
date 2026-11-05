import Link from "next/link";

import type { Organisation } from "@/lib/admin/model";

/** Switch the screen between the organisations this account can see. */
export function OrganisationPicker({
  organisations,
  selectedId,
  basePath,
}: {
  organisations: Organisation[];
  selectedId: string | null;
  basePath: string;
}) {
  if (organisations.length <= 1) return null;

  return (
    <nav aria-label="Organisation" className="mt-6 flex flex-wrap gap-2">
      {organisations.map((organisation) => (
        <Link
          key={organisation.id}
          href={`${basePath}?organisation=${organisation.id}`}
          aria-current={organisation.id === selectedId ? "page" : undefined}
          className={
            organisation.id === selectedId
              ? "rounded-full bg-bark-raised/40 px-3 py-1 text-sm text-foreground"
              : "rounded-full border border-border px-3 py-1 text-sm text-moss-bright hover:text-foreground"
          }
        >
          {organisation.name}
        </Link>
      ))}
    </nav>
  );
}
