import "server-only";

import { AdminApiError } from "./api";
import type {
  AuditView,
  BreakGlassView,
  CreatedDomain,
  FacilitiesView,
  OrganisationsView,
  UsersView,
} from "./views";
import type { Domain, Hospital, Invitation, Organisation } from "./model";
import {
  canManageOrganisation,
  getAdminContext,
  hasPermission,
  type AdminContext,
} from "./page-data";
import { AdminActionError } from "./result";
import { createBreakGlassApi } from "@/lib/break-glass/api";
import type {
  BreakGlassGrant,
  BreakGlassReview,
  GrantRequest,
  ReviewRequest,
} from "@/lib/break-glass/model";
import { loadWebConfig } from "@/lib/auth/config";
import { createFirstOrganisation, OnboardingApiError } from "@/lib/onboarding/api";
import { getSessionToken } from "@/lib/auth/session";

/** Every admin read needs the signed-in token; expiry is an auth failure. */
async function requireContext(): Promise<AdminContext> {
  const context = await getAdminContext();
  if (context === null) throw new AdminActionError("AUTH_REQUIRED");
  return context;
}

async function listOrganisations(context: AdminContext): Promise<Organisation[]> {
  return (await context.api.listOrganisations(context.token)).items;
}

function forbidden(error: unknown): boolean {
  return error instanceof AdminApiError && error.status === 403;
}

/** A requested organisation, or the first one the member can see. */
function pickOrganisation(
  organisations: Organisation[],
  organisationId: string | null,
): Organisation | null {
  return (
    organisations.find((organisation) => organisation.id === organisationId) ??
    organisations[0] ??
    null
  );
}

export async function loadOrganisationsData(): Promise<OrganisationsView> {
  const context = await requireContext();
  return {
    organisations: await listOrganisations(context),
    canCreate: hasPermission(context, "platform.manage"),
  };
}

export async function loadFacilitiesData(
  organisationId: string | null,
): Promise<FacilitiesView> {
  const context = await requireContext();
  const organisations = await listOrganisations(context);
  const selected = pickOrganisation(organisations, organisationId);

  if (selected === null) {
    return { organisations, selected: null, canManage: false, forbidden: false, hospitals: [] };
  }

  const canManage = canManageOrganisation(context, "hospital.manage", selected.id);
  if (!canManage) {
    return { organisations, selected, canManage: false, forbidden: false, hospitals: [] };
  }

  try {
    const hospitals = (await context.api.listHospitals(context.token, selected.id)).items;
    const domains = await Promise.all(
      hospitals.map(async (hospital) => {
        const page = await context.api.listDomains(context.token, hospital.id);
        return page.items;
      }),
    );
    return {
      organisations,
      selected,
      canManage: true,
      forbidden: false,
      hospitals: hospitals.map((hospital, index) => ({
        ...hospital,
        domains: domains[index] ?? [],
      })),
    };
  } catch (error) {
    if (!forbidden(error)) throw error;
    return { organisations, selected, canManage: true, forbidden: true, hospitals: [] };
  }
}

export async function loadUsersData(organisationId: string | null): Promise<UsersView> {
  const context = await requireContext();
  const organisations = await listOrganisations(context);
  const selected = pickOrganisation(organisations, organisationId);

  if (selected === null) {
    return {
      organisations,
      selected: null,
      canManage: false,
      forbidden: false,
      memberships: [],
      invitations: [],
      roles: [],
      hospitals: [],
    };
  }

  const canManage = canManageOrganisation(context, "membership.manage", selected.id);
  if (!canManage) {
    return {
      organisations,
      selected,
      canManage: false,
      forbidden: false,
      memberships: [],
      invitations: [],
      roles: [],
      hospitals: [],
    };
  }

  try {
    const [memberships, invitations, roles, hospitals] = await Promise.all([
      context.api.listMemberships(context.token, selected.id),
      context.api.listInvitations(context.token, selected.id),
      context.api.listRoles(context.token, selected.id),
      context.api.listHospitals(context.token, selected.id),
    ]);
    return {
      organisations,
      selected,
      canManage: true,
      forbidden: false,
      memberships: memberships.items,
      invitations: invitations.items,
      roles: roles.items,
      hospitals: hospitals.items,
    };
  } catch (error) {
    if (!forbidden(error)) throw error;
    return {
      organisations,
      selected,
      canManage: true,
      forbidden: true,
      memberships: [],
      invitations: [],
      roles: [],
      hospitals: [],
    };
  }
}

