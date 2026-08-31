// Leaf module: imports node builtins only, never the command graph.
// `bin/sonarqube-axi.ts` imports this on the `--version` fast path, so any new
// import here would be paid on every invocation of that path.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function readPackageVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));

  for (;;) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      const parsed = JSON.parse(readFileSync(candidate, "utf-8")) as {
        version?: unknown;
      };
      if (typeof parsed.version === "string" && parsed.version.length > 0) {
        return parsed.version;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("Version du paquet sonarqube-axi introuvable");
    }
    dir = parent;
  }
}

export const VERSION = readPackageVersion();
