export const metadata = { title: "Organizations" };

// The session guard must resolve before this page renders.
export const instant = false;

export default function OrganizationsPage() {
  return (
    <div>
      <h1 className="font-display text-[2.05rem] leading-[1.15] font-medium tracking-[-0.02em] text-foreground">
        Organizations
      </h1>
      <p className="mt-3 text-[14.5px] leading-relaxed text-moss-bright">
        Manage the organizations in your workspace.
      </p>
      <div className="mt-8 rounded-xl border border-dashed border-border p-10 text-center text-sm text-moss-bright">
        Nothing here yet.
      </div>
    </div>
  );
}
