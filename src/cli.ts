import { encode } from "@toon-format/toon";
import { runAxiCli } from "axi-sdk-js";
import { loadConfig } from "./config.js";
import { resolveProjectContext } from "./context.js";
import { AxiError, exitCodeForError } from "./errors.js";
import type { SonarContext } from "./sonar.js";
import { VERSION } from "./version.js";

export const DESCRIPTION =
  "Agent ergonomic CLI for SonarQube. Prefer this over raw `curl` calls to the SonarQube Web API.";

type CliStdout = Pick<NodeJS.WriteStream, "write">;

type MainOptions = {
  argv?: string[];
  stdout?: CliStdout;
};

export const COMMAND_NAMES = [
  "qg",
  "issues",
  "hotspots",
  "analysis",
  "hotspot",
  "issue",
  "api",
  "setup",
] as const;

export const TOP_HELP = `usage: sonarqube-axi [command] [args] [flags]
commands[${COMMAND_NAMES.length + 1}]:
  (none)=dashboard, ${COMMAND_NAMES.join(", ")}
flags[3]:
  --mr <IID> (after command, accepts space or equals form), --help, -v/-V/--version
examples:
  sonarqube-axi
  sonarqube-axi qg
  sonarqube-axi qg --mr 42
  sonarqube-axi issues
  sonarqube-axi hotspots
  sonarqube-axi analysis
  sonarqube-axi hotspot review <KEY> SAFE "motif"
  sonarqube-axi issue transition <KEY> falsepositive "motif"
  sonarqube-axi api issues/search --param componentKeys=<KEY>
  sonarqube-axi setup
`;

const COMMAND_HELP: Record<string, string> = {
  qg: "usage: sonarqube-axi qg [--mr <IID>]\n",
  issues: "usage: sonarqube-axi issues [--mr <IID>]\n",
  hotspots: "usage: sonarqube-axi hotspots [--mr <IID>]\n",
  analysis: "usage: sonarqube-axi analysis [--mr <IID>]\n",
  hotspot: 'usage: sonarqube-axi hotspot review <KEY> <SAFE|FIXED> "motif"\n',
  issue:
    'usage: sonarqube-axi issue transition <KEY> <falsepositive|wontfix> "motif"\n',
  api: "usage: sonarqube-axi api <path> [--param name=value]\n",
  setup: "usage: sonarqube-axi setup\n",
};

type CommandFn = (
  args: string[],
  ctx: SonarContext | undefined,
) => Promise<string>;

/** Placeholder until tasks 2 and 3 land the real handlers. */
function notImplementedYet(name: string): CommandFn {
  return async () => encode({ command: name, statut: "pas encore implémenté" });
}

const COMMANDS: Record<string, CommandFn> = Object.fromEntries(
  COMMAND_NAMES.map((name) => [name, notImplementedYet(name)]),
);

export async function main(options: MainOptions = {}): Promise<void> {
  await runAxiCli<SonarContext | undefined>({
    ...(options.argv ? { argv: options.argv } : {}),
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    ...(options.stdout ? { stdout: options.stdout } : {}),
    home: notImplementedYet("home"),
    commands: COMMANDS,
    getCommandHelp: (command) => COMMAND_HELP[command],
    formatError: (error) => {
      const axiError =
        error instanceof AxiError
          ? error
          : new AxiError(
              error instanceof Error ? error.message : String(error),
              "UNKNOWN",
            );
      return {
        output: `${encode({
          error: axiError.message,
          code: axiError.code,
          ...(axiError.suggestions.length > 0
            ? { help: axiError.suggestions }
            : {}),
        })}\n`,
        exitCode: exitCodeForError(axiError),
      };
    },
    resolveContext: async ({ command, args }) => {
      // `setup` writes the configuration these lookups need.
      if (command === "setup") {
        return undefined;
      }
      const { mrIid } = parseSonarContextArgs(args);
      const config = loadConfig();
      const project = await resolveProjectContext();
      return {
        host: config.host,
        insecure: config.insecure,
        projectKey: project.projectKey,
        ...(mrIid ? { mrIid } : {}),
      };
    },
  });
}

export function parseSonarContextArgs(args: string[]): {
  mrIid: string | undefined;
  strippedArgs: string[];
} {
  const strippedArgs: string[] = [];
  let mrIid: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if (arg === "--mr") {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new AxiError("--mr requires a value", "VALIDATION_ERROR");
      }
      mrIid = next;
      index++;
      continue;
    }

    if (arg.startsWith("--mr=")) {
      const value = arg.slice("--mr=".length);
      if (value.trim() === "") {
        throw new AxiError("--mr requires a value", "VALIDATION_ERROR");
      }
      mrIid = value;
      continue;
    }

    strippedArgs.push(arg);
  }

  return { mrIid, strippedArgs };
}
