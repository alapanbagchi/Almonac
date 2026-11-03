import { expect, test } from "@playwright/test";

// Matches HOSPITAL_ADMIN_TOKEN in the test double.
const HOSPITAL_ADMIN_TOKEN = "D".repeat(43);

test("keeps a hospital-scoped manager read-only", async ({ page }) => {
  await page.context().addCookies([
    {
      name: "__Host-almonac_sid",
      value: HOSPITAL_ADMIN_TOKEN,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      expires: Math.floor(Date.now() / 1000) + 3_600,
    },
  ]);

  await page.goto("/dashboard/users");

  await expect(page.getByRole("heading", { name: "Users & Roles" })).toBeVisible();
  await expect(page.getByText("Your account cannot manage staff or roles.")).toBeVisible();
  await expect(page.getByText("Invite someone to")).toHaveCount(0);
});
