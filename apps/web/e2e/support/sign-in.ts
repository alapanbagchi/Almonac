import type { Page } from "@playwright/test";

/** Sign in through the first-party credential form. */
export async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Work email").fill("doctor@example.test");
  await page.getByLabel("Password", { exact: true }).fill("LocalPassword1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}
