# sonarqube-axi — contrat du repo

CLI AXI pour SonarQube. Architecture calquée sur glab-axi : `bin/` fast-path
`--version`, `src/cli.ts` routage pur via `runAxiCli` (axi-sdk-js), un module
par famille de commandes dans `src/commands/`, rendu TOON via `src/toon.ts`.
Ces fichiers n'existent pas encore — squelette de bootstrap uniquement.

## Contraintes dures

- **Aucun token, aucune clé de projet Sonar réelle, aucune URL d'instance
  interne** dans le repo — code, tests, fixtures, docs.
- Pas de client Sonar tiers : appels HTTP directs à l'API SonarQube.

## Développement

- `pnpm build` (tsc) et `pnpm test` (vitest) doivent rester verts.
- Commits directs sur main, messages en français, types conventionnels.
