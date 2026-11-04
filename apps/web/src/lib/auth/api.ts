import "server-only";

import { z } from "zod";

import { normaliseReturnTo } from "./return-to";

const errorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }),
});

const loginStart = z.object({
  authorizationUrl: z.string().url(),
  expiresAt: z.string().datetime(),
});

const loginResult = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.string().datetime(),
  returnTo: z.string(),
});

const session = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.string(),
    displayName: z.string(),
  }),
  memberships: z.array(
    z.object({
      id: z.uuid(),
      organisationId: z.uuid(),
      organisationName: z.string(),
      hospitalId: z.uuid().nullable(),
      hospitalName: z.string().nullable(),
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime().nullable(),
      roles: z.array(z.string()),
    }),
  ),
  permissions: z.array(z.string()),
});

const logoutResult = z.object({ endSessionUrl: z.string().url().nullable() });

export type AuthSession = z.infer<typeof session>;
export type LoginStart = { authorizationUrl: string; expiresAt: Date };
export type LoginResult = { token: string; expiresAt: Date; returnTo: string };

export class AuthApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = "Authentication request failed",
  ) {
    super(message);
    this.name = "AuthApiError";
  }
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface AuthApiOptions {
  baseUrl: string;
  timeoutMs?: number;
  fetch?: Fetch;
}

/** Server-only client for the authentication endpoints. */
export function createAuthApi({
  baseUrl,
  timeoutMs = 5_000,
  fetch: request = globalThis.fetch,
}: AuthApiOptions) {
  async function call<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
    let response: Response;
    try {
      response = await request(`${baseUrl}${path}`, {
        ...init,
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new AuthApiError(0, "AUTH_UNAVAILABLE");
    }

    const body = await readJson(response);
    if (!response.ok) {
      const parsed = errorEnvelope.safeParse(body);
      throw new AuthApiError(
        response.status,
        parsed.success ? parsed.data.error.code : "AUTH_UNAVAILABLE",
      );
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new AuthApiError(502, "AUTH_INVALID_RESPONSE");
    return parsed.data;
  }

  return {
    async startLogin(returnTo: string): Promise<LoginStart> {
      const data = await call(
        "/v1/auth/login-attempts",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ returnTo }),
        },
        loginStart,
      );
      return { authorizationUrl: data.authorizationUrl, expiresAt: new Date(data.expiresAt) };
    },

    async startStepUp(token: string, returnTo: string): Promise<LoginStart> {
      const data = await call(
        "/v1/auth/step-up-attempts",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ returnTo }),
        },
        loginStart,
      );
      return { authorizationUrl: data.authorizationUrl, expiresAt: new Date(data.expiresAt) };
    },

    async completeLogin(code: string, state: string, token: string | null = null): Promise<LoginResult> {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (token !== null) headers.authorization = `Bearer ${token}`;
      const data = await call(
        "/v1/auth/callback",
        {
          method: "POST",
          headers,
          body: JSON.stringify({ code, state }),
        },
        loginResult,
      );
      return {
        token: data.token,
        expiresAt: new Date(data.expiresAt),
        returnTo: normaliseReturnTo(data.returnTo),
      };
    },

    async getSession(token: string): Promise<AuthSession | null> {
      try {
        return await call(
          "/v1/auth/session",
          { headers: { authorization: `Bearer ${token}` } },
          session,
        );
      } catch (error) {
        if (error instanceof AuthApiError && error.status === 401) return null;
        throw error;
      }
    },

    async logout(token: string): Promise<string | null> {
      const data = await call(
        "/v1/auth/logout",
        { method: "POST", headers: { authorization: `Bearer ${token}` } },
        logoutResult,
      );
      return data.endSessionUrl;
    },
  };
}

export type AuthApi = ReturnType<typeof createAuthApi>;

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
