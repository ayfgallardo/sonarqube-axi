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

const { issuesCommand } = await import("../../src/commands/issues.js");

const CTX = {
  host: "https://sonar.example.com",
  insecure: false,
  projectKey: "example_project_00000000",
  repoPath: "group/example-project",
  token: "fake-token",
};

describe("issuesCommand", () => {
  beforeEach(() => {
    sonarGetMock.mockReset();
    resolveModeMock.mockReset();
    resolveModeMock.mockResolvedValue({
      mode: { kind: "mr", mrIid: "42" },
      strippedArgs: [],
    });
  });

  it("lists new unresolved issues with rule, severity/impact, file, line and message", async () => {
    sonarGetMock.mockResolvedValueOnce(fixture("issues-search.json"));

    const output = await issuesCommand([], CTX);

    expect(output).toContain("typescript:S3776");
    expect(output).toContain("src/app/example.ts");
    expect(output).toContain("MAINTAINABILITY:HIGH");
  });

  it("sends inNewCodePeriod and the unresolved statuses", async () => {
    sonarGetMock.mockResolvedValueOnce(fixture("issues-search.json"));

    await issuesCommand([], CTX);

    expect(sonarGetMock).toHaveBeenCalledWith(
      "issues/search",
      expect.objectContaining({
        components: CTX.projectKey,
        issueStatuses: "OPEN,CONFIRMED",
        inNewCodePeriod: true,
        pullRequest: "42",
      }),
      expect.anything(),
    );
  });

  it("reports the explicit empty state", async () => {
    sonarGetMock.mockResolvedValueOnce(fixture("issues-search-empty.json"));

    const output = await issuesCommand([], CTX);

    expect(output).toContain("aucune issue neuve");
  });

  it("truncates the message by default and keeps it full with --full", async () => {
    const longMessage = "x".repeat(400);
    sonarGetMock.mockResolvedValue({
      total: 1,
      issues: [
        {
          key: "AY1",
          rule: "typescript:S1",
          severity: "MAJOR",
          component: "example_project_00000000:src/x.ts",
          line: 1,
          message: longMessage,
        },
      ],
    });

    const truncated = await issuesCommand([], CTX);
    expect(truncated).toContain("truncated");
    expect(truncated).not.toContain(longMessage);

    const full = await issuesCommand(["--full"], CTX);
    expect(full).toContain(longMessage);
  });
});
