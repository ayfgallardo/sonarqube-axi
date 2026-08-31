import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const home = { value: "" };

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => home.value };
});

const { setupCommand } = await import("../../src/commands/setup.js");

function configDir(): string {
  return join(home.value, ".config", "sonarqube-axi");
}

function configPath(): string {
  return join(configDir(), "config.json");
}

function cachePath(): string {
  return join(configDir(), "context-cache.json");
}

describe("setupCommand", () => {
  beforeEach(() => {
    home.value = mkdtempSync(join(tmpdir(), "sonar-axi-setup-"));
  });

  afterEach(() => {
    rmSync(home.value, { recursive: true, force: true });
  });

  it("writes a fresh config with --host, mode 600/700, and never shows a token", async () => {
    const output = await setupCommand(["--host", "https://sonar.example.com/"]);

    const written = JSON.parse(readFileSync(configPath(), "utf-8"));
    expect(written).toEqual({
      host: "https://sonar.example.com",
      insecure: false,
    });
    expect(statSync(configPath()).mode & 0o777).toBe(0o600);
    expect(statSync(configDir()).mode & 0o777).toBe(0o700);
    expect(output).not.toMatch(/token/i);
  });

  it("sets insecure and keychain-service", async () => {
    await setupCommand(["--host", "https://sonar.example.com"]);
    await setupCommand(["--insecure", "--keychain-service", "sonar-custom"]);

    const written = JSON.parse(readFileSync(configPath(), "utf-8"));
    expect(written).toEqual({
      host: "https://sonar.example.com",
      insecure: true,
      keychainService: "sonar-custom",
    });
  });

  it("shows the current config state with no flags", async () => {
    await setupCommand(["--host", "https://sonar.example.com"]);

    const output = await setupCommand([]);

    expect(output).toContain("sonar.example.com");
  });

  it("shows guidance with no flags and no existing config", async () => {
    const output = await setupCommand([]);

    expect(output.toLowerCase()).toMatch(/setup --host/);
  });

  it("clears the context cache with --clear-cache", async () => {
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(cachePath(), "{}");

    const output = await setupCommand(["--clear-cache"]);

    expect(existsSync(cachePath())).toBe(false);
    expect(output).toContain("cache");
  });

  it("reports no-op clearing a cache that does not exist", async () => {
    const output = await setupCommand(["--clear-cache"]);

    expect(existsSync(cachePath())).toBe(false);
    expect(output).toContain("cache");
  });
});
