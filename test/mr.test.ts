import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({ execFile: execFileMock }));

const { resolveMode } = await import("../src/mr.js");

type ExecCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

const REPO_PATH = "group/example-project";
const BRANCH = "feature/example";

function stub(
  overrides: { branch?: string; mrs?: unknown[] | Error } = {},
): void {
  execFileMock.mockImplementation(
    (
      file: string,
      args: string[],
      _options: unknown,
      callback: ExecCallback,
    ) => {
      if (file === "git") {
        callback(null, `${overrides.branch ?? BRANCH}\n`, "");
        return;
      }
      if (file === "glab") {
        if (overrides.mrs instanceof Error) {
          callback(overrides.mrs, "", "not logged in");
          return;
        }
        callback(null, JSON.stringify(overrides.mrs ?? []), "");
        return;
      }
      callback(new Error(`unexpected command ${file}`), "", "");
    },
  );
}

describe("resolveMode", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("defaults to MR mode when an open MR exists for the current branch", async () => {
    stub({ mrs: [{ iid: 42 }] });

    const { mode } = await resolveMode([], undefined, REPO_PATH);

    expect(mode).toEqual({ kind: "mr", mrIid: "42" });
  });

  it("falls back to branch mode when no MR is open", async () => {
    stub({ mrs: [] });

    const { mode } = await resolveMode([], undefined, REPO_PATH);

    expect(mode).toEqual({ kind: "branch", branch: BRANCH });
  });

  it("forces branch mode with --branch even when a MR is open", async () => {
    stub({ mrs: [{ iid: 42 }] });

    const { mode, strippedArgs } = await resolveMode(
      ["--branch"],
      undefined,
      REPO_PATH,
    );

    expect(mode).toEqual({ kind: "branch", branch: BRANCH });
    expect(strippedArgs).toEqual([]);
  });

  it("an explicit --mr always wins over auto-detection", async () => {
    stub({ mrs: [{ iid: 99 }] });

    const { mode } = await resolveMode([], "7", REPO_PATH);

    expect(mode).toEqual({ kind: "mr", mrIid: "7" });
  });

  it("falls back to branch mode when glab fails (not installed, logged out)", async () => {
    stub({ mrs: new Error("exit status 1") });

    const { mode } = await resolveMode([], undefined, REPO_PATH);

    expect(mode).toEqual({ kind: "branch", branch: BRANCH });
  });
});
