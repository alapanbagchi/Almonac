import "server-only";

import { cache } from "react";

import { AdminApiError, createAdminApi, type AdminApi } from "./api";
import type { Organisation } from "./model";
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

/** Platform administrators see every organisation; other staff see their own. */
export const getVisibleOrganisations = cache(async (): Promise<Organisation[]> => {
  const context = await getAdminContext();
  if (context === null) return [];

  // The API scopes this list to the caller: platform administrators receive
  // every organisation, everyone else receives the organisations they belong
  // to. Do not call getOrganisation per membership, because that requires
  // organisation.manage and would lock a hospital administrator out.
  return (await context.api.listOrganisations(context.token)).items;
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

/** A read-only screen is better than an error page when the API denies a list. */
export async function readOrForbidden<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 403) return null;
    throw error;
  }
}
