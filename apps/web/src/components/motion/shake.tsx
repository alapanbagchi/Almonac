"use client";

import * as React from "react";

import { useShake } from "./use-shake";

type ShakeTrigger = string | boolean | null | undefined;

/**
 * Shakes its children when `trigger` becomes a new truthy value, so the
 * interaction works on any element without knowing about forms or fields.
 * A value that is already truthy on mount does not animate on page load.
 *
 * `pulse` replays the shake while `trigger` stays truthy, for repeated
 * failures with the same message (e.g. a second submit attempt).
 */
export function Shake({
  trigger,
  pulse = 0,
  className,
  children,
}: {
  trigger: ShakeTrigger;
  pulse?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const { ref, shake } = useShake<HTMLDivElement>();
  const value = typeof trigger === "string" ? trigger : trigger === true;
  const previous = React.useRef(value);
  const previousPulse = React.useRef(pulse);

  React.useEffect(() => {
    const changed = value !== previous.current;
    const pulsed = pulse !== previousPulse.current;
    if (value && (changed || pulsed)) shake();
    previous.current = value;
    previousPulse.current = pulse;
  }, [shake, value, pulse]);

  return (
    <div ref={ref} data-slot="shake" className={className}>
      {children}
    </div>
  );
}
