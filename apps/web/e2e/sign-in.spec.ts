import { expect, test } from "@playwright/test";

const STATE = "B".repeat(43);

test("signs in, shows the member and signs out", async ({ page, context }) => {
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Continue to sign in" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("Dev Doctor")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Select hospital" })).toBeVisible();

  const session = (await context.cookies()).find((cookie) => cookie.name === "__Host-almonac_sid");
  expect(session?.httpOnly).toBe(true);
  expect(session?.secure).toBe(true);
  expect(session?.sameSite).toBe("Lax");

  const chip = page.locator('[data-slot="profile-chip"]');
  const signOut = page.getByRole("button", { name: "Sign out" });
  await expect(async () => {
    if ((await chip.getAttribute("aria-expanded")) !== "true") await chip.click();
    await expect(signOut).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  await signOut.click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?returnTo=/);
});

test.describe("narrow viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("signs out from the navigation sheet", async ({ page, context }) => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Continue to sign in" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    const sheet = page.getByRole("dialog", { name: "Dashboard navigation" });
    await expect(async () => {
      if (!(await sheet.isVisible())) {
        await page.getByRole("button", { name: "Open navigation" }).click();
      }
      await expect(sheet).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15_000 });

    const chip = sheet.locator('[data-slot="profile-chip"]');
    const signOut = sheet.getByRole("button", { name: "Sign out" });
    await expect(async () => {
      if ((await chip.getAttribute("aria-expanded")) !== "true") await chip.click();
      await expect(signOut).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15_000 });
    await signOut.click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await context.cookies()).some((cookie) => cookie.name === "__Host-almonac_sid")).toBe(false);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?returnTo=/);
  });
});

test("refuses a callback that was not started in this browser", async ({ page }) => {
  await page.goto(`/api/auth/callback?code=test-code&state=${STATE}`);

  await expect(page).toHaveURL(/\/login\?error=expired/);
  expect((await page.context().cookies()).some((cookie) => cookie.name === "__Host-almonac_sid")).toBe(false);
});
