import { expect, test } from "@playwright/test";

import { signIn } from "./support/sign-in";

test("needs a fresh identity check before emergency access", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Break Glass", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/break-glass$/);
  await expect(page.getByRole("heading", { name: "Break Glass" })).toBeVisible();
  await expect(page.getByText("No grants yet.")).toBeVisible();

  await page.getByLabel("Hospital", { exact: true }).selectOption({ label: "Riverside General" });
  await page.getByLabel("Reason", { exact: true }).fill("Cover the night shift after a network outage");
  await page.getByRole("button", { name: "Request emergency access" }).click();

  await expect(page.getByRole("heading", { name: "Confirm your identity" })).toBeVisible();
  await page.getByLabel("Password").fill("LocalPassword1!");
  await page.getByRole("button", { name: "Verify again" }).click();
  await expect(page).toHaveURL(/\/dashboard\/break-glass$/);

  await page.getByLabel("Hospital", { exact: true }).selectOption({ label: "Riverside General" });
  await page.getByLabel("Reason", { exact: true }).fill("Cover the night shift after a network outage");
  await page.getByRole("button", { name: "Request emergency access" }).click();

  await expect(page.getByText("active", { exact: true })).toBeVisible();
  await expect(page.getByText("Cover the night shift after a network outage")).toBeVisible();

  await page.getByPlaceholder("Reason for ending access").fill("The shift handover is complete");
  await page.getByRole("button", { name: "End access" }).click();
  await expect(page.getByText("revoked", { exact: true })).toBeVisible();
});
