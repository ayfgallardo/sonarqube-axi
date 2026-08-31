# sonarqube-axi — contrat du repo

CLI AXI pour SonarQube. Architecture calquée sur glab-axi : `bin/` fast-path
`--version`, `src/cli.ts` routage pur via `runAxiCli` (axi-sdk-js), un module
par famille de commandes dans `src/commands/`, rendu TOON via `src/toon.ts`.
Commandes : `qg`, `issues`, `hotspots`, `analysis`, `hotspot review`,
`issue transition`, `api`, `setup` — surface documentée dans `README.md` et
`skills/sonarqube-axi/SKILL.md`.

## Contraintes dures

- **Aucun token, aucune clé de projet Sonar réelle, aucune URL d'instance
  interne** dans le repo — code, tests, fixtures, docs.
- Pas de client Sonar tiers : appels HTTP directs à l'API SonarQube.

## Auth

- Jeton projet (CI, `SONAR_TOKEN`) : lit la quality gate et les issues.
- Jeton personnel (Trousseau macOS, service par défaut `sonar-geofoncier`) :
  seul à pouvoir lire les hotspots et le statut compute-engine (`ce/component`)
  et à effectuer les mutations de triage. `hotspots` et `analysis` basculent
  automatiquement dessus sur un 403 ; `hotspot review` et `issue transition`
  l'utilisent directement.
- Un dispatcher `undici.Agent` custom (mode `insecure`, certificat auto-signé)
  n'active pas la décompression automatique des réponses gzip par défaut —
  composer explicitement `interceptors.decompress()` dessus (voir
  `src/sonar.ts`), sans quoi un serveur qui gzip ses réponses (nginx en
  frontal) renvoie des octets bruts illisibles.

## Développement

- `pnpm build` (tsc), `pnpm test` (vitest) et `pnpm lint` doivent rester verts.
- `pnpm bench` rejoue le benchmark de tokens (`scripts/benchmark.ts`).
- Commits directs sur main, messages en **anglais**, types conventionnels.
