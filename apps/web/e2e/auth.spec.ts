import { expect, test } from "@playwright/test";

test("sends a visitor without a session to sign in", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/login\?returnTo=(%2F|\/)dashboard/);
  await expect(page.getByRole("heading", { name: "Sign in to Almonac" })).toBeVisible();
});

test("fails closed when the session service is unavailable", async ({ page, context }) => {
  await context.addCookies([
    {
      name: "__Host-almonac_sid",
      value: "C".repeat(43),
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);

  await page.goto("/dashboard");

  await expect(
    page.getByRole("heading", { name: "We could not load your workspace" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/dashboard");
  expect((await context.cookies()).some((cookie) => cookie.name === "__Host-almonac_sid")).toBe(true);
});
