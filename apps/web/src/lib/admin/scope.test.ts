import { describe, expect, test } from "bun:test";

import { hasOrganisationScope } from "./scope";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const HOSPITAL = "00000000-0000-4000-8000-000000000003";

describe("organisation scope", () => {
  test("accepts a permission granted on the organisation membership", () => {
    expect(
      hasOrganisationScope(
        ["membership.manage"],
        [{ organisationId: ORG, hospitalId: null }],
        "membership.manage",
        ORG,
      ),
    ).toBe(true);
  });

  test("rejects a permission granted only at a hospital", () => {
    expect(
      hasOrganisationScope(
        ["membership.manage"],
        [{ organisationId: ORG, hospitalId: HOSPITAL }],
        "membership.manage",
        ORG,
      ),
    ).toBe(false);
  });

  test("rejects an organisation membership in a different organisation", () => {
    expect(
      hasOrganisationScope(
        ["membership.manage"],
        [{ organisationId: OTHER_ORG, hospitalId: null }],
        "membership.manage",
        ORG,
      ),
    ).toBe(false);
  });

  test("rejects a missing permission even with an organisation membership", () => {
    expect(
      hasOrganisationScope(
        ["clinical.read"],
        [{ organisationId: ORG, hospitalId: null }],
        "membership.manage",
        ORG,
      ),
    ).toBe(false);
  });

  test("lets a platform administrator manage any organisation", () => {
    expect(
      hasOrganisationScope(
        ["platform.manage"],
        [{ organisationId: OTHER_ORG, hospitalId: null }],
        "membership.manage",
        ORG,
      ),
    ).toBe(true);
  });
});
