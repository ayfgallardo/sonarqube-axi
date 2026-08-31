import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AxiError } from "./errors.js";

export interface ProjectContext {
  /** GitLab project path, e.g. `group/sub/project`. */
  repoPath: string;
  projectKey: string;
  /** Project CI token — reads QG, issues and measures, but not hotspots. */
  token: string;
}

type CacheEntry = Pick<ProjectContext, "projectKey" | "token">;
type Cache = Record<string, CacheEntry>;

export function cachePath(): string {
  return join(homedir(), ".config", "sonarqube-axi", "context-cache.json");
}

/**
 * Strip protocol, credentials, host and the `.git` suffix from an origin URL,
 * leaving the `namespace/project` path GitLab addresses projects by.
 */
export function gitlabProjectPath(remoteUrl: string): string {
  const trimmed = remoteUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");

  let path: string;
  const scheme = trimmed.match(/^[a-z][a-z0-9+.-]*:\/\/(.*)$/i);
  if (scheme) {
    const afterUser = scheme[1].replace(/^[^/@]*@/, "");
    const slash = afterUser.indexOf("/");
    path = slash === -1 ? "" : afterUser.slice(slash + 1);
  } else {
    const scp = trimmed.match(/^(?:[^@/]*@)?[^/:]+:(.*)$/);
    path = scp ? scp[1] : trimmed;
  }

  path = path.replace(/^\/+/, "");
  if (!path.includes("/") || path.split("/").some((part) => part === "")) {
    throw new AxiError(
      `Impossible de déduire le projet GitLab depuis ${remoteUrl}`,
      "CONTEXT_MISSING",
      ["Attendu une origine de la forme <hôte>:<namespace>/<projet>.git"],
    );
  }
  return path;
}

/**
 * Resolve the Sonar project key and CI token of the repository in `cwd`.
 * Result is cached per repo path — reading two CI variables costs two `glab`
 * round-trips otherwise, on every command.
 */
export async function resolveProjectContext(
  options: { cwd?: string; refresh?: boolean } = {},
): Promise<ProjectContext> {
  const repoPath = gitlabProjectPath(await gitOrigin(options.cwd));

  if (!options.refresh) {
    const cached = readCache()[repoPath];
    if (cached) {
      return { repoPath, ...cached };
    }
  }

  const projectKey = await ciVariable("SONAR_PROJECTKEY", repoPath);
  const token = await ciVariable("SONAR_TOKEN", repoPath);

  writeCache({ ...readCache(), [repoPath]: { projectKey, token } });
  return { repoPath, projectKey, token };
}

async function gitOrigin(cwd?: string): Promise<string> {
  try {
    return await run("git", ["remote", "get-url", "origin"], cwd);
  } catch {
    throw new AxiError(
      "Aucun dépôt git avec une origine dans le répertoire courant",
      "CONTEXT_MISSING",
      ["Se placer dans le dépôt du projet analysé par SonarQube"],
    );
  }
}

/**
 * `-R <path>` is mandatory: CI variables are per-project and never inherited,
 * and glab's implicit resolution silently answers from a stale project on forks.
 */
async function ciVariable(name: string, repoPath: string): Promise<string> {
  let value: string;
  try {
    value = await run("glab", ["variable", "get", name, "-R", repoPath]);
  } catch (error) {
    // A failing `glab` (absent, logged out, no access) is not an absent
    // variable, and the remedies have nothing in common.
    throw new AxiError(
      `Lecture de la variable CI ${name} sur ${repoPath} impossible : ${commandFailure(error)}`,
      "CONTEXT_MISSING",
      [
        "Vérifier l'accès GitLab : glab auth status",
        "Vérifier que la CLI est installée : glab --version",
      ],
    );
  }

  if (!value) {
    throw new AxiError(
      `Variable CI ${name} absente du projet ${repoPath}`,
      "CONTEXT_MISSING",
      [
        `La définir : glab variable set ${name} <valeur> -R ${repoPath}`,
        "Ou lancer `sonarqube-axi setup` pour configurer l'accès",
      ],
    );
  }
  return value;
}

/** The stderr of a failed subprocess, or its message when it produced none. */
function commandFailure(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr === "string" && stderr.trim() !== "") {
    return stderr.trim();
  }
  return error instanceof Error ? error.message : String(error);
}

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

function readCache(): Cache {
  try {
    return JSON.parse(readFileSync(cachePath(), "utf-8")) as Cache;
  } catch {
    return {};
  }
}

/** The cache holds project tokens, so it stays owner-only. */
function writeCache(cache: Cache): void {
  const path = cachePath();
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}
