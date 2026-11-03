import type { AuthSession } from "./api";

export const HOSPITAL_LOGO = "/hospital/logo.svg";
export const PROFILE_AVATAR = "/profile/avatar.svg";

export interface SessionHospital {
  id: string;
  name: string;
  type: string;
  logo: string;
}

export interface SessionUser {
  name: string;
  designation: string;
  avatar: string;
}

const ROLE_LABELS: Record<string, string> = {
  auditor: "Auditor",
  break_glass_approver: "Break-glass Approver",
  clinician: "Clinician",
  hospital_admin: "Hospital Administrator",
  org_admin: "Organisation Administrator",
  platform_admin: "Platform Administrator",
};

export function toSessionUser(session: AuthSession): SessionUser {
  const roles = [...new Set(session.memberships.flatMap((membership) => membership.roles))];
  return {
    name: session.user.displayName,
    designation: roles.length === 0 ? "Member" : roles.map(roleLabel).join(" · "),
    avatar: PROFILE_AVATAR,
  };
}

export function toSessionHospitals(session: AuthSession): SessionHospital[] {
  const seen = new Set<string>();
  return session.memberships.flatMap((membership) => {
    if (
      membership.hospitalId === null ||
      membership.hospitalName === null ||
      seen.has(membership.hospitalId)
    ) {
      return [];
    }
    seen.add(membership.hospitalId);
    return [
      {
        id: membership.hospitalId,
        name: membership.hospitalName,
        type: membership.organisationName,
        logo: HOSPITAL_LOGO,
      },
    ];
  });
}

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.replaceAll("_", " ");
}
