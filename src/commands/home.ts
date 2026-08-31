import type { SonarContext } from "../sonar.js";
import { qgCommand } from "./qg.js";

/** The default no-args command is the quality gate of the current MR (or branch). */
export async function homeCommand(
  args: string[],
  ctx: SonarContext,
): Promise<string> {
  return qgCommand(args, ctx);
}
