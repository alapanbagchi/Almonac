import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Continue to sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("refuses cross-origin and oversized administration calls", async ({ page }) => {
  await signIn(page);
  const body = { name: "North Clinic", slug: "north-clinic" };

  const crossOrigin = await page.request.post("/api/admin/organisations", {
    headers: { origin: "https://evil.example" },
    data: body,
  });
  expect(crossOrigin.status()).toBe(403);

  const oversized = await page.request.post("/api/admin/organisations", {
    headers: { origin: "http://localhost:3100" },
    data: { ...body, name: "x".repeat(9_000) },
  });
  expect(oversized.status()).toBe(413);
});

test("refuses an administration call without a session", async ({ request }) => {
  const response = await request.get("/api/admin/organisations");
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ error: { code: "AUTH_REQUIRED" } });
});

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

test("creates an organisation through the BFF", async ({ page }) => {
  await signIn(page);
  await page.goto("/dashboard/organizations");
  await page.getByLabel("Name").fill("North Clinic");
  await page.getByLabel("Slug").fill("north-clinic");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("North Clinic")).toBeVisible();
});
