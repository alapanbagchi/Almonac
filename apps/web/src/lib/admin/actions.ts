"use server";

import { z } from "zod";

import { AdminApiError } from "./api";
import { BreakGlassApiError } from "@/lib/break-glass/api";
import * as data from "./data";
import * as schemas from "./schemas";
import { AdminActionError, type ActionResult } from "./result";
import type {
  AuditView,
  BreakGlassView,
  CreatedDomain,
  FacilitiesView,
  OrganisationsView,
  UsersView,
} from "./views";
import type {
  BreakGlassGrant,
  BreakGlassReview,
  GrantRequest,
  ReviewRequest,
} from "@/lib/break-glass/model";
import type { Domain, Hospital, Invitation, Organisation } from "./model";

async function run<T>(work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    if (error instanceof AdminActionError) return { ok: false, code: error.code };
    if (error instanceof AdminApiError) return { ok: false, code: error.code };
    if (error instanceof BreakGlassApiError) return { ok: false, code: error.code };
    return { ok: false, code: "ADMIN_FAILED" };
  }
}

async function validated<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  work: (value: z.infer<S>) => Promise<T>,
): Promise<ActionResult<T>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION_FAILED" };
  return run(() => work(parsed.data));
}

export async function getOrganisations(): Promise<ActionResult<OrganisationsView>> {
  return run(data.loadOrganisationsData);
}

export async function getFacilities(
  organisationId: string | null,
): Promise<ActionResult<FacilitiesView>> {
  const parsed = schemas.uuid.nullable().safeParse(organisationId);
  if (!parsed.success) return { ok: false, code: "VALIDATION_FAILED" };
  return run(() => data.loadFacilitiesData(parsed.data));
}

export async function getUsers(
  organisationId: string | null,
): Promise<ActionResult<UsersView>> {
  const parsed = schemas.uuid.nullable().safeParse(organisationId);
  if (!parsed.success) return { ok: false, code: "VALIDATION_FAILED" };
  return run(() => data.loadUsersData(parsed.data));
}

export async function getAuditLog(
  organisationId: string | null,
  cursor: string | undefined,
): Promise<ActionResult<AuditView>> {
  const parsed = z
    .object({
      organisationId: schemas.uuid.nullable(),
      cursor: z.string().max(60).optional(),
    })
    .safeParse({ organisationId, cursor });
  if (!parsed.success) return { ok: false, code: "VALIDATION_FAILED" };
  return run(() => data.loadAuditData(parsed.data.organisationId, parsed.data.cursor));
}

export async function getBreakGlass(): Promise<ActionResult<BreakGlassView>> {
  return run(data.loadBreakGlassData);
}

export async function createOrganisation(input: {
  name: string;
  slug: string;
}): Promise<ActionResult<Organisation>> {
  return validated(schemas.createOrganisationInput, input, data.createOrganisationData);
}

export async function createHospital(input: {
  organisationId: string;
  name: string;
  slug: string;
  timezone: string;
}): Promise<ActionResult<Hospital>> {
  const id = schemas.uuid.safeParse(input.organisationId);
  if (!id.success) return { ok: false, code: "VALIDATION_FAILED" };
  return validated(schemas.createHospitalInput, input, (value) =>
    data.createHospitalData(id.data, value),
  );
}

export async function addDomain(input: {
  hospitalId: string;
  domain: string;
}): Promise<ActionResult<CreatedDomain>> {
  const id = schemas.uuid.safeParse(input.hospitalId);
  const name = schemas.domainName.safeParse(input.domain);
  if (!id.success || !name.success) return { ok: false, code: "VALIDATION_FAILED" };
  return run(() => data.addDomainData(id.data, name.data));
}

export async function verifyDomain(input: {
  hospitalId: string;
  domainId: string;
  token: string;
}): Promise<ActionResult<Domain>> {
  const ids = z.object({ hospitalId: schemas.uuid, domainId: schemas.uuid }).safeParse({
    hospitalId: input.hospitalId,
    domainId: input.domainId,
  });
  const value = z.string().trim().min(1).max(128).safeParse(input.token);
  if (!ids.success || !value.success) return { ok: false, code: "VALIDATION_FAILED" };
  return run(() => data.verifyDomainData(ids.data.hospitalId, ids.data.domainId, value.data));
}

