import { describe, expect, it, vi } from "vitest";

const FAKE_TOKEN = "fake-project-token";

vi.mock("../src/config.js", () => ({
  loadConfig: () => ({ host: "https://sonar.example.com", insecure: true }),
  configPath: () => "/tmp/sonarqube-axi/config.json",
}));

vi.mock("../src/context.js", () => ({
  resolveProjectContext: async () => ({
    repoPath: "group/example-project",
    projectKey: "example_project_00000000",
    token: FAKE_TOKEN,
  }),
}));

const {
  COMMAND_NAMES,
  TOP_HELP,
  main,
  parseSonarContextArgs,
  withStrippedArgs,
} = await import("../src/cli.js");

function capture(): {
  stdout: { write: (chunk: string) => void };
  text: () => string;
} {
  const chunks: string[] = [];
  return {
    stdout: { write: (chunk: string) => void chunks.push(chunk) },
    text: () => chunks.join(""),
  };
}

async function run(argv: string[]): Promise<string> {
  const out = capture();
  await main({ argv, stdout: out.stdout });
  return out.text();
}

describe("cli surface", () => {
  it("exposes exactly the planned commands", () => {
    expect([...COMMAND_NAMES]).toEqual([
      "qg",
      "issues",
      "hotspots",
      "analysis",
      "hotspot",
      "issue",
      "api",
      "setup",
    ]);
  });

  it("lists every command in the top-level help", () => {
    for (const name of COMMAND_NAMES) {
      expect(TOP_HELP).toContain(name);
    }
  });

  it("prints the version", async () => {
    const output = await run(["--version"]);
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("prints the top-level help on --help", async () => {
    expect(await run(["--help"])).toContain("usage: sonarqube-axi");
  });

  it("answers the home command", async () => {
    expect(await run([])).toMatch(/pas encore implémenté/);
  });

  it("answers each command stub without touching the network", async () => {
    for (const name of COMMAND_NAMES) {
      expect(await run([name])).toMatch(/pas encore implémenté/);
    }
  });

  it("reports an unknown command", async () => {
    expect(await run(["nope"])).toMatch(/nope/);
  });
});

describe("context flags never reach a handler", () => {
  it("hides --mr from the command that runs", async () => {
    // The stub echoes the args it was handed, so this asserts what a real
    // Task 2 handler will actually receive.
    const output = await run(["qg", "--mr", "42", "--json"]);

    expect(output).not.toContain("--mr");
    expect(output).not.toContain("42");
    expect(output).toContain("--json");
  });

  it("hides the equals form too", async () => {
    expect(await run(["issues", "--mr=42"])).not.toContain("--mr");
  });

  it("passes the stripped args through withStrippedArgs", async () => {
    const handler = vi.fn(async () => "ok");

    await withStrippedArgs(handler)(["list", "--mr", "42", "--all"], undefined);

    expect(handler).toHaveBeenCalledWith(["list", "--all"], undefined);
  });
});

describe("parseSonarContextArgs", () => {
  it("strips --mr in space and equals form", () => {
    expect(parseSonarContextArgs(["list", "--mr", "42", "--all"])).toEqual({
      mrIid: "42",
      strippedArgs: ["list", "--all"],
    });
    expect(parseSonarContextArgs(["--mr=42"])).toEqual({
      mrIid: "42",
      strippedArgs: [],
    });
  });

  it("leaves other args untouched", () => {
    expect(parseSonarContextArgs(["view", "--limit", "5"])).toEqual({
      mrIid: undefined,
      strippedArgs: ["view", "--limit", "5"],
    });
  });

  it("rejects --mr without a value", () => {
    expect(() => parseSonarContextArgs(["--mr"])).toThrowError(/--mr/);
  });
});
