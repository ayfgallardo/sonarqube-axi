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

export async function analysisCommand(
  _args: string[],
  ctx: SonarContext,
): Promise<string> {
  const response = await sonarGet<CeComponentResponse>(
    "ce/component",
    { component: ctx.projectKey },
    { token: ctx.token, host: ctx.host, insecure: ctx.insecure },
  );

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
