import { expect, test } from "@playwright/test";

test("sends a visitor without a session to sign in", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/login\?returnTo=(%2F|\/)dashboard/);
  await expect(page.getByRole("heading", { name: "Sign in to Almonac" })).toBeVisible();
});
