import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { createAdminApi } = await import("./api");

const organisation = (id: string, name: string) => ({
  id,
  zitadelOrgId: null,
  name,
  slug: name.toLowerCase(),
  status: "active",
  provisionedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("administrative list loading", () => {
  test("follows next offsets until the list is complete", async () => {
    const urls: string[] = [];
    const api = createAdminApi({
      baseUrl: "http://api.test",
      fetch: async (input) => {
        const url = new URL(String(input));
        urls.push(url.pathname + url.search);
        return url.searchParams.get("offset") === "1"
          ? jsonResponse({
              items: [organisation("00000000-0000-4000-8000-000000000002", "Second")],
              nextOffset: null,
            })
          : jsonResponse({
              items: [organisation("00000000-0000-4000-8000-000000000001", "First")],
              nextOffset: 1,
            });
      },
    });

    const page = await api.listOrganisations("token");

    expect(page.items.map((item) => item.name)).toEqual(["First", "Second"]);
    expect(page.nextOffset).toBeNull();
    expect(urls).toEqual([
      "/v1/admin/organisations?limit=100",
      "/v1/admin/organisations?limit=100&offset=1",
    ]);
  });
});
