# Portage TypeScript : plan de migration

Objectif : basculer progressivement le CLI en TS strict en limitant les régressions. Les priorités P1/P2/P3 ci-dessous correspondent au balisage inséré dans le code.

## Étape 0 — Pré-requis
- Installer les typings manquants : `npm i -D @types/js-yaml`.
- Garder `allowJs` et `strict` désactivés pour avancer incrémentalement ; réactiver `noImplicitAny` via un tsconfig secondaire pour les modules ciblés.

## Étape 1 — Modules cœur (P1)
- `cli/commands/agent.ts` : typer handlers (program/options/taskId), événements Agent, discriminer les états (spawned/running/collected) pour supprimer les implicit `any`.
- `cli/commands/assign.ts` : typer options/ID, sécuriser frontmatter (null checks), factoriser normalisation/lookup.
- `cli/lib/worktree.ts` : typer branch/status/git divergence, encapsuler les exec git dans helpers typés.
- `cli/lib/state.ts` : définir un type State (counters, agents, assignments, runs) et l’utiliser dans load/save.
- `cli/lib/reconciliation.ts` : typer contexte/branche hiérarchie, guards sur branching.
- `cli/lib/state-machine/*` : typer diag/guards/machine (ctx/event), enlever les `never` dus aux `any` implicites.

## Étape 2 — Utilitaires (P2)
- `cli/lib/memory.ts` : introduire `MemoryEntry` (id/path/content/sections), typer IDs/contents, séparer parsing pur / helpers CLI.
- `cli/lib/help.ts` : wrapper Commander pour éviter `_args/options` internes.
- `cli/lib/version.ts` : déjà patché pour CLI version ; garder `getMainVersion` pour `rudder versions`.
- `cli/lib/paths.ts` : typer placeholders/path config (projectHash cache), nettoyer les index signatures.
- `cli/lib/update.ts`, `cli/lib/index.ts` : typer collections (task/epic/prd/memory) pour retirer les implicit `any`.

## Étape 3 — Surface CLI (P3)
- `cli/commands/*` restants : typer options/args via Commander generics ou wrappers maison ; extraire helpers communs.
- `cli/lib/jsondb.ts` : passer en génériques `Collection<T>` avec Query/Update typés.
- `cli/lib/config.ts` : mapped types dérivées de CONFIG_SCHEMA/PATHS_SCHEMA pour `getConfigValue`/`getPathsInfo`.

## Stratégie de vérification
- Activer temporairement un `tsconfig.strict.json` (noEmit) ciblant un sous-ensemble de fichiers (via `include`/`files`) pour détecter les regressions sans bloquer le build principal.
- Ajouter `// @ts-check` sur les fichiers JS encore non migrés pour remonter les types évidents.
- CI locale : `npm run --workspace cli build` + `npm test`.

## Dépendances/outillage
- Typings : `@types/js-yaml`.
- Outils : `tsx` déjà présent ; considérer `ts-node` uniquement si besoin de tests TS directs (optionnel).

## Notes
- `bin/rudder --version` utilise `getCliVersion()` (package.json) ; `rudder versions` continue de lire `components.yaml`.
- Les commentaires TODO[P1/P2/P3] dans les fichiers guident l’ordre de migration.
