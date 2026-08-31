import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(`${FIXTURES_DIR}${name}`, "utf-8")) as T;
}

const sonarGetMock = vi.fn();

vi.mock("../../src/sonar.js", () => ({ sonarGet: sonarGetMock }));

const { analysisCommand } = await import("../../src/commands/analysis.js");

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
});
