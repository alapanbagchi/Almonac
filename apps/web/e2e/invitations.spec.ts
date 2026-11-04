import { expect, test } from "@playwright/test";

const TOKEN = "D".repeat(43);

test("keeps the invitation token through sign in and accepts it", async ({ page }) => {
  await page.goto(`/invitations/accept#token=${TOKEN}`);

  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await page.getByLabel("Work email").fill("doctor@example.test");
  await page.getByLabel("Password", { exact: true }).fill("LocalPassword1!");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("status")).toHaveText(/You now have access/);
  await expect(page).toHaveURL(/\/invitations\/accept$/);
});
