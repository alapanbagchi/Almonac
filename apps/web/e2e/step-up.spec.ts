import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Continue to sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

function sessionCookie(cookies: { name: string; value: string }[]) {
  return cookies.find((cookie) => cookie.name === "__Host-almonac_sid")?.value ?? null;
}

test("starts a step-up check and rotates the session", async ({ page, context }) => {
  await signIn(page);
  const before = sessionCookie(await context.cookies());
  expect(before).not.toBeNull();

  const started = await page.request.post("/api/auth/step-up", {
    form: { returnTo: "/dashboard" },
    headers: { origin: "http://localhost:3100" },
    maxRedirects: 0,
  });
  expect(started.status()).toBe(303);

  const authorizationUrl = started.headers()["location"];
  expect(authorizationUrl).toContain("/api/auth/callback?code=test-code&state=");
  const binding = (await context.cookies()).find(
    (cookie) => cookie.name === "__Host-almonac_login",
  );
  expect(binding?.value).toBe(new URL(authorizationUrl!).searchParams.get("state"));

  const callback = await page.request.get(authorizationUrl!, { maxRedirects: 0 });
  expect(callback.status()).toBe(303);
  expect(callback.headers()["location"]).toBe("http://localhost:3100/dashboard");

  const after = sessionCookie(await context.cookies());
  expect(after).not.toBeNull();
  expect(after).not.toBe(before);
});

test("refuses a step-up check from another origin", async ({ page }) => {
  await signIn(page);

  const response = await page.request.post("/api/auth/step-up", {
    form: { returnTo: "/dashboard" },
    headers: { origin: "https://evil.example" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(403);
});

test("sends a member without a session to sign in", async ({ request }) => {
  const response = await request.post("/api/auth/step-up", {
    form: { returnTo: "/dashboard" },
    headers: { origin: "http://localhost:3100" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  expect(response.headers()["location"]).toBe(
    "http://localhost:3100/login?returnTo=%2Fdashboard",
  );
});
