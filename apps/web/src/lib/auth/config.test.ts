import { describe, expect, test } from "bun:test";

import { loadWebConfig, WebConfigError } from "./config";

describe("loadWebConfig", () => {
  test("uses loopback development defaults", () => {
    expect(loadWebConfig({})).toEqual({
      apiUrl: "http://localhost:3001",
      publicOrigin: "http://localhost:3000",
      idpOrigin: "http://localhost:8080",
    });
  });

  test("accepts explicit origins", () => {
    expect(
      loadWebConfig({
        API_URL: "https://api.almonac.example",
        AUTH_PUBLIC_ORIGIN: "https://app.almonac.example",
        AUTH_IDP_ORIGIN: "https://id.almonac.example",
        NODE_ENV: "production",
      }),
    ).toEqual({
      apiUrl: "https://api.almonac.example",
      publicOrigin: "https://app.almonac.example",
      idpOrigin: "https://id.almonac.example",
    });
  });

  test("requires every origin in production", () => {
    expect(() =>
      loadWebConfig({
        NODE_ENV: "production",
        AUTH_PUBLIC_ORIGIN: "https://app.example",
        AUTH_IDP_ORIGIN: "https://id.example",
      }),
    ).toThrow(WebConfigError);
    expect(() =>
      loadWebConfig({
        NODE_ENV: "production",
        API_URL: "https://api.example",
        AUTH_IDP_ORIGIN: "https://id.example",
      }),
    ).toThrow(WebConfigError);
    expect(() =>
      loadWebConfig({
        NODE_ENV: "production",
        API_URL: "https://api.example",
        AUTH_PUBLIC_ORIGIN: "https://app.example",
      }),
    ).toThrow(WebConfigError);
  });

  test("rejects plaintext production origins, paths and credentials", () => {
    const idp = { AUTH_IDP_ORIGIN: "https://id.example" };
    for (const env of [
      { NODE_ENV: "production", API_URL: "http://api.example", AUTH_PUBLIC_ORIGIN: "https://app.example", ...idp },
      { NODE_ENV: "production", API_URL: "https://api.example", AUTH_PUBLIC_ORIGIN: "http://app.example", ...idp },
      { NODE_ENV: "production", API_URL: "https://api.example", AUTH_PUBLIC_ORIGIN: "https://app.example", AUTH_IDP_ORIGIN: "http://id.example" },
      { API_URL: "https://api.example/v1", AUTH_PUBLIC_ORIGIN: "https://app.example", ...idp },
      { API_URL: "https://user:pass@api.example", AUTH_PUBLIC_ORIGIN: "https://app.example", ...idp },
      { API_URL: "https://api.example?x=1", AUTH_PUBLIC_ORIGIN: "https://app.example", ...idp },
      { API_URL: "not a url", AUTH_PUBLIC_ORIGIN: "https://app.example", ...idp },
      { API_URL: "https://api.example", AUTH_PUBLIC_ORIGIN: "https://app.example", AUTH_IDP_ORIGIN: "https://id.example/path" },
    ]) {
      expect(() => loadWebConfig(env)).toThrow(WebConfigError);
    }
  });
});
