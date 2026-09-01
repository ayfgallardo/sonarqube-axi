# sonarqube-axi

SonarQube CLI for agents — designed with [AXI](https://github.com/kunchenguid/axi) (Agent eXperience Interface).

Wraps the SonarQube Web API directly (no third-party Sonar client) with token-efficient TOON output, contextual next-step suggestions, and structured AXI error handling. Built on the [glab-axi](https://github.com/ayfgallardo/glab-axi) architecture. Prefer this over raw `curl` calls against the SonarQube Web API.

## Why

A raw SonarQube API response is verbose JSON built for a UI, not an agent: nested objects, per-item fields (`textRange`, `flows`, `author`, timestamps) an agent rarely reads, and no hint of what to do next. `sonarqube-axi` follows the [AXI](https://github.com/kunchenguid/axi) conventions: responses are encoded as [TOON](https://github.com/toon-format/toon) instead of raw JSON, every response carries contextual suggestions for the next command, and failures come back as structured errors instead of a stack trace.

## Install

Not published on npm — install from source:

```sh
git clone https://github.com/ayfgallardo/sonarqube-axi
cd sonarqube-axi
pnpm install
pnpm build
npm install -g .
```

### Prerequisites

- Node.js 20 or newer.
- [`glab`](https://gitlab.com/gitlab-org/cli) installed and authenticated (`glab auth login`) — used to resolve the project's Sonar project key and CI token from GitLab CI/CD variables, and to detect an open MR for the current branch.
- macOS Keychain, for a personal token (only needed for `hotspots`, `analysis` on a locked-down project, and the triage commands).

## Setup

Run once per machine:

```sh
sonarqube-axi setup --host https://sonar.example.com
```

Add `--insecure` for a self-signed server certificate. This writes `~/.config/sonarqube-axi/config.json`. Per-project setup is automatic: the Sonar project key and CI token are read from the GitLab repo's `SONAR_PROJECTKEY` and `SONAR_TOKEN` CI/CD variables via `glab`, cached per repo in `~/.config/sonarqube-axi/context-cache.json`.

For hotspots, the compute-engine analysis status, and triage, register a personal token in the macOS Keychain:

```sh
security add-generic-password -s sonarqube-axi -a "$USER" -w
```

(`--keychain-service <name>` on `setup` to use a different service name — e.g. one matching your organization.)

## Commands

Run from within the repository whose analysis you want to inspect.

| Command                                                                                                        | Purpose                                                                                                   |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `sonarqube-axi`                                                                                                | Dashboard: quality gate + counts at a glance for the current context.                                     |
| `sonarqube-axi qg [--mr <IID> or --branch]`                                                                    | Quality gate status. Defaults to MR mode when an open MR exists for the current branch, else branch mode. |
| `sonarqube-axi issues [--mr <IID> or --branch] [--all]`                                                        | New issues (or all of them with `--all`; `--full` shows untruncated messages).                            |
| `sonarqube-axi hotspots [--mr <IID> or --branch]`                                                              | Security hotspots `TO_REVIEW`.                                                                            |
| `sonarqube-axi analysis`                                                                                       | Compute-engine task status for the last analysis.                                                         |
| `sonarqube-axi hotspot review <KEY> --safe (or --fixed or --ack) [-m "comment"]`                               | Resolve a hotspot review. Mutation.                                                                       |
| `sonarqube-axi issue transition <KEY> <accept or falsepositive> -m "motif"`                                    | Transition an issue. Mutation.                                                                            |
| `sonarqube-axi api <path> [key=value ...] [--method <verb>] [--allow-mutation] [--personal]`                   | Raw SonarQube Web API call, same AXI conventions.                                                         |
| `sonarqube-axi gain`                                                                                           | Token savings recorded by this CLI: totals and per-command breakdown.                                     |
| `sonarqube-axi setup [--host <url>] [--insecure or --no-insecure] [--keychain-service <name>] [--clear-cache]` | Configure or inspect the local host/token setup.                                                          |

Run `sonarqube-axi --help` or `sonarqube-axi <command> --help` for exact flags.

## Encoded traps

A few behaviors that don't show up from the command names alone:

- **A green quality gate can be stale.** `qg` reads the _last computed_ gate; if the compute-engine task for the most recent push hasn't finished, the gate you see predates it. Run `analysis` first when the timing matters.
- **A green gate can also be non-conclusive.** `qg` flags `ignoredConditions: true` explicitly — SonarQube skips new-code conditions on a changeset too small to evaluate meaningfully (~<20 new lines), and a plain `OK` there would misrepresent an unevaluated gate as a pass.
- **MR mode vs branch mode.** `qg`/`issues`/`hotspots` default to MR mode when an open MR exists for the current branch (via `glab`), branch mode otherwise. `--mr <IID>` or `--branch` overrides the default; the two modes read different SonarQube resources (pull-request vs branch parameters) and can disagree. Branch mode is also cumulative since the last new-code period, not scoped to one merge request.
- **Token fallback.** The project CI token can read the quality gate and issues but not hotspots or the compute-engine task status — `hotspots` and `analysis` retry automatically with the personal Keychain token on a 403 (`--personal` does the same on `api`). `hotspot review` and `issue transition` always use the personal token.
- **Auth scheme fallback.** Every request tries a Bearer token first, then falls back to HTTP Basic (token as login, empty password) on a 401 — needed for SonarQube versions predating Bearer support.

## Token savings

Every invocation that talks to SonarQube appends one line to
`~/Library/Application Support/axi/sonarqube-axi.jsonl` (XDG data directory elsewhere):

```json
{
  "ts": 1788284652,
  "cli": "sonarqube-axi",
  "cmd": "hotspots",
  "raw": 8968,
  "out": 1574,
  "ms": 370
}
```

`raw` is the token count of the decompressed JSON of every HTTP response of that
invocation — what an agent would have ingested calling the API itself — and `out` the
token count of the rendered output. `sonarqube-axi gain` reports the accumulated totals.

- **Only the sub-command name is recorded.** Never arguments, flag values, project keys,
  URLs or payload fragments; the log holds integers and command names.
- `AXI_GAIN=0` disables recording entirely.
- Recording can never fail a command, and never delays its output: the tokenizer is
  imported after stdout is written, which costs ~80 ms before the process exits.
- The counts are lower than the [benchmark](#benchmark) below on small payloads: the
  benchmark's raw baseline is pretty-printed JSON, while the recorder counts the compact
  bytes the server actually sends.

## Benchmark

Tokens (`o200k_base`, via `gpt-tokenizer`) of the equivalent raw SonarQube API JSON vs `sonarqube-axi` output, on the three read commands with the richest payloads. Fixtures in `scripts/fixtures/` are synthetic (fabricated file paths, dates and identifiers) but reproduce the shape and volume of a real project's response (e.g. 29 hotspots across 8 files) so the comparison stays representative; rerun with `pnpm bench`.

| Commande | Tokens curl brut | Tokens sonarqube-axi | Delta % | Note                                                     |
| -------- | ---------------- | -------------------- | ------- | -------------------------------------------------------- |
| qg       | 446              | 132                  | -70.4%  |                                                          |
| issues   | 78               | 26                   | -66.7%  | paire quasi vide (0 nouvelle issue sur ce projet à date) |
| hotspots | 9206             | 1571                 | -82.9%  |                                                          |

Delta médian : -70.4 %. `hotspots` saves the most: SonarQube's raw hotspot payload carries per-item fields (`textRange`, `flows`, `author`, `assignee`, timestamps) that a triage workflow never reads — `sonarqube-axi` keeps only key, file, line, message, probability and category.

## License

MIT
