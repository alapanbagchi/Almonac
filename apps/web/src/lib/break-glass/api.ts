import "server-only";

import { z } from "zod";

import {
  grantListSchema,
  grantSchema,
  reviewSchema,
  type GrantRequest,
  type ReviewRequest,
} from "./model";

const errorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }),
});

export class BreakGlassApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = "Break-glass request failed",
  ) {
    super(message);
    this.name = "BreakGlassApiError";
  }
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type GrantPage = z.infer<typeof grantListSchema>;

/** Server-only client for the break-glass endpoints. */
export function createBreakGlassApi({
  baseUrl,
  timeoutMs = 8_000,
  fetch: request = globalThis.fetch,
}: {
  baseUrl: string;
  timeoutMs?: number;
  fetch?: Fetch;
}) {
  async function call<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
    let response: Response;
    try {
      response = await request(`${baseUrl}${path}`, {
        ...init,
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new BreakGlassApiError(0, "BREAK_GLASS_UNAVAILABLE");
    }

    const body = await readJson(response);
    if (!response.ok) {
      const parsed = errorEnvelope.safeParse(body);
      throw new BreakGlassApiError(
        response.status,
        parsed.success ? parsed.data.error.code : "BREAK_GLASS_UNAVAILABLE",
      );
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new BreakGlassApiError(502, "BREAK_GLASS_INVALID_RESPONSE");
    return parsed.data;
  }

  function jsonInit(method: string, token: string, body?: unknown): RequestInit {
    return {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
    };
  }

  /** Load every page so the screen never silently hides grants after the first page. */
  async function allGrants(token: string, hospitalId: string | null): Promise<GrantPage> {
    const items: GrantPage["items"] = [];
    let offset = 0;
    for (;;) {
      const params = new URLSearchParams();
      if (hospitalId !== null) params.set("hospitalId", hospitalId);
      if (offset > 0) params.set("offset", String(offset));
      const query = params.toString();
      const page = await call(
        `/v1/break-glass/grants${query === "" ? "" : `?${query}`}`,
        jsonInit("GET", token),
        grantListSchema,
      );
      items.push(...page.items);
      if (page.nextOffset === null || page.nextOffset <= offset) {
        return { items, nextOffset: null };
      }
      offset = page.nextOffset;
    }
  }

  return {
    listGrants(token: string, hospitalId: string | null): Promise<GrantPage> {
      return allGrants(token, hospitalId);
    },

    requestGrant(token: string, body: GrantRequest) {
      return call("/v1/break-glass/grants", jsonInit("POST", token, body), grantSchema);
    },

    activateGrant(token: string, grantId: string) {
      return call(
        `/v1/break-glass/grants/${grantId}/activate`,
        jsonInit("POST", token),
        grantSchema,
      );
    },

    revokeGrant(token: string, grantId: string, reason: string) {
      return call(
        `/v1/break-glass/grants/${grantId}/revoke`,
        jsonInit("POST", token, { reason }),
        grantSchema,
      );
    },

    reviewGrant(token: string, grantId: string, body: ReviewRequest) {
      return call(
        `/v1/break-glass/grants/${grantId}/review`,
        jsonInit("POST", token, body),
        reviewSchema,
      );
    },
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export type BreakGlassApi = ReturnType<typeof createBreakGlassApi>;
