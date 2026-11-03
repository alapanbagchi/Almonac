import { expect, test } from "@playwright/test";

const TOKEN = "D".repeat(43);

test("keeps the invitation token through sign in and accepts it", async ({ page }) => {
  await page.goto(`/invitations/accept#token=${TOKEN}`);

  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await page.getByRole("link", { name: "Continue to sign in" }).click();

  await expect(page.getByRole("status")).toHaveText(/You now have access/);
  await expect(page).toHaveURL(/\/invitations\/accept$/);
});
