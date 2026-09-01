import { resolvePersonalToken } from "../auth.js";
import { loadConfig } from "../config.js";
import { AxiError } from "../errors.js";
import { dropRetriedRawBody } from "../gain.js";
import { resolveMode } from "../mr.js";
import {
  sonarGet,
  type SonarContext,
  type SonarParams,
  type SonarRequestOptions,
} from "../sonar.js";
import { getSuggestions } from "../suggestions.js";
import {
  custom,
  field,
  renderHelp,
  renderList,
  renderOutput,
} from "../toon.js";

interface Hotspot {
  key: string;
  component: string;
  line?: number;
  message: string;
  vulnerabilityProbability: string;
  securityCategory: string;
}

interface HotspotsSearchResponse {
  paging: { total: number };
  hotspots: Hotspot[];
}

function fileOf(component: string, projectKey: string): string {
  return component.startsWith(`${projectKey}:`)
    ? component.slice(projectKey.length + 1)
    : component;
}

/**
 * A project (CI) token cannot read hotspots — SonarQube answers 403. Retry
 * once with the personal token from the Keychain, announcing the channel used
 * so the caller knows which credential answered.
 */
async function fetchHotspots(
  projectKey: string,
  params: SonarParams,
  projectOptions: SonarRequestOptions,
  keychainService: string | undefined,
): Promise<{
  response: HotspotsSearchResponse;
  channel: "projet" | "personnel";
}> {
  try {
    const response = await sonarGet<HotspotsSearchResponse>(
      "hotspots/search",
      { project: projectKey, status: "TO_REVIEW", ...params },
      projectOptions,
    );
    return { response, channel: "projet" };
  } catch (error) {
    if (!(error instanceof AxiError) || error.code !== "FORBIDDEN") {
      throw error;
    }
    dropRetriedRawBody();
    const secondToken = await resolvePersonalToken(keychainService);
    const response = await sonarGet<HotspotsSearchResponse>(
      "hotspots/search",
      { project: projectKey, status: "TO_REVIEW", ...params },
      { ...projectOptions, token: secondToken },
    );
    return { response, channel: "personnel" };
  }
}

export async function hotspotsCommand(
  args: string[],
  ctx: SonarContext,
): Promise<string> {
  const { mode } = await resolveMode(args, ctx.mrIid, ctx.repoPath);
  const params: SonarParams =
    mode.kind === "mr" ? { pullRequest: mode.mrIid } : { branch: mode.branch };

  const config = loadConfig();
  const { response, channel } = await fetchHotspots(
    ctx.projectKey,
    params,
    { token: ctx.token, host: ctx.host, insecure: ctx.insecure },
    config.keychainService,
  );

  const remaining = response.hotspots.length;
  const channelLine = `jeton utilisé: ${channel}`;

  if (remaining === 0) {
    return renderOutput([
      channelLine,
      "hotspots: aucun hotspot à revoir",
      renderHelp(getSuggestions({ domain: "hotspots", remaining: 0 })),
    ]);
  }

  return renderOutput([
    channelLine,
    `count: ${remaining}`,
    renderList("hotspots", response.hotspots, [
      field("key"),
      custom("file", (hotspot: Hotspot) =>
        fileOf(hotspot.component, ctx.projectKey),
      ),
      field("line"),
      field("message"),
      field("vulnerabilityProbability", "probability"),
      field("securityCategory", "category"),
    ]),
    renderHelp(getSuggestions({ domain: "hotspots", remaining })),
  ]);
}
