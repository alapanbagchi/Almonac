"use client";

import * as React from "react";

const SHAKE_MS = 420;
const SHAKE_EASING = "cubic-bezier(0.36, 0.07, 0.19, 0.97)";

// A sideways beat owned by the hook, so the interaction never depends on a
// stylesheet being loaded. Six pixels reads clearly without moving layout.
const KEYFRAMES: Keyframe[] = [
  { transform: "translateX(0)", offset: 0 },
  { transform: "translateX(-2px)", offset: 0.1 },
  { transform: "translateX(3px)", offset: 0.2 },
  { transform: "translateX(-6px)", offset: 0.3 },
  { transform: "translateX(6px)", offset: 0.4 },
  { transform: "translateX(-6px)", offset: 0.5 },
  { transform: "translateX(6px)", offset: 0.6 },
  { transform: "translateX(-6px)", offset: 0.7 },
  { transform: "translateX(3px)", offset: 0.8 },
  { transform: "translateX(-2px)", offset: 0.9 },
  { transform: "translateX(0)", offset: 1 },
];

/**
 * Shakes the referenced element once. Calling it again cancels the current
 * run and starts over, so a second failed submit is still visible.
 */
export function useShake<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const animation = React.useRef<Animation | null>(null);

  const shake = React.useCallback(() => {
    const node = ref.current;
    if (node === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    animation.current?.cancel();
    animation.current = node.animate(KEYFRAMES, {
      duration: SHAKE_MS,
      easing: SHAKE_EASING,
    });
  }, []);

  React.useEffect(() => {
    return () => animation.current?.cancel();
  }, []);

  return { ref, shake };
}
