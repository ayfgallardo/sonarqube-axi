import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const home = { value: "" };

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => home.value };
});

const { configPath, loadConfig } = await import("../src/config.js");
const { AxiError } = await import("../src/errors.js");

function writeConfig(content: string): void {
  const dir = join(home.value, ".config", "sonarqube-axi");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), content);
}

describe("config", () => {
  beforeEach(() => {
    home.value = mkdtempSync(join(tmpdir(), "sonar-axi-config-"));
  });

  afterEach(() => {
    rmSync(home.value, { recursive: true, force: true });
  });

  it("resolves the config under ~/.config/sonarqube-axi", () => {
    expect(configPath()).toBe(
      join(home.value, ".config", "sonarqube-axi", "config.json"),
    );
  });

  it("loads host, insecure and keychainService", () => {
    writeConfig(
      JSON.stringify({
        host: "https://sonar.example.com",
        insecure: true,
        keychainService: "sonar-example",
      }),
    );

    expect(loadConfig()).toEqual({
      host: "https://sonar.example.com",
      insecure: true,
      keychainService: "sonar-example",
    });
  });

  it("defaults insecure to false and strips a trailing slash from host", () => {
    writeConfig(JSON.stringify({ host: "https://sonar.example.com/" }));

    const config = loadConfig();
    expect(config.host).toBe("https://sonar.example.com");
    expect(config.insecure).toBe(false);
  });

  it("guides towards setup when the file is missing", () => {
    let thrown: unknown;
    try {
      loadConfig();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AxiError);
    const error = thrown as InstanceType<typeof AxiError>;
    expect(error.code).toBe("CONFIG_MISSING");
    expect(error.suggestions.join(" ")).toContain("sonarqube-axi setup");
  });

  it("guides towards setup when the file is malformed", () => {
    writeConfig("{ not json");

    expect(() => loadConfig()).toThrowError(/Malformed/);
  });

  it("rejects a config without a host", () => {
    writeConfig(JSON.stringify({ insecure: true }));

    let thrown: unknown;
    try {
      loadConfig();
    } catch (error) {
      thrown = error;
    }
    expect((thrown as InstanceType<typeof AxiError>).code).toBe(
      "VALIDATION_ERROR",
    );
  });
});
