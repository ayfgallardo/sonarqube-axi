import { encode } from "@toon-format/toon";
import { runAxiCli } from "axi-sdk-js";
import { analysisCommand } from "./commands/analysis.js";
import { homeCommand } from "./commands/home.js";
import { hotspotsCommand } from "./commands/hotspots.js";
import { issuesCommand } from "./commands/issues.js";
import { qgCommand } from "./commands/qg.js";
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
  qg: "usage: sonarqube-axi qg [--mr <IID>|--branch]\n",
  issues:
    "usage: sonarqube-axi issues [--mr <IID>|--branch] [--full] [--all]\n",
  hotspots: "usage: sonarqube-axi hotspots [--mr <IID>|--branch]\n",
  analysis: "usage: sonarqube-axi analysis\n",
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

/** Placeholder until task 3 lands the write handlers. */
function notImplementedYet(name: string): CommandFn {
  return async (args) =>
    encode({ command: name, args, statut: "pas encore implémenté" });
}

/** Read commands need a resolved context — only `setup` runs without one. */
function requireContext(
  handler: (args: string[], ctx: SonarContext) => Promise<string>,
): CommandFn {
  return async (args, ctx) => {
    if (!ctx) {
      throw new AxiError("Contexte SonarQube manquant", "CONTEXT_MISSING");
    }
    return handler(args, ctx);
  };
}

/**
 * `resolveContext` reads --mr out of the args, but the SDK hands the handler
 * the raw argv, so every command is wrapped to see only the flags it owns.
 */
export function withStrippedArgs(handler: CommandFn): CommandFn {
  return (args, ctx) => handler(parseSonarContextArgs(args).strippedArgs, ctx);
}

const READ_COMMANDS: Record<
  string,
  (args: string[], ctx: SonarContext) => Promise<string>
> = {
  qg: qgCommand,
  issues: issuesCommand,
  hotspots: hotspotsCommand,
  analysis: analysisCommand,
};

const COMMANDS: Record<string, CommandFn> = Object.fromEntries(
  COMMAND_NAMES.map((name) => [
    name,
    withStrippedArgs(
      READ_COMMANDS[name]
        ? requireContext(READ_COMMANDS[name])
        : notImplementedYet(name),
    ),
  ]),
);

export async function main(options: MainOptions = {}): Promise<void> {
  await runAxiCli<SonarContext | undefined>({
    ...(options.argv ? { argv: options.argv } : {}),
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    ...(options.stdout ? { stdout: options.stdout } : {}),
    home: withStrippedArgs(requireContext(homeCommand)),
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
        repoPath: project.repoPath,
        token: project.token,
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
