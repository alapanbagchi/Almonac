import "server-only";

import { cache } from "react";

import { createAdminApi, type AdminApi } from "./api";
import { hasOrganisationScope } from "./scope";
import { loadWebConfig } from "@/lib/auth/config";
import type { AuthSession } from "@/lib/auth/api";
import { getSession, getSessionToken } from "@/lib/auth/session";

export interface AdminContext {
  readonly api: AdminApi;
  readonly token: string;
  readonly permissions: readonly string[];
  readonly memberships: AuthSession["memberships"];
}

/** Resolves the server-side administration client, or null when signed out. */
export const getAdminContext = cache(async (): Promise<AdminContext | null> => {
  const [session, token] = await Promise.all([getSession(), getSessionToken()]);
  if (session === null || token === null) return null;
  return {
    api: createAdminApi({ baseUrl: loadWebConfig().apiUrl }),
    token,
    permissions: session.permissions,
    memberships: session.memberships,
  };
});

export function hasPermission(context: AdminContext, permission: string): boolean {
  return context.permissions.includes(permission);
}

/**
 * The session reports the union of permissions across every membership. An
 * organisation screen needs a permission that applies to the whole
 * organisation, not one granted only at a hospital. Platform administrators
 * bypass the membership check.
 */
export function canManageOrganisation(
  context: AdminContext,
  permission: string,
  organisationId: string,
): boolean {
  return hasOrganisationScope(
    context.permissions,
    context.memberships,
    permission,
    organisationId,
  );
}
