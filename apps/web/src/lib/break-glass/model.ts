import { z } from "zod";

const id = z.uuid();
const timestamp = z.iso.datetime();

export const grantSchema = z.object({
  id,
  organisationId: id,
  hospitalId: id,
  userId: id,
  approvedBy: id.nullable(),
  approvalMode: z.enum(["pre_approved", "emergency"]),
  reason: z.string(),
  accessLevel: z.enum(["read_only"]),
  status: z.enum(["approved", "active", "revoked", "expired"]),
  startsAt: timestamp,
  endsAt: timestamp,
  approvedAt: timestamp,
  activatedAt: timestamp.nullable(),
  revokedAt: timestamp.nullable(),
  expiredAt: timestamp.nullable(),
  createdAt: timestamp,
});

export const reviewSchema = z.object({
  id,
  grantId: id,
  reviewerId: id,
  reviewedAt: timestamp,
  decision: z.enum(["upheld", "overturned", "escalated"]),
  notes: z.string().nullable(),
});

export const grantListSchema = z.array(grantSchema);

export type BreakGlassGrant = z.infer<typeof grantSchema>;
export type BreakGlassReview = z.infer<typeof reviewSchema>;

export type GrantRequest = {
  hospitalId: string;
  mode: "emergency";
  reason: string;
  durationMinutes: number;
};

export type ReviewRequest = {
  decision: "upheld" | "overturned" | "escalated";
  notes: string | null;
};
