---
name: sonarqube-axi
description: "Operate SonarQube through the sonarqube-axi CLI - quality gate status, new issues, security hotspots, compute-engine analysis status, hotspot review, issue transition (accept/false-positive), and raw API access. Use whenever a task touches SonarQube: checking a quality gate before merging, reviewing new issues or security hotspots on a branch or MR, triaging a hotspot, or transitioning an issue."
user-invocable: false
author: Florian Gallardo (ayfgallardo)
metadata:
  hermes:
    tags: [sonarqube, quality-gate, code-quality, security]
    category: devops
---

# sonarqube-axi

Agent ergonomic CLI for the SonarQube Web API. Prefer this over raw `curl` calls to SonarQube.

Use sonarqube-axi whenever a task touches SonarQube: quality gate checks before merging, listing
new issues or security hotspots on a branch or MR, checking whether the compute-engine analysis
for a push has finished, triaging a hotspot, or transitioning an issue.

## When to use

- Before opening or merging an MR: `qg` to check the quality gate is green.
- Reviewing what a change introduced: `issues`, `hotspots`.
- After a push, before trusting a quality gate: `analysis` — a gate can be stale if the
  compute-engine task hasn't finished yet (see trap below).
- Triaging a specific hotspot or issue: `hotspot review`, `issue transition`.
- Anything not covered by a dedicated command: `api`.

## Setup

Run once per machine: `sonarqube-axi setup --host <url>` (add `--insecure` for a self-signed
server certificate). The project's Sonar project key and CI token are resolved automatically
from the GitLab repo's CI/CD variables (`SONAR_PROJECTKEY`, `SONAR_TOKEN`) via `glab` — no
per-project configuration needed. `hotspots` and `analysis` additionally need a personal token in
the macOS Keychain (service `sonarqube-axi` by default — set the real service name locally with
`setup --keychain-service <name>` — `security add-generic-password -s sonarqube-axi -a "$USER"
-w`): the project CI token can read the quality gate and issues, but
not hotspots or the compute-engine task status — both commands fall back to it automatically on
a 403.

## Commands

Run from within the repository whose analysis you want to inspect (its GitLab origin must
carry `SONAR_PROJECTKEY` and `SONAR_TOKEN`).

| Command                                                                                                        | Purpose                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sonarqube-axi`                                                                                                | Dashboard: quality gate + counts at a glance for the current context.                                                                                            |
| `sonarqube-axi qg [--mr <IID> or --branch]`                                                                    | Quality gate status. Defaults to the MR mode if an open MR exists for the current branch, else branch mode.                                                      |
| `sonarqube-axi issues [--mr <IID> or --branch] [--all]`                                                        | New issues (or all issues with `--all`).                                                                                                                         |
| `sonarqube-axi hotspots [--mr <IID> or --branch]`                                                              | Security hotspots `TO_REVIEW`. Requires the personal token.                                                                                                      |
| `sonarqube-axi analysis`                                                                                       | Compute-engine task status for the last analysis of the project.                                                                                                 |
| `sonarqube-axi hotspot review <KEY> --safe (or --fixed or --ack) [-m "comment"]`                               | Resolve a hotspot review (safe/fixed/acknowledge). Mutation — never run without an explicit go.                                                                  |
| `sonarqube-axi issue transition <KEY> <accept or falsepositive> -m "motif"`                                    | Transition an issue. Mutation — never run without an explicit go.                                                                                                |
| `sonarqube-axi api <path> [key=value ...] [--method <verb>] [--allow-mutation] [--personal]`                   | Raw SonarQube Web API call, same AXI conventions (`--allow-mutation` required for non-GET, `--personal` to use the Keychain token instead of the project token). |
| `sonarqube-axi gain`                                                                                           | Token savings recorded by this CLI (raw API JSON vs rendered output), totals and per-command breakdown.                                                          |
| `sonarqube-axi setup [--host <url>] [--insecure or --no-insecure] [--keychain-service <name>] [--clear-cache]` | Configure or inspect the local host/token setup.                                                                                                                 |

Every command accepts `--help` for its exact flags — treat this table as a map of the surface,
`--help` as the source of truth for details.

## Examples

```
sonarqube-axi qg
sonarqube-axi qg --mr 42
sonarqube-axi issues --all
sonarqube-axi hotspots
sonarqube-axi analysis
sonarqube-axi hotspot review AbCdEf123 --safe -m "reviewed, no injection path"
sonarqube-axi issue transition AbCdEf123 falsepositive -m "test fixture, not prod code"
sonarqube-axi api issues/search componentKeys=<PROJECT_KEY>
sonarqube-axi gain
```

## Encoded traps

- **A green quality gate can be stale.** `qg` reads the _last computed_ gate; if the
  compute-engine task for the most recent push hasn't finished, the gate you see predates it.
  Run `analysis` first when the timing matters.
- **MR mode vs branch mode.** `qg`/`issues`/`hotspots` default to MR mode when an open MR
  exists for the current branch (via `glab`), branch mode otherwise. `--mr <IID>` or `--branch`
  overrides the default; the two modes read different SonarQube resources (pull-request vs
  branch parameters) and can disagree.
- **Token fallback.** The project CI token can read the quality gate and issues but not
  hotspots or the compute-engine task status — `hotspots` and `analysis` retry automatically
  with the personal Keychain token on a 403 (`--personal` does the same on `api`). `hotspot
review` and `issue transition` always use the personal token directly, no fallback needed.
