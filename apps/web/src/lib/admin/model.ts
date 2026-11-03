import { z } from "zod";

const id = z.uuid();
const timestamp = z.iso.datetime();
const zitadelId = z.string().min(1).max(255);
const eventMetadata = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

export const organisationSchema = z.object({
  id,
  zitadelOrgId: zitadelId.nullable(),
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(64),
  status: z.enum(["pending", "active", "suspended", "archived"]),
  provisionedAt: timestamp.nullable(),
  createdAt: timestamp,
});

export const hospitalSchema = z.object({
  id,
  organisationId: id,
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(64),
  timezone: z.string().min(1).max(64),
  status: z.enum(["pending", "active", "suspended", "closed"]),
  primaryDomainId: id.nullable(),
  createdAt: timestamp,
});

export const domainSchema = z.object({
  id,
  hospitalId: id,
  domain: z.string().min(1).max(253),
  verifiedAt: timestamp.nullable(),
  retiredAt: timestamp.nullable(),
  createdAt: timestamp,
});

export const membershipSchema = z.object({
  id,
  userId: id,
  email: z.email().max(320),
  displayName: z.string().min(1).max(200),
  organisationId: id,
  hospitalId: id.nullable(),
  status: z.enum(["invited", "active", "suspended", "revoked", "expired"]),
  acceptedAt: timestamp,
  endsAt: timestamp.nullable(),
  roles: z.array(z.string().min(1).max(64)),
});

export const roleSchema = z.object({
  id,
  key: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  scope: z.enum(["platform", "organisation", "hospital"]),
  permissions: z.array(z.string().min(1).max(128)),
});

export const invitationSchema = z.object({
  id,
  email: z.email().max(320),
  organisationId: id,
  hospitalId: id.nullable(),
  kind: z.enum(["new_user", "existing_user"]),
  zitadelSub: zitadelId.nullable(),
  status: z.enum(["pending", "accepted", "revoked", "expired"]),
  expiresAt: timestamp,
  createdAt: timestamp,
  acceptedAt: timestamp.nullable(),
  acceptedByUserId: id.nullable(),
  invitedBy: id,
  roleIds: z.array(id),
});

export const auditEntrySchema = z.object({
  id: z.string().regex(/^\d+$/),
  occurredAt: timestamp,
  actorType: z.enum(["user", "system", "service", "break_glass"]),
  actorUserId: id.nullable(),
  sessionId: id.nullable(),
  organisationId: id.nullable(),
  hospitalId: id.nullable(),
  eventType: z.string().min(3).max(100),
  outcome: z.enum(["success", "failure", "denied"]),
  targetType: z.string().max(50).nullable(),
  targetId: z.string().max(255).nullable(),
  requestId: z.string().max(100).nullable(),
  reasonCode: z.string().max(64).nullable(),
  metadata: eventMetadata,
});

export const createdDomainSchema = z.object({
  domain: domainSchema,
  token: z.string().min(1).max(128),
});

export const auditSchema = z.object({
  entries: z.array(auditEntrySchema),
  nextCursor: z.string().nullable(),
});

export type Organisation = z.infer<typeof organisationSchema>;
export type Hospital = z.infer<typeof hospitalSchema>;
export type Domain = z.infer<typeof domainSchema>;
export type Membership = z.infer<typeof membershipSchema>;
export type Role = z.infer<typeof roleSchema>;
export type Invitation = z.infer<typeof invitationSchema>;
export type AuditEntry = z.infer<typeof auditEntrySchema>;
