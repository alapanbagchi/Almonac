const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ACTIONS = new Set(["activate", "revoke", "review"]);

/** Only the calls the break-glass screens make reach the API. */
export function isAllowedBreakGlassRequest(method: string, segments: string[]): boolean {
  if (segments.length === 1 && segments[0] === "grants") {
    return method === "GET" || method === "POST";
  }
  if (segments.length === 3 && segments[0] === "grants") {
    const [, grantId, action] = segments;
    return method === "POST" && UUID.test(grantId!) && ACTIONS.has(action!);
  }
  return false;
}
