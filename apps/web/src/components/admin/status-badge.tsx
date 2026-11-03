import { cn } from "@/lib/utils";

const TONES: Record<string, string> = {
  active: "border-moss/50 bg-moss/15 text-foreground",
  pending: "border-bark bg-bark-raised/40 text-moss-bright",
  suspended: "border-clay/50 bg-clay/15 text-foreground",
  revoked: "border-clay/70 bg-clay/20 text-foreground",
  closed: "border-clay/70 bg-clay/20 text-foreground",
  archived: "border-border bg-muted text-moss-bright",
  expired: "border-border bg-muted text-moss-bright",
  success: "border-moss/50 bg-moss/15 text-foreground",
  failure: "border-clay/50 bg-clay/15 text-foreground",
  denied: "border-clay/70 bg-clay/20 text-foreground",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
        TONES[status] ?? "border-border bg-muted text-moss-bright",
      )}
    >
      {status}
    </span>
  );
}
