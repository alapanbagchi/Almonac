import "server-only";

import { z } from "zod";

const organisation = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(64),
  status: z.string(),
});

const errorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }),
});

export class OnboardingApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "OnboardingApiError";
  }
}

/** The first-organisation call; the session token stays on this server. */
export async function createFirstOrganisation(
  apiUrl: string,
  token: string,
  input: { name: string; slug: string },
): Promise<z.infer<typeof organisation>> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/v1/onboarding/organisation`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new OnboardingApiError(0, "ONBOARDING_UNAVAILABLE");
  }

  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = errorEnvelope.safeParse(payload);
    throw new OnboardingApiError(
      response.status,
      parsed.success ? parsed.data.error.code : "ONBOARDING_FAILED",
    );
  }

  const parsed = organisation.safeParse(payload);
  if (!parsed.success) throw new OnboardingApiError(502, "ONBOARDING_INVALID_RESPONSE");
  return parsed.data;
}
