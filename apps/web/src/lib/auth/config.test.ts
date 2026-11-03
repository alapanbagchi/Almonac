import { describe, expect, test } from "bun:test";

import { loadWebConfig, WebConfigError } from "./config";

describe("loadWebConfig", () => {
  test("uses loopback development defaults", () => {
    expect(loadWebConfig({})).toEqual({
      apiUrl: "http://localhost:3001",
      publicOrigin: "http://localhost:3000",
    });
  });

  test("accepts explicit origins", () => {
    expect(
      loadWebConfig({
        API_URL: "https://api.almonac.example",
        AUTH_PUBLIC_ORIGIN: "https://app.almonac.example",
        NODE_ENV: "production",
      }),
    ).toEqual({
      apiUrl: "https://api.almonac.example",
      publicOrigin: "https://app.almonac.example",
    });
  });

  test("requires both origins in production", () => {
    expect(() =>
      loadWebConfig({ NODE_ENV: "production", AUTH_PUBLIC_ORIGIN: "https://app.example" }),
    ).toThrow(WebConfigError);
    expect(() =>
      loadWebConfig({ NODE_ENV: "production", API_URL: "https://api.example" }),
    ).toThrow(WebConfigError);
  });

  test("rejects plaintext production origins, paths and credentials", () => {
    for (const env of [
      { NODE_ENV: "production", API_URL: "http://api.example", AUTH_PUBLIC_ORIGIN: "https://app.example" },
      { NODE_ENV: "production", API_URL: "https://api.example", AUTH_PUBLIC_ORIGIN: "http://app.example" },
      { API_URL: "https://api.example/v1", AUTH_PUBLIC_ORIGIN: "https://app.example" },
      { API_URL: "https://user:pass@api.example", AUTH_PUBLIC_ORIGIN: "https://app.example" },
      { API_URL: "https://api.example?x=1", AUTH_PUBLIC_ORIGIN: "https://app.example" },
      { API_URL: "not a url", AUTH_PUBLIC_ORIGIN: "https://app.example" },
    ]) {
      expect(() => loadWebConfig(env)).toThrow(WebConfigError);
    }
  });
});
