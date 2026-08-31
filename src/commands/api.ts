import { takeBoolFlag, takeFlag } from "../args.js";
import { resolvePersonalToken } from "../auth.js";
import { loadConfig } from "../config.js";
import { AxiError } from "../errors.js";
import {
  sonarGet,
  sonarPost,
  type SonarContext,
  type SonarParams,
} from "../sonar.js";

function parseParams(pairs: string[]): SonarParams {
  const params: SonarParams = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq === -1) {
      throw new AxiError(
        `Paramètre invalide (attendu key=value): ${pair}`,
        "VALIDATION_ERROR",
      );
    }
    params[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return params;
}

export async function apiCommand(
  args: string[],
  ctx: SonarContext,
): Promise<string> {
  const rest = [...args];
  const allowMutation = takeBoolFlag(rest, "--allow-mutation");
  const personal = takeBoolFlag(rest, "--personal");
  const methodFlag = takeFlag(rest, "--method");
  const [path, ...pairs] = rest;

  if (!path) {
    throw new AxiError("api requires a <path>", "VALIDATION_ERROR", [
      "Run `sonarqube-axi api <path> [key=value ...]`",
    ]);
  }

  const method = (methodFlag ?? "GET").toUpperCase();
  if (method !== "GET" && !allowMutation) {
    throw new AxiError(
      `Mutation refusée : ${method} sur /api/${path} nécessite --allow-mutation`,
      "VALIDATION_ERROR",
      ["Ajouter --allow-mutation pour confirmer une écriture"],
    );
  }

  const params = parseParams(pairs);

  const config = loadConfig();
  const credential = personal
    ? await resolvePersonalToken(config.keychainService)
    : ctx.token;
  const options = { token: credential, host: ctx.host, insecure: ctx.insecure };

  const response =
    method === "GET"
      ? await sonarGet(path, params, options)
      : await sonarPost(path, params, options);

  return `${JSON.stringify(response ?? {}, null, 2)}\n`;
}
