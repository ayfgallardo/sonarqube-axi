import { resolvePersonalToken } from "../auth.js";
import { loadConfig } from "../config.js";
import { AxiError } from "../errors.js";
import { sonarGet, type SonarContext } from "../sonar.js";
import { getSuggestions } from "../suggestions.js";
import { field, renderDetail, renderHelp, renderOutput } from "../toon.js";

interface CeTask {
  id: string;
  status: string;
  submittedAt: string;
  startedAt?: string;
  analysisId?: string;
  errorMessage?: string;
}

interface CeComponentResponse {
  queue: CeTask[];
  current?: CeTask;
}

/**
 * `ce/component` needs the same elevated permission as hotspots — a project
 * (CI) credential gets a 403. Retry once with the credential from the Keychain.
 */
async function fetchCeComponent(
  ctx: SonarContext,
): Promise<CeComponentResponse> {
  const requestOptions = {
    token: ctx.token,
    host: ctx.host,
    insecure: ctx.insecure,
  };
  try {
    return await sonarGet<CeComponentResponse>(
      "ce/component",
      { component: ctx.projectKey },
      requestOptions,
    );
  } catch (error) {
    if (!(error instanceof AxiError) || error.code !== "FORBIDDEN") {
      throw error;
    }
    const config = loadConfig();
    const fallback = await resolvePersonalToken(config.keychainService);
    return sonarGet<CeComponentResponse>(
      "ce/component",
      { component: ctx.projectKey },
      { ...requestOptions, token: fallback },
    );
  }
}

export async function analysisCommand(
  _args: string[],
  ctx: SonarContext,
): Promise<string> {
  const response = await fetchCeComponent(ctx);

  const running = response.queue.length > 0;
  const errorMessage = response.current?.errorMessage;

  return renderOutput([
    renderDetail(
      "analysis",
      {
        running,
        queue_length: response.queue.length,
        last_status: response.current?.status ?? "none",
        last_submitted_at: response.current?.submittedAt ?? null,
        ...(errorMessage ? { error: errorMessage } : {}),
      },
      [
        field("running"),
        field("queue_length"),
        field("last_status"),
        field("last_submitted_at"),
        ...(errorMessage ? [field("error")] : []),
      ],
    ),
    renderHelp(getSuggestions({ domain: "analysis" })),
  ]);
}
