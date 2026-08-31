import { AxiError, exitCodeForError } from "axi-sdk-js";

export type ErrorCode =
  | "NOT_FOUND"
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "CONFIG_MISSING"
  | "CONTEXT_MISSING"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export { AxiError, exitCodeForError };

const AUTH_HELP = [
  "Le jeton est invalide ou expiré — régénérer un jeton SonarQube",
  "Jeton projet : variable CI SONAR_TOKEN ; jeton personnel : Trousseau macOS",
];

const FORBIDDEN_HELP = [
  "Le jeton projet ne peut pas lire les hotspots — utiliser le jeton personnel",
  "Vérifier les droits sur le projet dans SonarQube (Browse / Administer Issues)",
];

const statusMap: Record<number, { code: ErrorCode; suggestions: string[] }> = {
  400: { code: "VALIDATION_ERROR", suggestions: [] },
  401: { code: "AUTH_REQUIRED", suggestions: AUTH_HELP },
  403: { code: "FORBIDDEN", suggestions: FORBIDDEN_HELP },
  404: { code: "NOT_FOUND", suggestions: [] },
  429: { code: "RATE_LIMITED", suggestions: ["Attendre ~60s puis réessayer"] },
};

/** SonarQube answers every failure with `{errors:[{msg}]}` — that msg is the only useful text. */
export function sonarErrorMessage(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("errors" in body)) {
    return undefined;
  }
  const { errors } = body as { errors: unknown };
  if (!Array.isArray(errors)) {
    return undefined;
  }
  const first = errors[0] as { msg?: unknown } | undefined;
  return typeof first?.msg === "string" ? first.msg : undefined;
}

export function mapSonarError(
  status: number,
  body: unknown,
  path: string,
): AxiError {
  const mapped = statusMap[status] ?? { code: "UNKNOWN", suggestions: [] };
  const message =
    sonarErrorMessage(body) ?? `SonarQube a répondu ${status} sur /api/${path}`;
  return new AxiError(message, mapped.code, mapped.suggestions);
}

const TLS_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
]);

export function mapNetworkError(error: unknown, host: string): AxiError {
  const cause = (error as { cause?: unknown }).cause;
  const code = (cause as { code?: unknown })?.code;
  const detail =
    cause instanceof Error
      ? cause.message
      : error instanceof Error
        ? error.message
        : String(error);

  if (typeof code === "string" && TLS_CODES.has(code)) {
    return new AxiError(
      `Certificat TLS refusé par ${host} : ${detail}`,
      "NETWORK_ERROR",
      [
        "Le serveur utilise un certificat auto-signé — activer `insecure` via `sonarqube-axi setup`",
      ],
    );
  }

  return new AxiError(`${host} injoignable : ${detail}`, "NETWORK_ERROR");
}
