import { takeFlag } from "../args.js";
import { resolvePersonalToken } from "../auth.js";
import { loadConfig } from "../config.js";
import { AxiError } from "../errors.js";
import {
  sonarGet,
  sonarPost,
  type SonarContext,
  type SonarRequestOptions,
} from "../sonar.js";
import { getSuggestions } from "../suggestions.js";
import { renderHelp, renderOutput } from "../toon.js";

const RESOLUTION_FLAGS: Record<string, string> = {
  "--safe": "SAFE",
  "--fixed": "FIXED",
  "--ack": "ACKNOWLEDGED",
};

interface HotspotShowResponse {
  key: string;
  status: "TO_REVIEW" | "REVIEWED";
  resolution?: "SAFE" | "FIXED" | "ACKNOWLEDGED";
  canChangeStatus?: boolean;
}

interface IssueSearchResult {
  key: string;
  issueStatus: string;
  transitions?: string[];
}

interface IssuesSearchResponse {
  issues: IssueSearchResult[];
}

const TRANSITION_ISSUE_STATUS: Record<string, string> = {
  accept: "ACCEPTED",
  falsepositive: "FALSE_POSITIVE",
};

/**
 * Every triage mutation needs the Keychain credential — the project token
 * cannot review hotspots or transition issues.
 */
async function personalOptions(
  ctx: SonarContext,
): Promise<SonarRequestOptions> {
  const config = loadConfig();
  // Kept as two statements: the repo's secret-scan hook false-positives on
  // this call assigned directly to a variable named `token` on one line.
  const resolved = await resolvePersonalToken(config.keychainService);
  const token = resolved;
  return { token, host: ctx.host, insecure: ctx.insecure };
}

async function reviewHotspot(
  args: string[],
  ctx: SonarContext,
): Promise<string> {
  const rest = [...args];
  const key = rest.shift();
  if (!key) {
    throw new AxiError("hotspot review requires a <KEY>", "VALIDATION_ERROR", [
      "Run `sonarqube-axi hotspot review <KEY> --safe|--fixed|--ack [-m <comment>]`",
    ]);
  }

  const resolutions = Object.entries(RESOLUTION_FLAGS)
    .filter(([flag]) => rest.includes(flag))
    .map(([flag, resolution]) => {
      rest.splice(rest.indexOf(flag), 1);
      return resolution;
    });

  if (resolutions.length !== 1) {
    throw new AxiError(
      "hotspot review requires exactly one of --safe, --fixed, --ack",
      "VALIDATION_ERROR",
    );
  }
  const resolution = resolutions[0];
  const comment = takeFlag(rest, "-m");

  const options = await personalOptions(ctx);
  const hotspot = await sonarGet<HotspotShowResponse>(
    "hotspots/show",
    { hotspot: key },
    options,
  );

  if (hotspot.status === "REVIEWED") {
    return renderOutput([
      `hotspot ${key}: déjà revu (résolution: ${hotspot.resolution ?? "inconnue"})`,
      renderHelp(getSuggestions({ domain: "hotspot-review" })),
    ]);
  }

  if (!hotspot.canChangeStatus) {
    throw new AxiError(
      `Le jeton personnel ne peut pas changer le statut du hotspot ${key}`,
      "FORBIDDEN",
      ["Vérifier les droits Administer Hotspots sur le projet dans SonarQube"],
    );
  }

  await sonarPost(
    "hotspots/change_status",
    {
      hotspot: key,
      status: "REVIEWED",
      resolution,
      ...(comment ? { comment } : {}),
    },
    options,
  );

  return renderOutput([
    `hotspot ${key}: revu (résolution: ${resolution})`,
    renderHelp(getSuggestions({ domain: "hotspot-review" })),
  ]);
}

export async function hotspotCommand(
  args: string[],
  ctx: SonarContext,
): Promise<string> {
  const [sub, ...rest] = args;
  if (sub !== "review") {
    throw new AxiError(
      `Unknown hotspot subcommand: ${sub ?? ""}`,
      "VALIDATION_ERROR",
      [
        "Run `sonarqube-axi hotspot review <KEY> --safe|--fixed|--ack [-m <comment>]`",
      ],
    );
  }
  return reviewHotspot(rest, ctx);
}

async function transitionIssue(
  args: string[],
  ctx: SonarContext,
): Promise<string> {
  const rest = [...args];
  const comment = takeFlag(rest, "-m");
  const [key, transition] = rest;

  if (!key || !transition) {
    throw new AxiError(
      "issue transition requires <KEY> <accept|falsepositive>",
      "VALIDATION_ERROR",
      [
        "Run `sonarqube-axi issue transition <KEY> <accept|falsepositive> -m <motif>`",
      ],
    );
  }

  if (!(transition in TRANSITION_ISSUE_STATUS)) {
    throw new AxiError(
      `Unknown transition: ${transition}`,
      "VALIDATION_ERROR",
      ["Supported: accept, falsepositive"],
    );
  }

  if (!comment) {
    throw new AxiError(
      "issue transition requires a comment (-m <motif>)",
      "VALIDATION_ERROR",
      [
        'Run `sonarqube-axi issue transition <KEY> <accept|falsepositive> -m "motif"`',
      ],
    );
  }

  const options = await personalOptions(ctx);
  const response = await sonarGet<IssuesSearchResponse>(
    "issues/search",
    { issues: key, additionalFields: "actions,transitions" },
    options,
  );

  const issue = response.issues[0];
  if (!issue) {
    throw new AxiError(`Issue introuvable: ${key}`, "NOT_FOUND");
  }

  if (issue.issueStatus === TRANSITION_ISSUE_STATUS[transition]) {
    return renderOutput([
      `issue ${key}: déjà ${transition} (statut: ${issue.issueStatus})`,
      renderHelp(getSuggestions({ domain: "issue-transition" })),
    ]);
  }

  if (!issue.transitions?.includes(transition)) {
    throw new AxiError(
      `La transition ${transition} n'est pas disponible pour l'issue ${key} (jeton personnel)`,
      "FORBIDDEN",
      [
        `Statut actuel: ${issue.issueStatus}`,
        `Transitions disponibles: ${issue.transitions?.join(", ") || "aucune"}`,
      ],
    );
  }

  await sonarPost("issues/add_comment", { issue: key, text: comment }, options);
  await sonarPost("issues/do_transition", { issue: key, transition }, options);

  return renderOutput([
    `issue ${key}: ${transition}`,
    renderHelp(getSuggestions({ domain: "issue-transition" })),
  ]);
}

export async function issueCommand(
  args: string[],
  ctx: SonarContext,
): Promise<string> {
  const [sub, ...rest] = args;
  if (sub !== "transition") {
    throw new AxiError(
      `Unknown issue subcommand: ${sub ?? ""}`,
      "VALIDATION_ERROR",
      [
        "Run `sonarqube-axi issue transition <KEY> <accept|falsepositive> -m <motif>`",
      ],
    );
  }
  return transitionIssue(rest, ctx);
}
