import { expect, test } from "@playwright/test";

test("serves the public landing page", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: "Almonac home" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Sign up/ })).toBeVisible();
});
