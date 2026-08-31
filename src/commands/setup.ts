import {
  chmodSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { encode } from "@toon-format/toon";
import { takeBoolFlag, takeFlag } from "../args.js";
import {
  configDir,
  configPath,
  loadConfig,
  type SonarConfig,
} from "../config.js";
import { cachePath } from "../context.js";
import { AxiError } from "../errors.js";
import { renderHelp, renderOutput } from "../toon.js";

function currentConfig(): SonarConfig | undefined {
  try {
    return loadConfig();
  } catch {
    return undefined;
  }
}

function renderConfig(label: string, config: SonarConfig): string {
  return encode({
    [label]: {
      host: config.host,
      insecure: config.insecure,
      ...(config.keychainService
        ? { keychainService: config.keychainService }
        : {}),
    },
  });
}

function clearCacheBlock(): string {
  const path = cachePath();
  if (!existsSync(path)) {
    return `cache: rien à supprimer (${path} absent)`;
  }
  rmSync(path);
  return `cache: supprimé (${path})`;
}

export async function setupCommand(args: string[]): Promise<string> {
  const rest = [...args];
  const host = takeFlag(rest, "--host");
  const insecureFlag = takeBoolFlag(rest, "--insecure");
  const noInsecureFlag = takeBoolFlag(rest, "--no-insecure");
  const keychainService = takeFlag(rest, "--keychain-service");
  const clearCache = takeBoolFlag(rest, "--clear-cache");

  if (insecureFlag && noInsecureFlag) {
    throw new AxiError(
      "--insecure et --no-insecure sont mutuellement exclusifs",
      "VALIDATION_ERROR",
    );
  }

  const blocks: string[] = [];
  if (clearCache) {
    blocks.push(clearCacheBlock());
  }

  const changesConfig =
    host !== undefined ||
    insecureFlag ||
    noInsecureFlag ||
    keychainService !== undefined;

  if (!changesConfig) {
    const existing = currentConfig();
    if (!existing) {
      return renderOutput([
        ...blocks,
        "config: absente",
        renderHelp([
          "Créer la configuration : sonarqube-axi setup --host <url>",
        ]),
      ]);
    }
    return renderOutput([
      ...blocks,
      renderConfig("config", existing),
      renderHelp([
        "Mettre à jour : sonarqube-axi setup --host <url> [--insecure|--no-insecure] [--keychain-service <name>]",
      ]),
    ]);
  }

  const existing = currentConfig();
  const resolvedHost = host ?? existing?.host;
  if (!resolvedHost) {
    throw new AxiError(
      "--host est requis pour la première configuration",
      "VALIDATION_ERROR",
    );
  }

  const next: SonarConfig = {
    host: resolvedHost.trim().replace(/\/+$/, ""),
    insecure: insecureFlag
      ? true
      : noInsecureFlag
        ? false
        : (existing?.insecure ?? false),
    ...((keychainService ?? existing?.keychainService)
      ? { keychainService: keychainService ?? existing?.keychainService }
      : {}),
  };

  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const path = configPath();
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);

  return renderOutput([
    ...blocks,
    `config_written: ${path}`,
    renderConfig("config", next),
  ]);
}
