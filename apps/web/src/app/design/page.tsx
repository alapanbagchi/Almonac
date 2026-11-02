import type { ReactNode } from 'react';
import { Mail01 } from '@/components/animate-ui/icons/hugeicons/mail-01';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const palette = [
  { name: 'Onyx', token: 'ink', hex: '#1E201E', use: 'Main background', dark: true },
  { name: 'Bark', token: 'bark', hex: '#3C3D37', use: 'Cards, popovers and subtle borders', dark: true },
  { name: 'Moss', token: 'moss', hex: '#697565', use: 'Muted accents, secondary text and icons', dark: true },
  { name: 'Parchment', token: 'parchment', hex: '#ECDFCC', use: 'Headings, primary text and buttons', dark: false },
] as const;

const derived = [
  { name: 'Ink Raised', token: 'ink-raised', hex: '#262823', use: 'Field fills and quiet muted surfaces', dark: true },
  { name: 'Bark Raised', token: 'bark-raised', hex: '#47483F', use: 'Hover and selected states on bark', dark: true },
  { name: 'Moss Bright', token: 'moss-bright', hex: '#93A08D', use: 'Small secondary text and focus rings', dark: true },
  { name: 'Clay', token: 'clay', hex: '#B4594A', use: 'Destructive only — the one non-palette hue', dark: true },
] as const;

type SwatchProps = { name: string; token: string; hex: string; use: string; dark: boolean };

function Swatch({ name, token, hex, use, dark }: SwatchProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div
        className={cn(
          'flex h-20 items-end border-b border-border p-3 font-mono text-xs',
          dark ? 'text-parchment' : 'text-ink',
        )}
        style={{ backgroundColor: 'var(--color-' + token + ')' }}
      >
        {hex}
      </div>
      <div className="p-3">
        <p className="text-sm font-semibold text-foreground">{name}</p>
        <p className="font-mono text-xs text-moss-bright">--color-{token}</p>
        <p className="mt-1 text-xs text-moss-bright">{use}</p>
      </div>
    </div>
  );
}

function Section({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-10">
      <p className="text-xs font-semibold tracking-[0.2em] text-moss-bright uppercase">{kicker}</p>
      <h2 className="mt-2 font-display text-3xl font-medium text-foreground">{title}</h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

export default function DesignPage() {
  return (
    <div className="min-h-full bg-background pb-20">
      <header className="border-b border-border bg-card">
        <div className="mx-auto w-full max-w-5xl px-6 py-14">
          <p className="text-xs font-semibold tracking-[0.2em] text-moss-bright uppercase">Almonac · Brand v2</p>
          <h1 className="mt-3 font-display text-5xl font-medium text-foreground">Design System</h1>
          <p className="mt-3 max-w-xl text-base text-moss-bright">
            Onyx base, bark surfaces, moss accents, parchment type. One dark theme, four colours.
          </p>
        </div>
      </header>

      <Section kicker="Palette" title="Four anchors">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {palette.map((c) => (
            <Swatch key={c.token} {...c} />
          ))}
        </div>
      </Section>

      <Section kicker="Palette" title="Derived tints">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {derived.map((c) => (
            <Swatch key={c.token} {...c} />
          ))}
        </div>
        <p className="mt-4 max-w-2xl text-sm text-moss-bright">
          Every value above is mixed from the four anchors — bark lifted toward parchment, or ink
          lifted toward bark. Clay is the sole exception, kept for destructive states.
        </p>
      </Section>

      <Section kicker="Typography" title="Outfit + Lora">
        <div className="grid gap-4 rounded-xl border border-border bg-card p-6 md:grid-cols-2">
          <div>
            <p className="font-mono text-xs text-moss-bright">font-sans · Outfit · interface</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">
              The quick brown fox jumps over the lazy dog
            </p>
            <p className="mt-2 text-base text-parchment/80">
              Body copy in Outfit Regular. Buttons, labels, navigation and data all use the interface
              face.
            </p>
            <p className="mt-2 text-sm text-moss-bright">Muted helper text in moss.</p>
          </div>
          <div>
            <p className="font-mono text-xs text-moss-bright">font-display · Lora Medium · editorial</p>
            <p className="mt-2 font-display text-4xl font-medium text-foreground">Quiet groves, warm light</p>
            <p className="mt-2 font-display text-2xl text-parchment/80 italic">
              An italic line for editorial pull-quotes.
            </p>
          </div>
        </div>
      </Section>

      <Section kicker="Components" title="Buttons">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-6">
          <Button>Primary · Parchment</Button>
          <Button variant="secondary">Secondary · Bark</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
        </div>
      </Section>

      <Section kicker="Components" title="Surfaces">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="text-sm font-semibold text-card-foreground">Raised panel</p>
            <p className="mt-1 text-sm text-moss-bright">Bark panels float above the page for cards and popovers.</p>
          </div>
          <div className="rounded-xl bg-muted p-5">
            <p className="text-sm font-semibold text-foreground">Muted surface</p>
            <p className="mt-1 text-sm text-moss-bright">Barely-there fills for quiet zones and hover.</p>
          </div>
          <div className="rounded-xl bg-bark-raised p-5">
            <p className="text-sm font-semibold text-foreground">Raised surface</p>
            <p className="mt-1 text-sm text-moss-bright">Selected or hovered state on bark.</p>
          </div>
        </div>
      </Section>

      <Section kicker="Components" title="Fields">
        <div className="grid gap-4 rounded-xl border border-border bg-card p-6 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p className="text-[13px] font-semibold text-foreground">Work email</p>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex w-11 items-center justify-center text-moss-bright">
                <Mail01 size={18} />
              </span>
              <Input placeholder="name@company.com" className="rounded-xl border-border bg-ink-raised pr-3.5 pl-11 text-[15px] leading-5" />
            </div>
            <p className="text-[12px] text-moss-bright">Icon-led fields sit on ink-raised with bark hairlines.</p>
          </div>
          <div className="flex flex-col justify-end gap-2">
            <Button size="lg" className="h-[52px] w-full rounded-xl text-[15px] font-semibold">
              Continue
            </Button>
            <p className="text-[12px] text-moss-bright">Parchment buttons carry ink text.</p>
          </div>
        </div>
      </Section>
    </div>
  );
}
