import { resolveMode } from "../mr.js";
import { sonarGet, type SonarContext, type SonarParams } from "../sonar.js";
import { getSuggestions } from "../suggestions.js";
import {
  field,
  renderDetail,
  renderHelp,
  renderList,
  renderOutput,
} from "../toon.js";

interface ProjectStatusCondition {
  status: "OK" | "ERROR";
  metricKey: string;
  comparator: string;
  errorThreshold: string;
  actualValue: string;
}

interface ProjectStatusResponse {
  projectStatus: {
    status: "OK" | "ERROR" | "NONE";
    conditions: ProjectStatusCondition[];
    ignoredConditions: boolean;
    period?: { mode: string; date: string };
  };
}

interface MeasuresResponse {
  component: {
    measures: { metric: string; period?: { value: string } }[];
  };
}

const NEW_LINES_METRIC = "new_lines";

function modeParams(mode: {
  kind: "mr" | "branch";
  mrIid?: string;
  branch?: string;
}): SonarParams {
  return mode.kind === "mr"
    ? { pullRequest: mode.mrIid }
    : { branch: mode.branch };
}

function newLinesOf(measures: MeasuresResponse): number | undefined {
  const measure = measures.component.measures.find(
    (m) => m.metric === NEW_LINES_METRIC,
  );
  const value = measure?.period?.value;
  return value === undefined ? undefined : Number(value);
}

/**
 * `ignoredConditions: true` means the changeset is too small (~<20 new lines)
 * for SonarQube to evaluate new-code conditions meaningfully — a green gate
 * there is not a real pass, so it must never read as a plain OK.
 */
function verdictOf(
  status: "OK" | "ERROR" | "NONE",
  ignoredConditions: boolean,
): string {
  if (status === "OK" && ignoredConditions) {
    return "gate vert non concluant (changeset trop petit pour évaluer le nouveau code)";
  }
  if (status === "OK") {
    return "OK";
  }
  if (status === "ERROR") {
    return "ERROR";
  }
  return "NONE";
}

export async function qgCommand(
  args: string[],
  ctx: SonarContext,
): Promise<string> {
  const { mode, strippedArgs } = await resolveMode(
    args,
    ctx.mrIid,
    ctx.repoPath,
  );
  void strippedArgs;

  const params = modeParams(mode);
  const options = { token: ctx.token, host: ctx.host, insecure: ctx.insecure };

  const [statusResponse, measuresResponse] = await Promise.all([
    sonarGet<ProjectStatusResponse>(
      "qualitygates/project_status",
      { projectKey: ctx.projectKey, ...params },
      options,
    ),
    sonarGet<MeasuresResponse>(
      "measures/component",
      {
        component: ctx.projectKey,
        metricKeys: [
          "new_coverage",
          "new_violations",
          "new_security_hotspots_reviewed",
          "new_duplicated_lines_density",
          NEW_LINES_METRIC,
        ].join(","),
        ...params,
      },
      options,
    ),
  ]);

  const { status, conditions, ignoredConditions, period } =
    statusResponse.projectStatus;
  const verdict = verdictOf(status, ignoredConditions);
  const newLines = newLinesOf(measuresResponse);

  const detail: Record<string, unknown> = {
    mode: mode.kind,
    ...(mode.kind === "mr" ? { mr: mode.mrIid } : { branch: mode.branch }),
    verdict,
    // `new_lines` is always shown — it is what explains an ignored-conditions verdict.
    new_lines: newLines ?? null,
  };

  if (mode.kind === "branch") {
    // A branch-mode gate cumulates since `period`, not just the last MR — a
    // red here can be inherited from an earlier change, and this is not a
    // pass/fail verdict for a specific merge request.
    detail["non_conclusif_pour_une_mr"] = true;
    if (period) {
      detail["period_mode"] = period.mode;
      detail["period_date"] = period.date;
    }
  }

  return renderOutput([
    renderDetail("qg", detail, [
      field("mode"),
      field(mode.kind === "mr" ? "mr" : "branch"),
      field("verdict"),
      field("new_lines"),
      ...(mode.kind === "branch"
        ? [
            field("non_conclusif_pour_une_mr"),
            field("period_mode"),
            field("period_date"),
          ]
        : []),
    ]),
    renderList("conditions", conditions, [
      field("metricKey", "metric"),
      field("comparator"),
      field("errorThreshold", "threshold"),
      field("actualValue", "actual"),
      field("status"),
    ]),
    renderHelp(
      getSuggestions({
        domain: "qg",
        gateStatus: status === "ERROR" ? "ERROR" : "OK",
      }),
    ),
  ]);
}
