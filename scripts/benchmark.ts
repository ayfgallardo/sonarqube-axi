import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { countTokens } from "gpt-tokenizer/model/gpt-4o";

const FIXTURES_DIR = fileURLToPath(new URL("fixtures/", import.meta.url));

function read(name: string): string {
  return readFileSync(`${FIXTURES_DIR}${name}`, "utf-8");
}

interface Case {
  name: string;
  raw: string;
  axi: string;
  note?: string;
}

const cases: Case[] = [
  {
    name: "qg",
    raw: read("qg-status.json") + read("qg-measures.json"),
    axi: read("qg-axi-output.txt"),
  },
  {
    name: "issues",
    raw: read("issues-search.json"),
    axi: read("issues-axi-output.txt"),
    note: "paire quasi vide (0 nouvelle issue sur ce projet à date)",
  },
  {
    name: "hotspots",
    raw: read("hotspots-search.json"),
    axi: read("hotspots-axi-output.txt"),
  },
];

interface Row {
  name: string;
  rawTokens: number;
  axiTokens: number;
  deltaPct: number;
  note?: string;
}

function main(): void {
  const rows: Row[] = cases.map((c) => {
    const rawTokens = countTokens(c.raw);
    const axiTokens = countTokens(c.axi);
    const deltaPct =
      rawTokens === 0 ? 0 : ((axiTokens - rawTokens) / rawTokens) * 100;
    return { name: c.name, rawTokens, axiTokens, deltaPct, note: c.note };
  });

  const lines: string[] = [];
  lines.push(
    `| Commande | Tokens curl brut | Tokens sonarqube-axi | Delta % | Note |`,
  );
  lines.push(`| --- | --- | --- | --- | --- |`);
  for (const row of rows) {
    const delta = `${row.deltaPct >= 0 ? "+" : ""}${row.deltaPct.toFixed(1)}%`;
    lines.push(
      `| ${row.name} | ${row.rawTokens} | ${row.axiTokens} | ${delta} | ${row.note ?? ""} |`,
    );
  }
  console.log(lines.join("\n"));

  const sorted = rows.map((r) => r.deltaPct).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  console.error(`\nDelta médian: ${median.toFixed(1)}%`);
}

main();
