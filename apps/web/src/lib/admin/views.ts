import type {
  AuditEntry,
  Domain,
  Hospital,
  Invitation,
  Membership,
  Organisation,
  Role,
} from "./model";
import type { BreakGlassGrant } from "@/lib/break-glass/model";

export interface OrganisationsView {
  organisations: Organisation[];
  canCreate: boolean;
}

export interface HospitalWithDomains extends Hospital {
  domains: Domain[];
}

export interface FacilitiesView {
  organisations: Organisation[];
  selected: Organisation | null;
  canManage: boolean;
  forbidden: boolean;
  hospitals: HospitalWithDomains[];
}

export interface UsersView {
  organisations: Organisation[];
  selected: Organisation | null;
  canManage: boolean;
  forbidden: boolean;
  memberships: Membership[];
  invitations: Invitation[];
  roles: Role[];
  hospitals: Hospital[];
}

export interface AuditView {
  organisations: Organisation[];
  selected: Organisation | null;
  canRead: boolean;
  forbidden: boolean;
  entries: AuditEntry[];
  nextCursor: string | null;
}

export interface BreakGlassView {
  grants: BreakGlassGrant[];
  hospitals: { id: string; name: string }[];
  canRequest: boolean;
  canReview: boolean;
}

export interface CreatedDomain {
  domain: Domain;
  token: string;
}
