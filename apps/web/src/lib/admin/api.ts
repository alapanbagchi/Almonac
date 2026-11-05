import "server-only";

import { z } from "zod";

import type { Page } from "@/lib/pagination";

import {
  auditSchema,
  createdDomainSchema,
  domainPageSchema,
  domainSchema,
  hospitalPageSchema,
  hospitalSchema,
  invitationPageSchema,
  invitationSchema,
  membershipPageSchema,
  organisationPageSchema,
  organisationSchema,
  rolePageSchema,
  type AuditEntry,
  type Domain,
  type DomainPage,
  type Hospital,
  type HospitalPage,
  type Invitation,
  type InvitationPage,
  type MembershipPage,
  type Organisation,
  type OrganisationPage,
  type RolePage,
} from "./model";

const errorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }),
});

const okSchema = z.object({ ok: z.literal(true) });

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = "Administration request failed",
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface AdminApiOptions {
  baseUrl: string;
  timeoutMs?: number;
  fetch?: Fetch;
}

/** Server-only client for the administration endpoints. */
export function createAdminApi({
  baseUrl,
  timeoutMs = 8_000,
  fetch: request = globalThis.fetch,
}: AdminApiOptions) {
  /** Load every page so a screen never silently hides rows after the first page. */
  async function allPages<T>(load: (query: string) => Promise<Page<T>>): Promise<Page<T>> {
    const items: T[] = [];
    let offset = 0;
    for (;;) {
      // Ask for the API's maximum page size; the default would double the round trips.
      const query = offset === 0 ? "?limit=100" : `?limit=100&offset=${offset}`;
      const page = await load(query);
      items.push(...page.items);
      if (page.nextOffset === null || page.nextOffset <= offset) {
        return { items, nextOffset: null };
      }
      offset = page.nextOffset;
    }
  }

  async function call<T>(
    token: string,
    method: string,
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await request(`${baseUrl}/v1/admin${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new AdminApiError(0, "ADMIN_UNAVAILABLE");
    }

    const payload = await readJson(response);
    if (!response.ok) {
      const parsed = errorEnvelope.safeParse(payload);
      throw new AdminApiError(
        response.status,
        parsed.success ? parsed.data.error.code : "ADMIN_UNAVAILABLE",
      );
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new AdminApiError(502, "ADMIN_INVALID_RESPONSE");
    return parsed.data;
  }

  return {
    listOrganisations: (token: string): Promise<OrganisationPage> =>
      allPages((query) => call(token, "GET", `/organisations${query}`, organisationPageSchema)),
    createOrganisation: (
      token: string,
      input: { name: string; slug: string },
    ): Promise<Organisation> =>
      call(token, "POST", "/organisations", organisationSchema, input),
    listHospitals: (token: string, organisationId: string): Promise<HospitalPage> =>
      allPages((query) =>
        call(token, "GET", `/organisations/${organisationId}/hospitals${query}`, hospitalPageSchema),
      ),
    createHospital: (
      token: string,
      organisationId: string,
      input: { name: string; slug: string; timezone: string },
    ): Promise<Hospital> =>
      call(
        token,
        "POST",
        `/organisations/${organisationId}/hospitals`,
        hospitalSchema,
        input,
      ),
    listDomains: (token: string, hospitalId: string): Promise<DomainPage> =>
      allPages((query) =>
        call(token, "GET", `/hospitals/${hospitalId}/domains${query}`, domainPageSchema),
      ),
    addDomain: (
      token: string,
      hospitalId: string,
      domain: string,
    ): Promise<{ domain: Domain; token: string }> =>
      call(token, "POST", `/hospitals/${hospitalId}/domains`, createdDomainSchema, { domain }),
    verifyDomain: (
      token: string,
      hospitalId: string,
      domainId: string,
      token_: string,
    ): Promise<Domain> =>
      call(
        token,
        "POST",
        `/hospitals/${hospitalId}/domains/${domainId}/verify`,
        domainSchema,
        { token: token_ },
      ),
    setPrimaryDomain: (
      token: string,
      hospitalId: string,
      domainId: string,
    ): Promise<Hospital> =>
      call(
        token,
        "POST",
        `/hospitals/${hospitalId}/domains/${domainId}/primary`,
        hospitalSchema,
      ),
    listMemberships: (token: string, organisationId: string): Promise<MembershipPage> =>
      allPages((query) =>
        call(
          token,
          "GET",
          `/organisations/${organisationId}/memberships${query}`,
          membershipPageSchema,
        ),
      ),
    suspendMembership: (
      token: string,
      membershipId: string,
      reason: string,
    ): Promise<void> =>
      call(token, "POST", `/memberships/${membershipId}/suspend`, okSchema, { reason }).then(
        () => undefined,
      ),
    revokeMembership: (
      token: string,
      membershipId: string,
      reason: string,
    ): Promise<void> =>
      call(token, "POST", `/memberships/${membershipId}/revoke`, okSchema, { reason }).then(
        () => undefined,
      ),
    listRoles: (token: string, organisationId: string): Promise<RolePage> =>
      allPages((query) =>
        call(token, "GET", `/organisations/${organisationId}/roles${query}`, rolePageSchema),
      ),
    listInvitations: (token: string, organisationId: string): Promise<InvitationPage> =>
      allPages((query) =>
        call(
          token,
          "GET",
          `/organisations/${organisationId}/invitations${query}`,
          invitationPageSchema,
        ),
      ),
    createInvitation: (
      token: string,
      organisationId: string,
      input: {
        email: string;
        displayName?: string;
        hospitalId: string | null;
        roleIds: string[];
      },
    ): Promise<Invitation> =>
      call(
        token,
        "POST",
        `/organisations/${organisationId}/invitations`,
        invitationSchema,
        input,
      ),
    resendInvitation: (token: string, invitationId: string): Promise<Invitation> =>
      call(token, "POST", `/invitations/${invitationId}/resend`, invitationSchema),
    revokeInvitation: (token: string, invitationId: string): Promise<void> =>
      call(token, "POST", `/invitations/${invitationId}/revoke`, okSchema).then(() => undefined),
    acceptInvitation: (token: string, invitationToken: string): Promise<Invitation> =>
      call(token, "POST", "/invitations/accept", invitationSchema, {
        token: invitationToken,
      }),
    listAudit: (
      token: string,
      organisationId: string,
      cursor?: string,
    ): Promise<{ entries: AuditEntry[]; nextCursor: string | null }> => {
      const query = cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`;
      return call(
        token,
        "GET",
        `/organisations/${organisationId}/audit${query}`,
        auditSchema,
      );
    },
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}