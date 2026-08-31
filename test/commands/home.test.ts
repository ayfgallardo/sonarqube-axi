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

const { homeCommand } = await import("../../src/commands/home.js");

const CTX = {
  host: "https://sonar.example.com",
  insecure: false,
  projectKey: "example_project_00000000",
  repoPath: "group/example-project",
  token: "fake-token",
};

describe("homeCommand", () => {
  beforeEach(() => {
    sonarGetMock.mockReset();
    resolveModeMock.mockReset();
    resolveModeMock.mockResolvedValue({
      mode: { kind: "mr", mrIid: "42" },
      strippedArgs: [],
    });
  });

  it("shows the quality gate of the current MR by default", async () => {
    sonarGetMock
      .mockResolvedValueOnce(fixture("project-status-ok.json"))
      .mockResolvedValueOnce(fixture("measures-new-code.json"));

    const output = await homeCommand([], CTX);

    expect(output).toContain("mode: mr");
    expect(output).toContain("verdict: OK");
    expect(output).toContain("new_lines: 37");
  });
});
