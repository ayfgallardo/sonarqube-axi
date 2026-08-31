interface SuggestionContext {
  domain: string;
  /** True gate status (OK/ERROR), independent of `verdict`. */
  gateStatus?: "OK" | "ERROR";
  isEmpty?: boolean;
  remaining?: number;
}

type SuggestionEntry = {
  match: (ctx: SuggestionContext) => boolean;
  lines: (ctx: SuggestionContext) => string[];
};

const table: SuggestionEntry[] = [
  {
    match: (c) => c.domain === "home",
    lines: () => [
      "Run `sonarqube-axi qg` for the quality gate detail",
      "Run `sonarqube-axi issues` and `sonarqube-axi hotspots` for what to fix",
    ],
  },

  // Quality gate
  {
    match: (c) => c.domain === "qg" && c.gateStatus === "ERROR",
    lines: () => [
      "Run `sonarqube-axi issues` to see the new issues driving the gate",
      "Run `sonarqube-axi hotspots` to see unreviewed security hotspots",
    ],
  },
  {
    match: (c) => c.domain === "qg",
    lines: () => [],
  },

  // Issues
  {
    match: (c) => c.domain === "issues" && c.isEmpty === true,
    lines: () => ["Run `sonarqube-axi hotspots` to see remaining hotspots"],
  },
  {
    match: (c) => c.domain === "issues",
    lines: () => [
      'Run `sonarqube-axi issue transition <KEY> <accept|falsepositive> -m "motif"` to triage one',
    ],
  },

  // Hotspots
  {
    match: (c) => c.domain === "hotspots" && (c.remaining ?? 0) > 0,
    lines: () => [
      'Run `sonarqube-axi hotspot review <KEY> --safe|--fixed|--ack -m "motif"` to review one',
    ],
  },
  {
    match: (c) => c.domain === "hotspots",
    lines: () => [],
  },

  // Analysis
  {
    match: (c) => c.domain === "analysis",
    lines: () => ["Run `sonarqube-axi qg` once the analysis finishes"],
  },

  // Triage
  {
    match: (c) => c.domain === "hotspot-review",
    lines: () => ["Run `sonarqube-axi hotspots` to see the remaining hotspots"],
  },
  {
    match: (c) => c.domain === "issue-transition",
    lines: () => ["Run `sonarqube-axi issues` to see the remaining issues"],
  },
];

export function getSuggestions(ctx: SuggestionContext): string[] {
  for (const entry of table) {
    if (entry.match(ctx)) {
      return entry.lines(ctx);
    }
  }
  return [];
}
