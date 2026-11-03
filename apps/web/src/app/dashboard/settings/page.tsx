export const metadata = { title: "Settings" };

// The session guard must resolve before this page renders.
export const instant = false;

export default function SettingsPage() {
  return (
    <div>
      <h1 className="font-display text-[2.05rem] leading-[1.15] font-medium tracking-[-0.02em] text-foreground">
        Settings
      </h1>
      <p className="mt-3 text-[14.5px] leading-relaxed text-moss-bright">
        Workspace preferences and configuration.
      </p>
      <div className="mt-8 rounded-xl border border-dashed border-border p-10 text-center text-sm text-moss-bright">
        Nothing here yet.
      </div>
    </div>
  );
}