export async function setPrimaryDomain(input: {
  hospitalId: string;
  domainId: string;
}): Promise<ActionResult<Hospital>> {
  const ids = z.object({ hospitalId: schemas.uuid, domainId: schemas.uuid }).safeParse(input);
  if (!ids.success) return { ok: false, code: "VALIDATION_FAILED" };
  return run(() => data.setPrimaryDomainData(ids.data.hospitalId, ids.data.domainId));
}

export async function createInvitation(input: {
  organisationId: string;
  email: string;
  hospitalId: string | null;
  roleIds: string[];
}): Promise<ActionResult<Invitation>> {
  const id = schemas.uuid.safeParse(input.organisationId);
  if (!id.success) return { ok: false, code: "VALIDATION_FAILED" };
  return validated(schemas.createInvitationInput, input, (value) =>
    data.createInvitationData(id.data, value),
  );
}

export async function resendInvitation(invitationId: string): Promise<ActionResult<Invitation>> {
  const parsed = schemas.uuid.safeParse(invitationId);
  if (!parsed.success) return { ok: false, code: "VALIDATION_FAILED" };
  return run(() => data.resendInvitationData(parsed.data));
}

export async function revokeInvitation(invitationId: string): Promise<ActionResult<void>> {
  const parsed = schemas.uuid.safeParse(invitationId);
  if (!parsed.success) return { ok: false, code: "VALIDATION_FAILED" };
  return run(() => data.revokeInvitationData(parsed.data));
}

export async function acceptInvitation(token: string): Promise<ActionResult<Invitation>> {
  const parsed = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/).safeParse(token);
  if (!parsed.success) return { ok: false, code: "VALIDATION_FAILED" };
  return run(() => data.acceptInvitationData(parsed.data));
}

export async function suspendMembership(input: {
  membershipId: string;
  reason: string;
}): Promise<ActionResult<void>> {
  const id = schemas.uuid.safeParse(input.membershipId);
  const why = schemas.reason.safeParse(input.reason);
  if (!id.success || !why.success) return { ok: false, code: "VALIDATION_FAILED" };
  return run(() => data.suspendMembershipData(id.data, why.data));
}

export async function revokeMembership(input: {
  membershipId: string;
  reason: string;
}): Promise<ActionResult<void>> {
  const id = schemas.uuid.safeParse(input.membershipId);
  const why = schemas.reason.safeParse(input.reason);
  if (!id.success || !why.success) return { ok: false, code: "VALIDATION_FAILED" };
  return run(() => data.revokeMembershipData(id.data, why.data));
}

export async function requestGrant(input: GrantRequest): Promise<ActionResult<BreakGlassGrant>> {
  return validated(schemas.requestGrantInput, input, data.requestGrantData);
}

export async function revokeGrant(input: {
  grantId: string;
  reason: string;
}): Promise<ActionResult<BreakGlassGrant>> {
  const id = schemas.uuid.safeParse(input.grantId);
  const why = schemas.reason.safeParse(input.reason);
  if (!id.success || !why.success) return { ok: false, code: "VALIDATION_FAILED" };
  return run(() => data.revokeGrantData(id.data, why.data));
}

export async function reviewGrant(input: {
  grantId: string;
  decision: ReviewRequest["decision"];
  notes: string | null;
}): Promise<ActionResult<BreakGlassReview>> {
  const id = schemas.uuid.safeParse(input.grantId);
  if (!id.success) return { ok: false, code: "VALIDATION_FAILED" };
  return validated(schemas.reviewGrantInput, input, (value) =>
    data.reviewGrantData(id.data, value),
  );
}

export async function createFirstOrganisation(input: {
  name: string;
  slug: string;
}): Promise<ActionResult<{ id: string; name: string; slug: string; status: string }>> {
  return validated(schemas.onboardingInput, input, data.createFirstOrganisationData);
}
