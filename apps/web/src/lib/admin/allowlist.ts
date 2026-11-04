const SLUG = /^[A-Za-z0-9_-]{1,64}$/;

const ROUTES: readonly { method: string; pattern: RegExp }[] = [
  { method: "GET", pattern: /^organisations$/ },
  { method: "POST", pattern: /^organisations$/ },
  { method: "GET", pattern: /^organisations\/[0-9a-fA-F-]{1,64}$/ },
  { method: "GET", pattern: /^organisations\/[0-9a-fA-F-]{1,64}\/hospitals$/ },
  { method: "POST", pattern: /^organisations\/[0-9a-fA-F-]{1,64}\/hospitals$/ },
  { method: "GET", pattern: /^organisations\/[0-9a-fA-F-]{1,64}\/memberships$/ },
  { method: "GET", pattern: /^organisations\/[0-9a-fA-F-]{1,64}\/roles$/ },
  { method: "GET", pattern: /^organisations\/[0-9a-fA-F-]{1,64}\/invitations$/ },
  { method: "POST", pattern: /^organisations\/[0-9a-fA-F-]{1,64}\/invitations$/ },
  { method: "GET", pattern: /^organisations\/[0-9a-fA-F-]{1,64}\/audit$/ },
  { method: "GET", pattern: /^hospitals\/[0-9a-fA-F-]{1,64}\/domains$/ },
  { method: "POST", pattern: /^hospitals\/[0-9a-fA-F-]{1,64}\/domains$/ },
  { method: "POST", pattern: /^hospitals\/[0-9a-fA-F-]{1,64}\/domains\/[0-9a-fA-F-]{1,64}\/verify$/ },
  { method: "POST", pattern: /^hospitals\/[0-9a-fA-F-]{1,64}\/domains\/[0-9a-fA-F-]{1,64}\/primary$/ },
  { method: "POST", pattern: /^memberships\/[0-9a-fA-F-]{1,64}\/(?:suspend|revoke|roles)$/ },
  { method: "DELETE", pattern: /^memberships\/[0-9a-fA-F-]{1,64}\/roles\/[0-9a-fA-F-]{1,64}$/ },
  { method: "POST", pattern: /^invitations\/[0-9a-fA-F-]{1,64}\/resend$/ },
  { method: "POST", pattern: /^invitations\/[0-9a-fA-F-]{1,64}\/revoke$/ },
  { method: "POST", pattern: /^invitations\/accept$/ },
];

/**
 * The browser may reach only these administration paths. The list is an
 * allowlist, not a rewrite: an unknown path is a 404 before any API call.
 */
export function isAllowedAdminRequest(method: string, segments: readonly string[]): boolean {
  if (segments.length === 0 || segments.some((segment) => !SLUG.test(segment))) return false;
  const path = segments.join("/");
  return ROUTES.some((route) => route.method === method && route.pattern.test(path));
}