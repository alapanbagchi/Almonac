import { expect, test } from "@playwright/test";

import { signIn } from "./support/sign-in";

test("shows organisations, staff and the audit log", async ({ page }) => {
  await signIn(page);

  await page.getByRole("link", { name: "Organizations", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/organizations$/);
  await expect(page.getByRole("heading", { name: "Organizations" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Almonac" })).toBeVisible();
  await expect(page.getByText(/identity provisioned/)).toBeVisible();

  await page.getByRole("link", { name: "Staff and roles" }).click();
  await expect(page).toHaveURL(/\/dashboard\/users\?organisation=/);
  const staff = page.getByRole("table");
  await expect(staff.getByText("Dev Doctor")).toBeVisible();
  await expect(staff.getByText("doctor@example.test")).toBeVisible();

  await page.getByRole("link", { name: "Audit Log" }).click();
  await expect(page).toHaveURL(/\/dashboard\/audit-log/);
  await expect(page.getByText("auth.login")).toBeVisible();
  await expect(page.getByText("test-request")).toBeVisible();
});

test("creates an organisation through a server action", async ({ page }) => {
  await signIn(page);
  await page.goto("/dashboard/organizations");
  await page.getByLabel("Name").fill("North Clinic");
  await page.getByLabel("Slug").fill("north-clinic");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("North Clinic")).toBeVisible();
});
