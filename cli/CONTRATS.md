# Contrats d'Architecture CLI

## Couches

```
Commands (cli/commands/*.ts)
    ↓ appelle
Managers (cli/managers/*.ts)
    ↓ appelle
Libs (cli/lib/*.ts)
```

## Règles par couche

### Commands
- **Connaît**: rien (orchestration pure)
- **Appelle**: managers uniquement
- **Interdit**: accès direct aux libs, fs, paths, config

### Managers
- **Connaît**: config, paths, I/O
- **Appelle**: libs (fonctions pures)
- **Responsabilités**:
  - Lecture/écriture fichiers
  - Résolution des chemins (via core.ts)
  - Cache et invalidation
  - Orchestration des libs
  - Validation des préconditions

### Libs
- **Connaît**: RIEN (données pures)
- **Interdit**: fs, path, config, I/O
- **Responsabilités**:
  - Transformation de données
  - Indexation (reçoit données déjà chargées)
  - Parsing de strings
  - Logique métier pure

## Contrat Artefacts

### `lib/artefacts.ts` (PURE)
```typescript
// Reçoit des données, retourne des index
export function indexTasks(taskData: TaskData[]): Map<string, TaskIndexEntry>
export function indexEpics(epicData: EpicData[]): Map<string, EpicIndexEntry>
export function indexStories(storyData: StoryData[]): Map<string, StoryIndexEntry>
export function indexPrds(prdData: PrdData[]): Map<number, PrdIndexEntry>

// Extraction pure de strings
export function extractIdKey(filename: string, prefix: string): string | null
export function extractNumericId(filename: string, prefix: string): number | null

// Lookup dans un index (pas de I/O)
export function findInIndex<T>(index: Map<string, T>, id: string | number, prefix: string): T | null
```

### `managers/artefacts-manager.ts` (I/O + Cache)
```typescript
// Cache interne
let _taskIndex: Map<string, TaskIndexEntry> | null = null;
let _epicIndex: Map<string, EpicIndexEntry> | null = null;
// ...

// API publique (ce que les commands appellent)
export function getTask(taskId: string | number): TaskIndexEntry | null
export function getEpic(epicId: string | number): EpicIndexEntry | null
export function getStory(storyId: string | number): StoryIndexEntry | null
export function getPrd(prdId: string | number): PrdIndexEntry | null

export function getAllTasks(options?: TaskQueryOptions): TaskIndexEntry[]
export function getAllEpics(options?: EpicQueryOptions): EpicIndexEntry[]
export function getAllStories(options?: StoryQueryOptions): StoryIndexEntry[]
export function getAllPrds(): PrdIndexEntry[]

export function getTasksForEpic(epicId: string | number): TaskIndexEntry[]
export function getEpicsForPrd(prdId: string | number): EpicIndexEntry[]
export function getStoriesForPrd(prdId: string | number): StoryIndexEntry[]
export function getTasksForPrd(prdId: string | number): TaskIndexEntry[]

export function clearCache(): void
```

## Contrat Core (à splitter)

### `lib/file.ts` (PURE - parsing)
```typescript
export function parseMarkdownFrontmatter(content: string): { data: any, body: string }
export function stringifyMarkdownFrontmatter(data: any, body: string): string
export function stripComments(content: string): string
export function toKebab(str: string): string
```

### `managers/paths-manager.ts` ou rester dans `core.ts` (I/O + config)
```typescript
export function findProjectRoot(): string
export function getPath(key: string): string | null
export function getPrdsDir(): string
export function getMemoryDir(): string
export function findPrdDirs(): string[]
export function loadFile<T>(filepath: string): LoadedDoc<T> | null
export function saveFile(filepath: string, data: any, body: string): void
```

## Migration

1. **Phase 1**: Créer `managers/artefacts-manager.ts` qui wrap `lib/artefacts.ts`
2. **Phase 2**: Migrer les commands pour utiliser le manager
3. **Phase 3**: Rendre `lib/artefacts.ts` pur (recevoir données en paramètre)
4. **Phase 4**: Splitter `core.ts` si nécessaire

## Exemples

### Avant (mauvais)
```typescript
// commands/task.ts
import { getTask, getAllTasks } from '../lib/artefacts.js';
const task = getTask(id); // lib accède aux fichiers
```

### Après (propre)
```typescript
// commands/task.ts
import { getTask, getAllTasks } from '../managers/artefacts-manager.js';
const task = getTask(id); // manager gère I/O + cache
```