export async function loadAuditData(
  organisationId: string | null,
  cursor: string | undefined,
): Promise<AuditView> {
  const context = await requireContext();
  const organisations = await listOrganisations(context);
  const selected = pickOrganisation(organisations, organisationId);

  if (selected === null) {
    return {
      organisations,
      selected: null,
      canRead: false,
      forbidden: false,
      entries: [],
      nextCursor: null,
    };
  }

  const canRead = canManageOrganisation(context, "audit.read", selected.id);
  if (!canRead) {
    return {
      organisations,
      selected,
      canRead: false,
      forbidden: false,
      entries: [],
      nextCursor: null,
    };
  }

  try {
    const page = await context.api.listAudit(context.token, selected.id, cursor);
    return {
      organisations,
      selected,
      canRead: true,
      forbidden: false,
      entries: page.entries,
      nextCursor: page.nextCursor,
    };
  } catch (error) {
    if (!forbidden(error)) throw error;
    return {
      organisations,
      selected,
      canRead: true,
      forbidden: true,
      entries: [],
      nextCursor: null,
    };
  }
}

export async function loadBreakGlassData(): Promise<BreakGlassView> {
  const context = await requireContext();
  const config = loadWebConfig();
  const grants = (
    await createBreakGlassApi({ baseUrl: config.apiUrl }).listGrants(context.token, null)
  ).items;

  // One row per hospital, even when several memberships name the same one.
  const hospitals = new Map<string, string>();
  for (const membership of context.memberships) {
    if (membership.hospitalId === null) continue;
    hospitals.set(
      membership.hospitalId,
      membership.hospitalName ?? membership.hospitalId,
    );
  }

  return {
    grants,
    hospitals: [...hospitals].map(([id, name]) => ({ id, name })),
    canRequest: hasPermission(context, "break_glass.request"),
    canReview:
      hasPermission(context, "break_glass.approve") ||
      hasPermission(context, "platform.manage"),
  };
}

export async function createOrganisationData(input: {
  name: string;
  slug: string;
}): Promise<Organisation> {
  const context = await requireContext();
  return context.api.createOrganisation(context.token, input);
}

export async function createHospitalData(
  organisationId: string,
  input: { name: string; slug: string; timezone: string },
): Promise<Hospital> {
  const context = await requireContext();
  return context.api.createHospital(context.token, organisationId, input);
}

export async function addDomainData(
  hospitalId: string,
  domain: string,
): Promise<CreatedDomain> {
  const context = await requireContext();
  return context.api.addDomain(context.token, hospitalId, domain);
}

export async function verifyDomainData(
  hospitalId: string,
  domainId: string,
  token: string,
): Promise<Domain> {
  const context = await requireContext();
  return context.api.verifyDomain(context.token, hospitalId, domainId, token);
}

export async function setPrimaryDomainData(
  hospitalId: string,
  domainId: string,
): Promise<Hospital> {
  const context = await requireContext();
  return context.api.setPrimaryDomain(context.token, hospitalId, domainId);
}

export async function createInvitationData(
  organisationId: string,
  input: {
    email: string;
    hospitalId: string | null;
    roleIds: string[];
  },
): Promise<Invitation> {
  const context = await requireContext();
  return context.api.createInvitation(context.token, organisationId, input);
}

export async function resendInvitationData(invitationId: string): Promise<Invitation> {
  const context = await requireContext();
  return context.api.resendInvitation(context.token, invitationId);
}

export async function revokeInvitationData(invitationId: string): Promise<void> {
  const context = await requireContext();
  await context.api.revokeInvitation(context.token, invitationId);
}

export async function acceptInvitationData(invitationToken: string): Promise<Invitation> {
  const context = await requireContext();
  return context.api.acceptInvitation(context.token, invitationToken);
}

export async function suspendMembershipData(
  membershipId: string,
  reason: string,
): Promise<void> {
  const context = await requireContext();
  await context.api.suspendMembership(context.token, membershipId, reason);
}

export async function revokeMembershipData(
  membershipId: string,
  reason: string,
): Promise<void> {
  const context = await requireContext();
  await context.api.revokeMembership(context.token, membershipId, reason);
}

export async function requestGrantData(input: GrantRequest): Promise<BreakGlassGrant> {
  const context = await requireContext();
  const config = loadWebConfig();
  return createBreakGlassApi({ baseUrl: config.apiUrl }).requestGrant(context.token, input);
}

export async function revokeGrantData(
  grantId: string,
  reason: string,
): Promise<BreakGlassGrant> {
  const context = await requireContext();
  const config = loadWebConfig();
  return createBreakGlassApi({ baseUrl: config.apiUrl }).revokeGrant(
    context.token,
    grantId,
    reason,
  );
}

export async function reviewGrantData(
  grantId: string,
  input: ReviewRequest,
): Promise<BreakGlassReview> {
  const context = await requireContext();
  const config = loadWebConfig();
  return createBreakGlassApi({ baseUrl: config.apiUrl }).reviewGrant(
    context.token,
    grantId,
    input,
  );
}

export async function createFirstOrganisationData(input: {
  name: string;
  slug: string;
}): Promise<{ id: string; name: string; slug: string; status: string }> {
  const token = await getSessionToken();
  if (token === null) throw new AdminActionError("AUTH_REQUIRED");
  try {
    return await createFirstOrganisation(loadWebConfig().apiUrl, token, input);
  } catch (error) {
    if (error instanceof OnboardingApiError) {
      throw new AdminActionError(error.code);
    }
    throw error;
  }
}
