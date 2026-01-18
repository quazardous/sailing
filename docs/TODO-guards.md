# TODO: Guard System with LiquidJS Templates

## Objectif

Remplacer les checks dispersés dans les commandes CLI par un système déclaratif de guards basé sur YAML + LiquidJS.

## Problème actuel

- Logique de prévention dupliquée dans chaque commande
- Messages d'erreur incohérents
- Pas de visibilité sur les permissions par rôle
- Difficile de maintenir les recommendations/actions

## Solution proposée

### 1. Fichier de guards centralisé

```yaml
# prompting/guards.yaml

guards:
  <command>:
    vars:
      # Déclaration des variables runtime (pas config)
      <varName>: { type: string|boolean|number|array, required: true|false, default: value }

    checks:
      - id: <check_id>
        when: "{{ condition LiquidJS }}"
        level: error|warn  # error = exit, warn = continue
        message: |
          Message template avec {{ variables }}
        hint: "Conseil optionnel"
        actions:
          - { cmd: "commande", label: "Description" }
        exit: <code>  # Si level=error
```

### 2. Variables disponibles

**Toujours disponibles (implicites)** :
- `config.*` - Configuration depuis rudder.yaml
- `role` - Role actuel (agent|skill|coordinator)
- `command` - Commande CLI en cours

**Variables runtime (à déclarer dans `vars:`)** :
- Doivent être passées explicitement par la commande
- Validées au runtime (type, required)
- Defaults appliqués si non fournies

### 3. API TypeScript

```typescript
import { checkGuards, GuardResult } from '../lib/guards.js';

// Dans une commande CLI
const result: GuardResult = checkGuards('agent:spawn', {
  taskId: 'T001',
  gitClean: false,
  hasWorktree: true,
  runningAgents: 2
});

if (!result.ok) {
  console.error(result.output);  // Message formaté
  process.exit(result.exitCode);
}

// Ou pour les warnings
for (const warn of result.warnings) {
  console.warn(warn.output);
}
```

### 4. Structure GuardResult

```typescript
interface GuardResult {
  ok: boolean;
  exitCode: number;
  output: string;           // Message principal formaté
  warnings: GuardWarning[]; // Warnings (level: warn)
  errors: GuardError[];     // Errors (level: error)
  actions: Action[];        // Actions recommandées
}

interface Action {
  cmd: string;
  label: string;
}
```

## Exemples de guards

### agent:spawn

```yaml
guards:
  agent:spawn:
    vars:
      taskId: { type: string, required: true }
      gitClean: { type: boolean, required: true }
      hasWorktree: { type: boolean, default: false }
      runningAgents: { type: number, default: 0 }
      blockedBy: { type: array, default: [] }

    checks:
      - id: role_denied
        when: "{{ role == 'agent' }}"
        level: error
        message: "Agents cannot spawn other agents"
        hint: "Escalate to coordinator"
        exit: 1

      - id: uncommitted_changes
        when: "{{ gitClean == false }}"
        level: error
        message: |
          ⚠ Cannot spawn {{ taskId }}
          Uncommitted changes in working directory
        actions:
          - { cmd: "git stash", label: "Stash changes" }
          - { cmd: "git commit -am 'wip'", label: "Commit WIP" }
        exit: 1

      - id: parallel_no_worktree
        when: "{{ runningAgents > 0 and hasWorktree == false }}"
        level: error
        message: "Cannot spawn parallel agents without worktree mode"
        hint: "Enable use_worktrees in rudder.yaml"
        exit: 1

      - id: blocked_deps
        when: "{{ blockedBy.size > 0 }}"
        level: error
        message: |
          Task {{ taskId }} is blocked by: {{ blockedBy | join: ", " }}
        hint: "Complete blocking tasks first"
        exit: 1
```

### worktree:merge

```yaml
guards:
  worktree:merge:
    vars:
      taskId: { type: string, required: true }
      branch: { type: string, required: true }
      parentBranch: { type: string, required: true }
      conflicts: { type: array, default: [] }
      uncommitted: { type: number, default: 0 }

    checks:
      - id: uncommitted_in_worktree
        when: "{{ uncommitted > 0 }}"
        level: error
        message: |
          Worktree has {{ uncommitted }} uncommitted changes
        actions:
          - { cmd: "git -C <worktree> commit -am 'wip'", label: "Commit changes" }
        exit: 1

      - id: has_conflicts
        when: "{{ conflicts.size > 0 }}"
        level: warn
        message: |
          ⚠ Merge conflicts detected
          Branch: {{ branch }} → {{ parentBranch }}
          Files: {{ conflicts | join: ", " }}
        actions:
          - { cmd: "/dev:merge {{ taskId }}", label: "Use merge skill to resolve" }
```

## Implémentation

### Fichiers à créer

1. `cli/lib/guards.ts` - Core guard engine
2. `prompting/guards.yaml` - Guard definitions
3. Tests unitaires

### Dépendances

```bash
npm install liquidjs
```

### Migration

1. Identifier tous les `process.exit(1)` dans les commandes
2. Extraire la logique dans guards.yaml
3. Remplacer par `checkGuards()`
4. Supprimer le code dupliqué

## Phases

### Phase 1 - Core
- [ ] Installer liquidjs
- [ ] Créer `cli/lib/guards.ts` avec API de base
- [ ] Créer `prompting/guards.yaml` avec structure
- [ ] Tests unitaires

### Phase 2 - Migration agent:spawn
- [ ] Définir guards pour agent:spawn
- [ ] Intégrer dans la commande
- [ ] Valider le comportement

### Phase 3 - Migration autres commandes
- [ ] worktree:merge
- [ ] worktree:preflight
- [ ] agent:reap
- [ ] Autres commandes critiques

### Phase 4 - Polish
- [ ] Couleurs ANSI dans les messages
- [ ] Format JSON pour --json
- [ ] Documentation utilisateur
