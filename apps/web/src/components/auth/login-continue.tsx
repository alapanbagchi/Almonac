"use client";

import type { MouseEvent, ReactNode } from "react";

/**
 * The invitation token travels in the URL fragment, which the server never
 * receives. When the browser reaches the sign-in page with a token fragment,
 * append it to the internal return target so the token survives the OIDC round
 * trip. Other fragments are not carried.
 */
export function LoginContinue({
  href,
  returnTo,
  children,
  className,
}: {
  href: string;
  returnTo: string;
  children: ReactNode;
  className: string;
}) {
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    const hash = window.location.hash;
    if (!hash.startsWith("#token=")) return;
    const target = `${returnTo}${hash}`;
    event.currentTarget.href = `/api/auth/login?returnTo=${encodeURIComponent(target)}`;
  }

  return (
    <a href={href} onClick={follow} className={className}>
      {children}
    </a>
  );
}
