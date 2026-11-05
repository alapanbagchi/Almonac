"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

/** A filled envelope that breathes once every few seconds. */
export function MailMark({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion();
  const maskId = `mail-seam-${React.useId().replace(/:/g, "")}`;

  return (
    <motion.svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      className={className}
      animate={reduceMotion ? undefined : { y: [0, -2.5, 0] }}
      transition={{ duration: 0.9, ease: "easeInOut", repeat: Infinity, repeatDelay: 4 }}
    >
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48">
        <rect width="48" height="48" fill="white" />
        <path
          d="M5.5 14.5 24 27l18.5-12.5"
          fill="none"
          stroke="black"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </mask>
      <rect
        x="4"
        y="11"
        width="40"
        height="26"
        rx="4.5"
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
    </motion.svg>
  );
}
