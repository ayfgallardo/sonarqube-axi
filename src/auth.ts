import { execFile } from "node:child_process";
import { AxiError } from "./errors.js";

export const DEFAULT_KEYCHAIN_SERVICE = "sonar-geofoncier";

/** Primary scheme accepted by SonarQube 10+. */
export function bearerAuthHeader(token: string): string {
  return `Bearer ${token}`;
}

/** Legacy scheme: the token is the login, the password is empty. */
export function basicAuthHeader(token: string): string {
  return `Basic ${Buffer.from(`${token}:`).toString("base64")}`;
}

/**
 * Read the personal token from the macOS Keychain. It is the only credential
 * that can read hotspots and write triage; the project CI token cannot.
 */
export async function resolvePersonalToken(
  service = DEFAULT_KEYCHAIN_SERVICE,
): Promise<string> {
  const found = await keychainToken(service);

  if (!found) {
    throw new AxiError(
      `Aucun jeton personnel SonarQube dans le Trousseau (service ${service})`,
      "AUTH_REQUIRED",
      [
        `L'enregistrer : security add-generic-password -s ${service} -a "$USER" -w`,
        "Le générer dans SonarQube > My Account > Security",
      ],
    );
  }

  return found;
}

function keychainToken(service: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "security",
      ["find-generic-password", "-s", service, "-w"],
      (error, stdout) => {
        resolve(error ? undefined : stdout.trim() || undefined);
      },
    );
  });
}
