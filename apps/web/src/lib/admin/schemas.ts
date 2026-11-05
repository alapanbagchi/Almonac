import { z } from "zod";

/** Server actions receive untrusted arguments, even when TypeScript agrees. */
export const uuid = z.uuid();
export const name = z.string().trim().min(1).max(200);
// Mirrors the API's slug and domain rules so the form fails before the request.
export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
export const reason = z.string().trim().min(1).max(500);
export const domainName = z
  .string()
  .trim()
  .toLowerCase()
  .min(4)
  .max(253)
  .regex(/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/);

export const createOrganisationInput = z.object({ name, slug });

export const createHospitalInput = z.object({
  name,
  slug,
  timezone: z.string().trim().min(1).max(64).default("UTC"),
});

export const createInvitationInput = z.object({
  email: z.email().max(320),
  displayName: z.string().trim().max(200).optional(),
  hospitalId: uuid.nullable(),
  roleIds: z.array(uuid).max(10),
});

export const requestGrantInput = z.object({
  hospitalId: uuid,
  mode: z.literal("emergency"),
  reason: z.string().trim().min(1).max(500),
  durationMinutes: z.number().int().min(1).max(240),
});

export const reviewGrantInput = z.object({
  decision: z.enum(["upheld", "overturned", "escalated"]),
  notes: z.string().trim().max(1000).nullable(),
});

export const onboardingInput = z.object({ name, slug });
