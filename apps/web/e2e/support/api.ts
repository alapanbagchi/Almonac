/**
 * Test double for the authentication API. It lets the browser suite exercise
 * the BFF cookies and redirects without a live identity provider.
 */
const PORT = 3101;
const TOKEN = "A".repeat(43);
const UNAVAILABLE_TOKEN = "C".repeat(43);
const STATE = "B".repeat(43);

const SESSION = {
  user: { id: "00000000-0000-4000-8000-000000000001", email: "doctor@example.test", displayName: "Dev Doctor" },
  memberships: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      organisationId: "00000000-0000-4000-8000-000000000003",
      organisationName: "Almonac",
      hospitalId: "00000000-0000-4000-8000-000000000004",
      hospitalName: "Riverside General",
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: null,
      roles: ["clinician"],
    },
  ],
  permissions: ["clinical.read"],
};

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

function failure(status: number, code: string): Response {
  return json(status, { error: { code, message: "Request failed.", requestId: "test" } });
}

Bun.serve({
  port: PORT,
  async fetch(request) {
    const { pathname } = new URL(request.url);

    if (pathname === "/health") return new Response("ok");
    if (pathname === "/v1/auth/session") {
      const authorization = request.headers.get("authorization");
      if (authorization === `Bearer ${UNAVAILABLE_TOKEN}`) return failure(503, "AUTH_UNAVAILABLE");
      return authorization === `Bearer ${TOKEN}` ? json(200, SESSION) : failure(401, "AUTH_FAILED");
    }
    if (pathname === "/v1/auth/logout") return json(200, { endSessionUrl: null });

    if (request.method !== "POST") return failure(404, "NOT_FOUND");

    if (pathname === "/v1/auth/login-attempts") {
      const body: unknown = await request.json();
      const returnTo =
        typeof body === "object" && body !== null && "returnTo" in body && typeof body.returnTo === "string"
          ? body.returnTo
          : "/dashboard";
      return json(201, {
        authorizationUrl: `http://localhost:3100/api/auth/callback?code=test-code&state=${STATE}`,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        returnTo,
      });
    }

    if (pathname === "/v1/auth/callback") {
      const body: unknown = await request.json();
      const valid =
        typeof body === "object" &&
        body !== null &&
        "code" in body &&
        body.code === "test-code" &&
        "state" in body &&
        body.state === STATE;
      if (!valid) return failure(401, "AUTH_FAILED");
      return json(200, {
        token: TOKEN,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        returnTo: "/dashboard",
      });
    }

    return failure(404, "NOT_FOUND");
  },
});

console.log(`test auth API listening on ${PORT}`);
