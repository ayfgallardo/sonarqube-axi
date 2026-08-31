import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(`${FIXTURES_DIR}${name}`, "utf-8")) as T;
}

const sonarGetMock = vi.fn();
const resolveModeMock = vi.fn();

vi.mock("../../src/sonar.js", () => ({ sonarGet: sonarGetMock }));
vi.mock("../../src/mr.js", () => ({ resolveMode: resolveModeMock }));

const { qgCommand } = await import("../../src/commands/qg.js");

const CTX = {
  host: "https://sonar.example.com",
  insecure: false,
  projectKey: "example_project_00000000",
  repoPath: "group/example-project",
  token: "fake-token",
};

describe("qgCommand", () => {
  beforeEach(() => {
    sonarGetMock.mockReset();
    resolveModeMock.mockReset();
  });

  it("reads a plain OK gate as OK, not non-concluant", async () => {
    resolveModeMock.mockResolvedValue({
      mode: { kind: "branch", branch: "main" },
      strippedArgs: [],
    });
    sonarGetMock
      .mockResolvedValueOnce(fixture("project-status-ok.json"))
      .mockResolvedValueOnce(fixture("measures-new-code.json"));

    const output = await qgCommand([], CTX);

    expect(output).toContain("verdict: OK");
    expect(output).not.toContain("non concluant");
    expect(output).toContain("new_lines: 37");
  });

  it("marks an ignoredConditions green gate as non-concluant, never a plain OK", async () => {
    resolveModeMock.mockResolvedValue({
      mode: { kind: "mr", mrIid: "42" },
      strippedArgs: [],
    });
    sonarGetMock
      .mockResolvedValueOnce(fixture("project-status-ignored-conditions.json"))
      .mockResolvedValueOnce(fixture("measures-new-code.json"));

    const output = await qgCommand([], CTX);

    expect(output).toContain("non concluant");
    expect(output).not.toMatch(/verdict: OK\b/);
    expect(output).toContain("new_lines: 37");
  });

  it("defaults to MR mode and sends pullRequest, not branch", async () => {
    resolveModeMock.mockResolvedValue({
      mode: { kind: "mr", mrIid: "42" },
      strippedArgs: [],
    });
    sonarGetMock
      .mockResolvedValueOnce(fixture("project-status-ok.json"))
      .mockResolvedValueOnce(fixture("measures-new-code.json"));

    await qgCommand([], CTX);

    expect(sonarGetMock).toHaveBeenNthCalledWith(
      1,
      "qualitygates/project_status",
      expect.objectContaining({
        projectKey: CTX.projectKey,
        pullRequest: "42",
      }),
      expect.anything(),
    );
  });

  it("labels a branch-mode red gate as non-conclusive for a MR and shows the period", async () => {
    resolveModeMock.mockResolvedValue({
      mode: { kind: "branch", branch: "main" },
      strippedArgs: [],
    });
    sonarGetMock
      .mockResolvedValueOnce(fixture("project-status-error.json"))
      .mockResolvedValueOnce(fixture("measures-new-code.json"));

    const output = await qgCommand([], CTX);

    expect(output).toContain("verdict: ERROR");
    expect(output).toContain("non_conclusif_pour_une_mr");
    expect(output).toContain("PREVIOUS_VERSION");
    expect(output).toContain("2026-06-01");
  });
});
