import { describe, expect, test } from "bun:test";

import type { AuthSession } from "./api";
import { toSessionHospitals, toSessionUser } from "./session-view";

const session: AuthSession = {
  user: { id: "u1", email: "doctor@example.test", displayName: "Dev Doctor" },
  memberships: [
    {
      id: "m1",
      organisationId: "o1",
      organisationName: "Almonac",
      hospitalId: "h1",
      hospitalName: "Riverside General",
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: null,
      roles: ["clinician"],
    },
    {
      id: "m2",
      organisationId: "o1",
      organisationName: "Almonac",
      hospitalId: "h1",
      hospitalName: "Riverside General",
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: null,
      roles: ["auditor"],
    },
    {
      id: "m3",
      organisationId: "o1",
      organisationName: "Almonac",
      hospitalId: null,
      hospitalName: null,
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: null,
      roles: ["org_admin"],
    },
  ],
  permissions: ["clinical.read"],
};

describe("session view", () => {
  test("deduplicates hospitals and keeps organisation context", () => {
    expect(toSessionHospitals(session)).toEqual([
      {
        id: "h1",
        name: "Riverside General",
        type: "Almonac",
        logo: "/hospital/logo.svg",
      },
    ]);
  });

  test("formats every active role once", () => {
    expect(toSessionUser(session)).toEqual({
      name: "Dev Doctor",
      designation: "Clinician · Auditor · Organisation Administrator",
      avatar: "/profile/avatar.svg",
    });
  });

  test("falls back when a member has no role", () => {
    expect(
      toSessionUser({
        ...session,
        memberships: [{ ...session.memberships[0], roles: [] }],
      }).designation,
    ).toBe("Member");
  });
});
