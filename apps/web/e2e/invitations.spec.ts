import { expect, test } from "@playwright/test";

import { signIn } from "./support/sign-in";

const TOKEN = "D".repeat(43);

test("creates an account from an invitation link", async ({ page }) => {
  await page.goto(`/invitations/accept#token=${TOKEN}`);

  await expect(page.getByRole("heading", { name: "Accept your invitation" })).toBeVisible();
  await page.getByLabel("Full name").fill("New Doctor");
  await page.getByLabel("Password", { exact: true }).fill("LocalPassword1!");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
});

test("accepts an invitation for the signed-in account", async ({ page }) => {
  await signIn(page);
  await page.goto(`/invitations/accept#token=${TOKEN}`);

  await expect(page.getByRole("status")).toHaveText(/You now have access/);
  await expect(page).toHaveURL(/\/invitations\/accept$/);
});
