import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const home = { value: "" };
const execFileMock = vi.fn();

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => home.value };
});

vi.mock("node:child_process", () => ({ execFile: execFileMock }));

const { cachePath, gitlabProjectPath, resolveProjectContext } =
  await import("../src/context.js");
const { AxiError } = await import("../src/errors.js");

type ExecCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

const ORIGIN = "git@git.example.com:group/sub/example-project.git";
const REPO_PATH = "group/sub/example-project";
const PROJECT_KEY = "example_project_00000000";
const FAKE_TOKEN = "fake-project-token";

/** Answer `git remote get-url origin` and the two `glab variable get` calls. */
function stubRepo(
  overrides: {
    origin?: string;
    projectKey?: string | Error;
    token?: string | Error;
  } = {},
): void {
  execFileMock.mockImplementation(
    (
      file: string,
      args: string[],
      _options: unknown,
      callback: ExecCallback,
    ) => {
      if (file === "git") {
        callback(null, `${overrides.origin ?? ORIGIN}\n`, "");
        return;
      }
      if (file === "glab") {
        const name = args[2];
        const value =
          name === "SONAR_PROJECTKEY"
            ? (overrides.projectKey ?? PROJECT_KEY)
            : (overrides.token ?? FAKE_TOKEN);
        if (value instanceof Error) {
          callback(value, "", "variable not found");
          return;
        }
        callback(null, `${value}\n`, "");
        return;
      }
      callback(new Error(`unexpected command ${file}`), "", "");
    },
  );
}

describe("gitlabProjectPath", () => {
  it.each([
    [
      "git@git.example.com:group/sub/example-project.git",
      "group/sub/example-project",
    ],
    ["git@git.example.com:group/example-project", "group/example-project"],
    [
      "https://git.example.com/group/sub/example-project.git",
      "group/sub/example-project",
    ],
    [
      "https://user@git.example.com/group/example-project.git",
      "group/example-project",
    ],
    [
      "ssh://git@git.example.com:2222/group/example-project.git",
      "group/example-project",
    ],
    ["https://git.example.com/group/example-project/", "group/example-project"],
  ])("normalizes %s", (url, expected) => {
    expect(gitlabProjectPath(url)).toBe(expected);
  });

  it("rejects a remote that carries no namespace", () => {
    expect(() =>
      gitlabProjectPath("git@git.example.com:project.git"),
    ).toThrowError(AxiError);
  });
});

describe("resolveProjectContext", () => {
  beforeEach(() => {
    home.value = mkdtempSync(join(tmpdir(), "sonar-axi-ctx-"));
    execFileMock.mockReset();
  });

  afterEach(() => {
    rmSync(home.value, { recursive: true, force: true });
  });

  it("reads both CI variables with an explicit -R <path>", async () => {
    stubRepo();

    await expect(resolveProjectContext()).resolves.toEqual({
      repoPath: REPO_PATH,
      projectKey: PROJECT_KEY,
      token: FAKE_TOKEN,
    });

    const glabCalls = execFileMock.mock.calls.filter(
      ([file]) => file === "glab",
    );
    expect(glabCalls).toHaveLength(2);
    expect(glabCalls[0][1]).toEqual([
      "variable",
      "get",
      "SONAR_PROJECTKEY",
      "-R",
      REPO_PATH,
    ]);
    expect(glabCalls[1][1]).toEqual([
      "variable",
      "get",
      "SONAR_TOKEN",
      "-R",
      REPO_PATH,
    ]);
  });

  it("caches the resolved pair per repo path with mode 600", async () => {
    stubRepo();

    await resolveProjectContext();
    const cached = JSON.parse(readFileSync(cachePath(), "utf-8")) as Record<
      string,
      { projectKey: string; token: string }
    >;
    expect(cached[REPO_PATH]).toEqual({
      projectKey: PROJECT_KEY,
      token: FAKE_TOKEN,
    });
    expect(statSync(cachePath()).mode & 0o777).toBe(0o600);

    execFileMock.mockClear();
    await expect(resolveProjectContext()).resolves.toMatchObject({
      projectKey: PROJECT_KEY,
    });
    expect(
      execFileMock.mock.calls.filter(([file]) => file === "glab"),
    ).toHaveLength(0);
  });

  it("re-reads the CI variables when refresh is asked", async () => {
    stubRepo();
    await resolveProjectContext();

    execFileMock.mockClear();
    stubRepo({ projectKey: "example_project_11111111" });
    await expect(
      resolveProjectContext({ refresh: true }),
    ).resolves.toMatchObject({
      projectKey: "example_project_11111111",
    });
    expect(
      execFileMock.mock.calls.filter(([file]) => file === "glab"),
    ).toHaveLength(2);
  });

  it("guides the user when SONAR_PROJECTKEY is missing", async () => {
    stubRepo({ projectKey: new Error("variable not found") });

    let thrown: unknown;
    try {
      await resolveProjectContext();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AxiError);
    const error = thrown as InstanceType<typeof AxiError>;
    expect(error.code).toBe("CONTEXT_MISSING");
    expect(error.message).toContain("SONAR_PROJECTKEY");
    expect(error.message).toContain(REPO_PATH);
    expect(error.suggestions.join(" ")).toContain("glab variable set");
  });

  it("guides the user when SONAR_TOKEN is missing", async () => {
    stubRepo({ token: new Error("variable not found") });

    await expect(resolveProjectContext()).rejects.toMatchObject({
      code: "CONTEXT_MISSING",
    });
  });

  it("fails with a clear message outside a git repository", async () => {
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: ExecCallback,
      ) => {
        callback(new Error("not a git repository"), "", "");
      },
    );

    await expect(resolveProjectContext()).rejects.toMatchObject({
      code: "CONTEXT_MISSING",
    });
  });

  it("never puts a token in a subprocess argv", async () => {
    stubRepo();
    await resolveProjectContext();

    for (const [, args] of execFileMock.mock.calls) {
      expect((args as string[]).join(" ")).not.toContain(FAKE_TOKEN);
    }
  });
});
