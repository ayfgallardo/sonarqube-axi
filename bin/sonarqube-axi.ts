#!/usr/bin/env node
// Stub bootstrap — Task 1 wires this into src/cli.ts (runAxiCli).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../package.json", import.meta.url)),
    "utf8",
  ),
);

console.log(`${pkg.name} ${pkg.version}`);
