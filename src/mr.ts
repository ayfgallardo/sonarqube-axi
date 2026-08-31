import { execFile } from "node:child_process";
import { takeBoolFlag } from "./args.js";

export type Mode =
  | { kind: "mr"; mrIid: string }
  | { kind: "branch"; branch: string };

function run(file: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { cwd: cwd ?? process.cwd() },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stderr }));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

export async function currentBranch(cwd?: string): Promise<string> {
  return run("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd);
}

interface GlabMr {
  iid: number;
}

/** The iid of the open MR sourced from `branch`, or undefined when there is none. */
export async function detectOpenMrIid(
  repoPath: string,
  branch: string,
  cwd?: string,
): Promise<string | undefined> {
  try {
    const stdout = await run(
      "glab",
      ["mr", "list", `--source-branch=${branch}`, "-F", "json", "-R", repoPath],
      cwd,
    );
    const mrs = JSON.parse(stdout) as GlabMr[];
    return mrs[0] ? String(mrs[0].iid) : undefined;
  } catch {
    // glab absent, logged out, or no open MR — branch mode is the safe fallback.
    return undefined;
  }
}

/**
 * MR mode is the default whenever an open MR exists for the current branch.
 * `--branch` forces branch mode explicitly; an explicit `--mr` (already parsed
 * into `explicitMrIid` by the CLI) always wins.
 */
export async function resolveMode(
  args: string[],
  explicitMrIid: string | undefined,
  repoPath: string,
  cwd?: string,
): Promise<{ mode: Mode; strippedArgs: string[] }> {
  const strippedArgs = [...args];
  const forceBranch = takeBoolFlag(strippedArgs, "--branch");

  if (explicitMrIid) {
    return { mode: { kind: "mr", mrIid: explicitMrIid }, strippedArgs };
  }

  const branch = await currentBranch(cwd);

  if (!forceBranch) {
    const mrIid = await detectOpenMrIid(repoPath, branch, cwd);
    if (mrIid) {
      return { mode: { kind: "mr", mrIid }, strippedArgs };
    }
  }

  return { mode: { kind: "branch", branch }, strippedArgs };
}
