import { takeBoolFlag } from "../args.js";
import { formatCountLine, truncateText } from "../format.js";
import { resolveMode } from "../mr.js";
import { sonarGet, type SonarContext, type SonarParams } from "../sonar.js";
import { getSuggestions } from "../suggestions.js";
import {
  custom,
  field,
  renderHelp,
  renderList,
  renderOutput,
} from "../toon.js";

interface Issue {
  key: string;
  rule: string;
  severity?: string;
  impacts?: { softwareQuality: string; severity: string }[];
  component: string;
  line?: number;
  message: string;
}

interface IssuesSearchResponse {
  total: number;
  issues: Issue[];
}

const DISPLAY_LIMIT = 20;
const MESSAGE_MAX_LEN = 200;

function fileOf(component: string, projectKey: string): string {
  return component.startsWith(`${projectKey}:`)
    ? component.slice(projectKey.length + 1)
    : component;
}

function impactOf(issue: Issue): string {
  const first = issue.impacts?.[0];
  return first
    ? `${first.softwareQuality}:${first.severity}`
    : (issue.severity ?? "");
}

export async function issuesCommand(
  args: string[],
  ctx: SonarContext,
): Promise<string> {
  const strippedArgs = [...args];
  const full = takeBoolFlag(strippedArgs, "--full");
  const all = takeBoolFlag(strippedArgs, "--all");

  const { mode } = await resolveMode(strippedArgs, ctx.mrIid, ctx.repoPath);
  const params: SonarParams =
    mode.kind === "mr" ? { pullRequest: mode.mrIid } : { branch: mode.branch };

  const response = await sonarGet<IssuesSearchResponse>(
    "issues/search",
    {
      components: ctx.projectKey,
      issueStatuses: "OPEN,CONFIRMED",
      inNewCodePeriod: true,
      ps: 500,
      ...params,
    },
    { token: ctx.token, host: ctx.host, insecure: ctx.insecure },
  );

  const items = all ? response.issues : response.issues.slice(0, DISPLAY_LIMIT);

  if (response.issues.length === 0) {
    return renderOutput([
      "issues: aucune issue neuve",
      renderHelp(getSuggestions({ domain: "issues", isEmpty: true })),
    ]);
  }

  return renderOutput([
    formatCountLine(response.issues.length, all ? undefined : DISPLAY_LIMIT),
    renderList("issues", items, [
      field("key"),
      field("rule"),
      custom("impact", impactOf),
      custom("file", (issue: Issue) => fileOf(issue.component, ctx.projectKey)),
      field("line"),
      custom("message", (issue: Issue) =>
        truncateText(issue.message, MESSAGE_MAX_LEN, full),
      ),
    ]),
    renderHelp(getSuggestions({ domain: "issues", isEmpty: false })),
  ]);
}
