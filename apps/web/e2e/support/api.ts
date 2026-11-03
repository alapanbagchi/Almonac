/**
 * Test double for the authentication and administration APIs. It lets the
 * browser suite exercise the BFF, pages and cookies without a live database or
 * identity provider.
 */
const PORT = 3101;
const TOKEN = "A".repeat(43);
const HOSPITAL_ADMIN_TOKEN = "D".repeat(43);
const UNAVAILABLE_TOKEN = "C".repeat(43);

/** Login attempts in flight, keyed by state, so parallel tests do not collide. */
const attempts = new Map<string, string>();

const ORG_ID = "00000000-0000-4000-8000-000000000003";
const HOSPITAL_ID = "00000000-0000-4000-8000-000000000004";
const MEMBERSHIP_ID = "00000000-0000-4000-8000-000000000002";
const ROLE_ID = "00000000-0000-4000-8000-000000000005";

const SESSION = {
  user: { id: "00000000-0000-4000-8000-000000000001", email: "doctor@example.test", displayName: "Dev Doctor" },
  memberships: [
    {
      id: MEMBERSHIP_ID,
      organisationId: ORG_ID,
      organisationName: "Almonac",
      hospitalId: HOSPITAL_ID,
      hospitalName: "Riverside General",
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: null,
      roles: ["clinician"],
    },
  ],
  permissions: [
    "clinical.read",
    "platform.manage",
    "organisation.manage",
    "hospital.manage",
    "membership.manage",
    "audit.read",
  ],
};

const HOSPITAL_ADMIN_SESSION = {
  ...SESSION,
  permissions: ["clinical.read", "membership.manage"],
};

type OrganisationState = {
  id: string;
  zitadelOrgId: string | null;
  name: string;
  slug: string;
  status: string;
  provisionedAt: string | null;
  createdAt: string;
};

const organisations: OrganisationState[] = [
  {
    id: ORG_ID,
    zitadelOrgId: "zitadel-org-1",
    name: "Almonac",
    slug: "almonac",
    status: "active",
    provisionedAt: "2026-01-02T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

const hospital = {
  id: HOSPITAL_ID,
  organisationId: ORG_ID,
  name: "Riverside General",
  slug: "riverside-general",
  timezone: "UTC",
  status: "active",
  primaryDomainId: null,
  createdAt: "2026-01-02T00:00:00.000Z",
};

const membership = {
  id: MEMBERSHIP_ID,
  userId: "00000000-0000-4000-8000-000000000001",
  email: "doctor@example.test",
  displayName: "Dev Doctor",
  organisationId: ORG_ID,
  hospitalId: HOSPITAL_ID,
  status: "active",
  acceptedAt: "2026-01-02T00:00:00.000Z",
  endsAt: null,
  roles: ["clinician"],
};

const role = {
  id: ROLE_ID,
  key: "clinician",
  name: "Clinician",
  scope: "hospital",
  permissions: ["clinical.read", "clinical.write"],
};

const auditEntry = {
  id: "1",
  occurredAt: "2026-01-03T00:00:00.000Z",
  actorType: "user",
  actorUserId: SESSION.user.id,
  sessionId: null,
  organisationId: ORG_ID,
  hospitalId: null,
  eventType: "auth.login",
  outcome: "success",
  targetType: null,
  targetId: null,
  requestId: "test-request",
  reasonCode: null,
  metadata: {},
};

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

function failure(status: number, code: string): Response {
  return json(status, { error: { code, message: "Request failed.", requestId: "test" } });
}

function authorised(request: Request): boolean {
  const authorization = request.headers.get("authorization");
  return authorization === `Bearer ${TOKEN}` || authorization === `Bearer ${HOSPITAL_ADMIN_TOKEN}`;
}

Bun.serve({
  port: PORT,
  async fetch(request) {
    const { pathname } = new URL(request.url);

    if (pathname === "/health") return new Response("ok");
    if (pathname === "/v1/auth/session") {
      const authorization = request.headers.get("authorization");
      if (authorization === `Bearer ${UNAVAILABLE_TOKEN}`) return failure(503, "AUTH_UNAVAILABLE");
      if (authorization === `Bearer ${HOSPITAL_ADMIN_TOKEN}`) {
        return json(200, HOSPITAL_ADMIN_SESSION);
      }
      return authorization === `Bearer ${TOKEN}` ? json(200, SESSION) : failure(401, "AUTH_FAILED");
    }
    if (pathname === "/v1/auth/logout") return json(200, { endSessionUrl: null });

    if (pathname.startsWith("/v1/admin/")) {
      if (!authorised(request)) return failure(401, "AUTH_FAILED");
      const path = pathname.slice("/v1/admin/".length);

      if (path === "organisations" && request.method === "GET") return json(200, organisations);
      if (path === "organisations" && request.method === "POST") {
        const body: unknown = await request.json();
        const name =
          typeof body === "object" && body !== null && "name" in body && typeof body.name === "string"
            ? body.name
            : "New organisation";
        const slug =
          typeof body === "object" && body !== null && "slug" in body && typeof body.slug === "string"
            ? body.slug
            : "new-organisation";
        const created = {
          ...organisations[0]!,
          id: "00000000-0000-4000-8000-000000000099",
          zitadelOrgId: null,
          name,
          slug,
          status: "pending",
          provisionedAt: null,
        };
        organisations.push(created);
        return json(201, created);
      }
      if (path === `organisations/${ORG_ID}`) return json(200, organisations[0]);
      if (path === `organisations/${ORG_ID}/hospitals`) {
        return request.method === "GET" ? json(200, [hospital]) : failure(404, "NOT_FOUND");
      }
      if (path === `organisations/${ORG_ID}/memberships`) return json(200, [membership]);
      if (path === `organisations/${ORG_ID}/roles`) return json(200, [role]);
      if (path === `organisations/${ORG_ID}/invitations`) return json(200, []);
      if (path === `organisations/${ORG_ID}/audit`) {
        return json(200, { entries: [auditEntry], nextCursor: null });
      }
      if (path === `hospitals/${HOSPITAL_ID}/domains`) return json(200, []);
      if (path === "invitations/accept" && request.method === "POST") {
        return json(200, { status: "accepted" });
      }
      return failure(404, "NOT_FOUND");
    }

    if (request.method !== "POST") return failure(404, "NOT_FOUND");

    if (pathname === "/v1/auth/login-attempts") {
      const body: unknown = await request.json();
      const returnTo =
        typeof body === "object" && body !== null && "returnTo" in body && typeof body.returnTo === "string"
          ? body.returnTo
          : "/dashboard";
      const state = crypto.randomUUID().replaceAll("-", "").padEnd(43, "x");
      attempts.set(state, returnTo);
      return json(201, {
        authorizationUrl: `http://localhost:3100/api/auth/callback?code=test-code&state=${state}`,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        returnTo,
      });
    }

    if (pathname === "/v1/auth/callback") {
      const body: unknown = await request.json();
      const state =
        typeof body === "object" && body !== null && "state" in body && typeof body.state === "string"
          ? body.state
          : "";
      const returnTo = attempts.get(state);
      const valid =
        typeof body === "object" &&
        body !== null &&
        "code" in body &&
        body.code === "test-code" &&
        returnTo !== undefined;
      if (!valid || returnTo === undefined) return failure(401, "AUTH_FAILED");
      attempts.delete(state);
      return json(200, {
        token: TOKEN,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        returnTo,
      });
    }

    return failure(404, "NOT_FOUND");
  },
});

console.log(`test API listening on ${PORT}`);
