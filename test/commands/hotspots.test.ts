import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(`${FIXTURES_DIR}${name}`, "utf-8")) as T;
}

const sonarGetMock = vi.fn();
const resolveModeMock = vi.fn();
const loadConfigMock = vi.fn();
const resolvePersonalTokenMock = vi.fn();

vi.mock("../../src/sonar.js", () => ({ sonarGet: sonarGetMock }));
vi.mock("../../src/mr.js", () => ({ resolveMode: resolveModeMock }));
vi.mock("../../src/config.js", () => ({ loadConfig: loadConfigMock }));
vi.mock("../../src/auth.js", () => ({
  resolvePersonalToken: resolvePersonalTokenMock,
}));

const { hotspotsCommand } = await import("../../src/commands/hotspots.js");
const { AxiError } = await import("../../src/errors.js");

const CTX = {
  host: "https://sonar.example.com",
  insecure: false,
  projectKey: "example_project_00000000",
  repoPath: "group/example-project",
  token: "fake-token",
};

describe("hotspotsCommand", () => {
  beforeEach(() => {
    sonarGetMock.mockReset();
    resolveModeMock.mockReset();
    loadConfigMock.mockReset();
    resolvePersonalTokenMock.mockReset();
    resolveModeMock.mockResolvedValue({
      mode: { kind: "branch", branch: "main" },
      strippedArgs: [],
    });
    loadConfigMock.mockReturnValue({
      host: CTX.host,
      insecure: false,
      keychainService: "sonar-example",
    });
  });

  it("reads hotspots straight through when the project token is accepted", async () => {
    sonarGetMock.mockResolvedValueOnce(fixture("hotspots-search.json"));

    const output = await hotspotsCommand([], CTX);

    expect(output).toContain("jeton utilisé: projet");
    expect(resolvePersonalTokenMock).not.toHaveBeenCalled();
    expect(sonarGetMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the personal credential on 403 and announces the channel used", async () => {
    sonarGetMock
      .mockRejectedValueOnce(
        new AxiError("Insufficient privileges", "FORBIDDEN"),
      )
      .mockResolvedValueOnce(fixture("hotspots-search.json"));
    resolvePersonalTokenMock.mockResolvedValue("fake-personal-credential");

    const output = await hotspotsCommand([], CTX);

    expect(output).toContain("jeton utilisé: personnel");
    expect(resolvePersonalTokenMock).toHaveBeenCalledWith("sonar-example");
    expect(sonarGetMock).toHaveBeenCalledTimes(2);
    const secondCallOptions = sonarGetMock.mock.calls[1][2];
    expect(secondCallOptions.token).toBe("fake-personal-credential");
  });

  it("does not swallow a non-403 error", async () => {
    sonarGetMock.mockRejectedValueOnce(new AxiError("boom", "NETWORK_ERROR"));

    await expect(hotspotsCommand([], CTX)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
    expect(resolvePersonalTokenMock).not.toHaveBeenCalled();
  });

  it("propagates the guided AxiError when no personal credential is in the Keychain", async () => {
    sonarGetMock.mockRejectedValueOnce(
      new AxiError("Insufficient privileges", "FORBIDDEN"),
    );
    resolvePersonalTokenMock.mockRejectedValue(
      new AxiError(
        "Aucun jeton personnel SonarQube dans le Trousseau",
        "AUTH_REQUIRED",
        ["Guide de création dans SonarQube > My Account > Security"],
      ),
    );

    await expect(hotspotsCommand([], CTX)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("reports an empty result explicitly", async () => {
    sonarGetMock.mockResolvedValueOnce(fixture("hotspots-search-empty.json"));

    const output = await hotspotsCommand([], CTX);

    expect(output).toContain("aucun hotspot à revoir");
  });
});
