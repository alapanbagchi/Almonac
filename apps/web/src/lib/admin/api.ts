import "server-only";

import { z } from "zod";

import {
  auditSchema,
  createdDomainSchema,
  domainSchema,
  hospitalSchema,
  invitationSchema,
  membershipSchema,
  organisationSchema,
  roleSchema,
  type AuditEntry,
  type Domain,
  type Hospital,
  type Invitation,
  type Membership,
  type Organisation,
  type Role,
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
    listOrganisations: (token: string): Promise<Organisation[]> =>
      call(token, "GET", "/organisations", z.array(organisationSchema)),
    getOrganisation: (token: string, id: string): Promise<Organisation> =>
      call(token, "GET", `/organisations/${id}`, organisationSchema),
    createOrganisation: (
      token: string,
      input: { name: string; slug: string },
    ): Promise<Organisation> =>
      call(token, "POST", "/organisations", organisationSchema, input),
    listHospitals: (token: string, organisationId: string): Promise<Hospital[]> =>
      call(token, "GET", `/organisations/${organisationId}/hospitals`, z.array(hospitalSchema)),
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
    listDomains: (token: string, hospitalId: string): Promise<Domain[]> =>
      call(token, "GET", `/hospitals/${hospitalId}/domains`, z.array(domainSchema)),
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
    listMemberships: (token: string, organisationId: string): Promise<Membership[]> =>
      call(
        token,
        "GET",
        `/organisations/${organisationId}/memberships`,
        z.array(membershipSchema),
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
    listRoles: (token: string, organisationId: string): Promise<Role[]> =>
      call(token, "GET", `/organisations/${organisationId}/roles`, z.array(roleSchema)),
    assignRole: (token: string, membershipId: string, roleId: string): Promise<void> =>
      call(token, "POST", `/memberships/${membershipId}/roles`, okSchema, { roleId }).then(
        () => undefined,
      ),
    removeRole: (token: string, membershipId: string, roleId: string): Promise<void> =>
      call(
        token,
        "DELETE",
        `/memberships/${membershipId}/roles/${roleId}`,
        okSchema,
      ).then(() => undefined),
    listInvitations: (token: string, organisationId: string): Promise<Invitation[]> =>
      call(
        token,
        "GET",
        `/organisations/${organisationId}/invitations`,
        z.array(invitationSchema),
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
      call(token, "DELETE", `/invitations/${invitationId}`, okSchema).then(() => undefined),
    acceptInvitation: (token: string, invitationToken: string): Promise<Invitation> =>
      call(token, "POST", "/invitations/accept", invitationSchema, {
        token: invitationToken,
      }),
    listAudit: (
      token: string,
      organisationId: string,
      cursor?: string,
    ): Promise<{ entries: AuditEntry[]; nextCursor: string | null }> => {
      let query = "";
      if (cursor !== undefined) {
        const separator = cursor.lastIndexOf(":");
        const occurredAt = cursor.slice(0, separator);
        const id = cursor.slice(separator + 1);
        if (separator > 0 && id !== "") {
          query = `?before=${encodeURIComponent(occurredAt)}&beforeId=${encodeURIComponent(id)}`;
        }
      }
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
