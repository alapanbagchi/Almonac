/** The membership fields that decide whether a screen may act on an organisation. */
export interface OrganisationScope {
  readonly organisationId: string;
  readonly hospitalId: string | null;
}

/**
 * Session permissions are a union across every membership. An organisation
 * screen needs a permission granted at organisation scope, not one granted only
 * at a hospital. Platform administrators bypass the membership check.
 */
export function hasOrganisationScope(
  permissions: readonly string[],
  memberships: readonly OrganisationScope[],
  permission: string,
  organisationId: string,
): boolean {
  if (permissions.includes("platform.manage")) return true;
  if (!permissions.includes(permission)) return false;
  return memberships.some(
    (membership) => membership.organisationId === organisationId && membership.hospitalId === null,
  );
}
