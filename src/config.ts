import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AxiError } from "./errors.js";

export interface SonarConfig {
  /** Base URL without a trailing slash, e.g. `https://sonar.example.com`. */
  host: string;
  /** Skip TLS certificate verification — needed for a self-signed server cert. */
  insecure: boolean;
  /** macOS Keychain service holding the personal token. */
  keychainService?: string;
}

const SETUP_HELP = ["Lancer `sonarqube-axi setup` pour la créer"];

export function configDir(): string {
  return join(homedir(), ".config", "sonarqube-axi");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function loadConfig(): SonarConfig {
  const path = configPath();

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    throw new AxiError(
      `Aucune configuration SonarQube dans ${path}`,
      "CONFIG_MISSING",
      SETUP_HELP,
    );
  }

  let parsed: Partial<SonarConfig>;
  try {
    parsed = JSON.parse(raw) as Partial<SonarConfig>;
  } catch {
    throw new AxiError(
      `Malformed SonarQube configuration in ${path}`,
      "VALIDATION_ERROR",
      SETUP_HELP,
    );
  }

  if (typeof parsed.host !== "string" || parsed.host.trim() === "") {
    throw new AxiError(
      `Champ host absent dans ${path}`,
      "VALIDATION_ERROR",
      SETUP_HELP,
    );
  }

  return {
    host: parsed.host.trim().replace(/\/+$/, ""),
    insecure: parsed.insecure === true,
    ...(parsed.keychainService
      ? { keychainService: parsed.keychainService }
      : {}),
  };
}
