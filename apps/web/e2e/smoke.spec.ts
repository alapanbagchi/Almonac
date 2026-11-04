import { expect, test } from "@playwright/test";

test("serves the public landing page", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: "Almonac home" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Sign in/ })).toBeVisible();
});

test("stamps every server-rendered script with the nonce", async ({ page }) => {
  const response = await page.goto("/login");
  const policy = response?.headers()["content-security-policy"] ?? "";
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).toContain("script-src 'self' 'nonce-");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(response?.headers()["x-frame-options"]).toBe("DENY");

  // Read the response itself: Next.js adds development scripts after
  // hydration, and 'strict-dynamic' trusts scripts that a nonced script loads.
  const html = await (await page.request.get("/login")).text();
  const scripts = html.match(/<script[^>]*>/g) ?? [];
  expect(scripts.length).toBeGreaterThan(0);
  expect(scripts.filter((tag) => !tag.includes("nonce="))).toEqual([]);
});
