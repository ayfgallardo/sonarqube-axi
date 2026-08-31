import { Agent } from "undici";
import { basicAuthHeader, bearerAuthHeader } from "./auth.js";
import { loadConfig } from "./config.js";
import { mapNetworkError, mapSonarError } from "./errors.js";

export interface SonarContext {
  host: string;
  insecure: boolean;
  projectKey: string;
  /** GitLab project path, e.g. `group/sub/project` — needed to look up an open MR. */
  repoPath: string;
  /** Project CI token — reads QG, issues and measures, but not hotspots. */
  token: string;
  /** Merge-request iid, when the analysis targets a MR rather than a branch. */
  mrIid?: string;
}

export type SonarParams = Record<
  string,
  string | number | boolean | undefined | null
>;

export interface SonarRequestOptions {
  token: string;
  /** Defaults to the configured host. */
  host?: string;
  /** Defaults to the configured `insecure` flag. */
  insecure?: boolean;
}

let insecureAgent: Agent | undefined;

/**
 * A dedicated dispatcher keeps the relaxed TLS check scoped to SonarQube calls;
 * NODE_TLS_REJECT_UNAUTHORIZED would disable verification for the whole process.
 */
function dispatcherFor(insecure: boolean): Agent | undefined {
  if (!insecure) {
    return undefined;
  }
  insecureAgent ??= new Agent({ connect: { rejectUnauthorized: false } });
  return insecureAgent;
}

function encodeParams(params: SonarParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }
    search.set(key, String(value));
  }
  return search.toString();
}

function endpoint(options: SonarRequestOptions): {
  host: string;
  insecure: boolean;
} {
  if (options.host !== undefined && options.insecure !== undefined) {
    return { host: options.host, insecure: options.insecure };
  }
  const config = loadConfig();
  return {
    host: options.host ?? config.host,
    insecure: options.insecure ?? config.insecure,
  };
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  params: SonarParams,
  options: SonarRequestOptions,
): Promise<T> {
  const { host, insecure } = endpoint(options);
  const encoded = encodeParams(params);
  const url =
    method === "GET" && encoded
      ? `${host}/api/${path}?${encoded}`
      : `${host}/api/${path}`;
  const dispatcher = dispatcherFor(insecure);

  // Bearer first; SonarQube versions that predate it answer 401, and the same
  // token then works as a Basic login with an empty password.
  let response = await send(bearerAuthHeader(options.token));
  if (response.status === 401) {
    // Drain the discarded body so the connection returns to the pool.
    await response.text().catch(() => undefined);
    response = await send(basicAuthHeader(options.token));
  }

  if (!response.ok) {
    throw mapSonarError(response.status, await safeJson(response), path);
  }

  return (await safeJson(response)) as T;

  async function send(authorization: string): Promise<Response> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: authorization,
        Accept: "application/json",
        ...(method === "POST"
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : {}),
      },
      ...(method === "POST" ? { body: encoded } : {}),
      ...(dispatcher ? { dispatcher } : {}),
    } as RequestInit;

    try {
      return await fetch(url, init);
    } catch (error) {
      throw mapNetworkError(error, host);
    }
  }
}

/** Sonar answers several write endpoints with an empty 204. */
async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === "") {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function sonarGet<T>(
  path: string,
  params: SonarParams = {},
  options: SonarRequestOptions,
): Promise<T> {
  return request<T>("GET", path, params, options);
}

/** SonarQube expects write params as a form body, not JSON. */
export function sonarPost<T = undefined>(
  path: string,
  params: SonarParams = {},
  options: SonarRequestOptions,
): Promise<T> {
  return request<T>("POST", path, params, options);
}
