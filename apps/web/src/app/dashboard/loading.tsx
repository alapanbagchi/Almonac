export default function DashboardLoading() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading the workspace">
      <div className="h-9 w-64 animate-pulse rounded-lg bg-bark-raised/40" />
      <div className="h-4 w-full max-w-xl animate-pulse rounded bg-bark-raised/30" />
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="h-40 animate-pulse rounded-xl border border-border bg-card" />
        <div className="h-40 animate-pulse rounded-xl border border-border bg-card" />
      </div>
      <span className="sr-only">Loading...</span>
    </div>
  );
}
