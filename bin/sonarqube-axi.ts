#!/usr/bin/env node
// Stub bootstrap — Task 1 wires this into src/cli.ts (runAxiCli).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function findPackageJson(startDir: string): string {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("package.json introuvable");
    dir = parent;
  }
}

const pkgPath = findPackageJson(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

console.log(`${pkg.name} ${pkg.version}`);
