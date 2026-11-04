import { expect, test } from "@playwright/test";

test("verifies the email, signs in and creates the first organisation", async ({ page }) => {
  await page.goto("/signup");

  await page.getByLabel("Full name").fill("Ada Lovelace");
  await page.getByLabel("Work email").fill("ada@example.test");
  await page.getByLabel("Password", { exact: true }).fill("LocalPassword1!");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/signup\/check-email$/);
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  await page.goto(`/verify-email#token=${"A".repeat(43)}`);
  await expect(page.getByText("Your email is verified")).toBeVisible();
  await page.getByRole("link", { name: "Continue to sign in" }).click();

  await expect(page).toHaveURL(/\/login\?verified=1&returnTo=/);
  await expect(
    page.getByText("Your email is verified. Sign in to continue."),
  ).toBeVisible();
  await page.getByLabel("Work email").fill("ada@example.test");
  await page.getByLabel("Password", { exact: true }).fill("LocalPassword1!");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/onboarding\/organisation$/);
  await expect(
    page.getByRole("button", { name: "Create organisation" }),
  ).toBeEnabled();
  await page.getByLabel("Organisation name").fill("North Clinic");
  await expect(page.getByLabel("Organisation address")).toHaveValue(
    "north-clinic",
  );
  await page.getByRole("button", { name: "Create organisation" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("Dev Doctor")).toBeVisible();
});

test("rejects an expired verification link", async ({ page }) => {
  await page.goto(`/verify-email#token=${"X".repeat(43)}`);

  await expect(
    page.getByText("This verification link is not valid or has expired."),
  ).toBeVisible();
});
