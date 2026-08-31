import { describe, expect, it } from "vitest";
import { AxiError, mapNetworkError, mapSonarError } from "../src/errors.js";

describe("mapSonarError", () => {
  it("surfaces errors[0].msg from the Sonar body", () => {
    const error = mapSonarError(
      404,
      {
        errors: [{ msg: "Component key 'example_project_00000000' not found" }],
      },
      "measures/component",
    );

    expect(error).toBeInstanceOf(AxiError);
    expect(error.message).toBe(
      "Component key 'example_project_00000000' not found",
    );
    expect(error.code).toBe("NOT_FOUND");
  });

  it("points a 401 at the context cache, since a rotated credential is cached", () => {
    const help = mapSonarError(401, {}, "issues/search").suggestions.join(" ");

    expect(help).toContain("context-cache.json");
  });

  it("maps 401 to AUTH_REQUIRED with a token hint", () => {
    const error = mapSonarError(
      401,
      { errors: [{ msg: "Unauthorized" }] },
      "issues/search",
    );

    expect(error.code).toBe("AUTH_REQUIRED");
    expect(error.suggestions.length).toBeGreaterThan(0);
  });

  it("maps 403 to FORBIDDEN and points at the personal token", () => {
    const error = mapSonarError(
      403,
      { errors: [{ msg: "Insufficient privileges" }] },
      "hotspots/search",
    );

    expect(error.code).toBe("FORBIDDEN");
    expect(error.message).toBe("Insufficient privileges");
    expect(error.suggestions.join(" ")).toMatch(/personnel|personal/i);
  });

  it("maps 400 to VALIDATION_ERROR", () => {
    expect(
      mapSonarError(400, { errors: [{ msg: "bad param" }] }, "issues/search")
        .code,
    ).toBe("VALIDATION_ERROR");
  });

  it("maps 429 to RATE_LIMITED", () => {
    expect(mapSonarError(429, {}, "issues/search").code).toBe("RATE_LIMITED");
  });

  it("falls back to the status and path when the body carries no message", () => {
    const error = mapSonarError(500, "<html>oops</html>", "ce/component");

    expect(error.code).toBe("UNKNOWN");
    expect(error.message).toContain("500");
    expect(error.message).toContain("ce/component");
  });
});

describe("mapNetworkError", () => {
  it("suggests the insecure setting on a self-signed certificate", () => {
    const cause = Object.assign(new Error("self-signed certificate"), {
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
    const error = mapNetworkError(
      Object.assign(new TypeError("fetch failed"), { cause }),
      "https://sonar.example.com",
    );

    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.suggestions.join(" ")).toContain("insecure");
    expect(error.suggestions.join(" ")).toContain("sonarqube-axi setup");
  });

  it("survives a throwable that is not an object", () => {
    const error = mapNetworkError("boom", "https://sonar.example.com");

    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.message).toContain("boom");
  });

  it("survives a null throwable", () => {
    expect(mapNetworkError(null, "https://sonar.example.com").code).toBe(
      "NETWORK_ERROR",
    );
  });

  it("reports an unreachable host without the certificate hint", () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    const error = mapNetworkError(
      Object.assign(new TypeError("fetch failed"), { cause }),
      "https://sonar.example.com",
    );

    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.message).toContain("https://sonar.example.com");
    expect(error.suggestions.join(" ")).not.toContain("insecure");
  });
});
