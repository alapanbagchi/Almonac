export function isCrossSiteNavigation(request: Request): boolean {
  return request.headers.get("sec-fetch-site") === "cross-site";
}

export function hasTrustedOrigin(request: Request, publicOrigin: string): boolean {
  return request.headers.get("origin") === publicOrigin;
}
