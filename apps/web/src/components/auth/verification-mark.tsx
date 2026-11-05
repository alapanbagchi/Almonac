"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

type Status = "verifying" | "verified" | "error";

const CHECK = "M14.5 24.5 21 31l13-14";
const CROSS = "M16.5 16.5 31.5 31.5M31.5 16.5 16.5 31.5";

/**
 * The state mark for the verification screen: a spinner while the request is
 * in flight, then a filled check or cross that pops in.
 */
export function VerificationMark({
  status,
  className,
}: {
  status: Status;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const maskId = `verification-mark-${React.useId().replace(/:/g, "")}`;

  if (status === "verifying") {
    return (
      <motion.svg
        viewBox="0 0 48 48"
        aria-hidden="true"
        focusable="false"
        className={className}
        style={{ transformOrigin: "50% 50%" }}
        animate={reduceMotion ? undefined : { rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1.1, ease: "linear" }}
      >
        <circle
          cx="24"
          cy="24"
          r="18"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.18"
          strokeWidth="2.2"
        />
        <path
          d="M24 6a18 18 0 1 1-18 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </motion.svg>
    );
  }

  const failed = status === "error";
  return (
    <motion.svg
      key={status}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ transformOrigin: "50% 50%" }}
      initial={reduceMotion ? false : { opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
    >
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48">
        <circle cx="24" cy="24" r="20" fill="white" />
        <motion.path
          d={failed ? CROSS : CHECK}
          fill="none"
          stroke="black"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduceMotion ? false : { pathLength: 0 }}
          animate={reduceMotion ? undefined : { pathLength: 1 }}
          transition={{ delay: 0.12, duration: failed ? 0.3 : 0.4, ease: "easeOut" }}
        />
      </mask>
      <circle
        cx="24"
        cy="24"
        r="20"
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
    </motion.svg>
  );
}
