import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(`${FIXTURES_DIR}${name}`, "utf-8")) as T;
}

const sonarGetMock = vi.fn();
const loadConfigMock = vi.fn();
const resolvePersonalTokenMock = vi.fn();

vi.mock("../../src/sonar.js", () => ({ sonarGet: sonarGetMock }));
vi.mock("../../src/config.js", () => ({ loadConfig: loadConfigMock }));
vi.mock("../../src/auth.js", () => ({
  resolvePersonalToken: resolvePersonalTokenMock,
}));

const { analysisCommand } = await import("../../src/commands/analysis.js");
const { AxiError } = await import("../../src/errors.js");

const CTX = {
  host: "https://sonar.example.com",
  insecure: false,
  projectKey: "example_project_00000000",
  repoPath: "group/example-project",
  token: "fake-token",
};

describe("analysisCommand", () => {
  beforeEach(() => {
    sonarGetMock.mockReset();
    loadConfigMock.mockReset();
    resolvePersonalTokenMock.mockReset();
    loadConfigMock.mockReturnValue({
      host: CTX.host,
      insecure: false,
      keychainService: "sonar-example",
    });
  });

  it("reports a running analysis from the queue", async () => {
    sonarGetMock.mockResolvedValueOnce(fixture("ce-component-running.json"));

    const output = await analysisCommand([], CTX);

    expect(output).toContain("running: true");
    expect(output).toContain("queue_length: 1");
  });

  it("reports the last successful task when the queue is idle", async () => {
    sonarGetMock.mockResolvedValueOnce(fixture("ce-component-idle.json"));

    const output = await analysisCommand([], CTX);

    expect(output).toContain("running: false");
    expect(output).toContain("last_status: SUCCESS");
  });

  it("surfaces the error message of a failed last task", async () => {
    sonarGetMock.mockResolvedValueOnce(fixture("ce-component-failed.json"));

    const output = await analysisCommand([], CTX);

    expect(output).toContain("last_status: FAILED");
    expect(output).toContain("Analysis report processing failed");
  });

  it("falls back to the personal credential on 403, like hotspots", async () => {
    sonarGetMock
      .mockRejectedValueOnce(
        new AxiError("Insufficient privileges", "FORBIDDEN"),
      )
      .mockResolvedValueOnce(fixture("ce-component-idle.json"));
    resolvePersonalTokenMock.mockResolvedValue("fake-personal-credential");

    const output = await analysisCommand([], CTX);

    expect(output).toContain("last_status: SUCCESS");
    expect(output).toContain("jeton utilisé: personnel");
    expect(resolvePersonalTokenMock).toHaveBeenCalledWith("sonar-example");
    expect(sonarGetMock).toHaveBeenCalledTimes(2);
    const secondCallOptions = sonarGetMock.mock.calls[1][2];
    expect(secondCallOptions.token).toBe("fake-personal-credential");
  });

  it("does not swallow a non-403 error", async () => {
    sonarGetMock.mockRejectedValueOnce(new AxiError("boom", "NETWORK_ERROR"));

    await expect(analysisCommand([], CTX)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
    expect(resolvePersonalTokenMock).not.toHaveBeenCalled();
  });
});
