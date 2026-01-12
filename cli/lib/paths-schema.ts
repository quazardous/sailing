/**
 * Paths Schema - Single source of truth for path configuration
 *
 * Defines all valid path keys with:
 * - default: default value (may contain placeholders)
 * - description: human-readable description
 * - category: grouping for display
 * - profiles: per-profile overrides (haven, sibling, project)
 */

type ProfileOverrides = Partial<Record<'haven' | 'sibling' | 'project', string>>;

type PathEntry = {
  default: string;
  description: string;
  category: 'data' | 'state' | 'project' | 'isolation' | string;
  profiles?: ProfileOverrides;
};

export const PATHS_SCHEMA: Record<string, PathEntry> = {
  // Sailing data directories
  artefacts: {
    default: '.sailing/artefacts',
    description: 'PRDs, epics, tasks storage',
    category: 'data',
    profiles: {
      haven: '${haven}/artefacts'
    }
  },
  memory: {
    default: '.sailing/memory',
    description: 'Memory files and logs',
    category: 'data',
    profiles: {
      haven: '${haven}/memory'
    }
  },
  archive: {
    default: '.sailing/archive',
    description: 'Archived PRDs and memory (prds/, memory/)',
    category: 'data',
    profiles: {
      haven: '${haven}/archive'
    }
  },
  templates: {
    default: '.sailing/templates',
    description: 'Artefact templates',
    category: 'data'
  },
  prompting: {
    default: '.sailing/prompting',
    description: 'Prompting fragments',
    category: 'data'
  },

  // State files
  state: {
    default: '.sailing/state.json',
    description: 'ID counters and state',
    category: 'state',
    profiles: {
      haven: '${haven}/state.json'
    }
  },
  components: {
    default: '.sailing/components.yaml',
    description: 'Component versions',
    category: 'state',
    profiles: {
      haven: '${haven}/components.yaml'
    }
  },

  // Project-centric files
  toolset: {
    default: '.claude/TOOLSET.md',
    description: 'Build/test commands (agent context)',
    category: 'project'
  },
  stack: {
    default: 'STACK.md',
    description: 'Tech stack (agent context)',
    category: 'project'
  },
  roadmap: {
    default: '.sailing/artefacts/ROADMAP.md',
    description: 'Vision docs (skill context)',
    category: 'project',
    profiles: {
      haven: '${haven}/artefacts/ROADMAP.md'
    }
  },
  postit: {
    default: '.sailing/artefacts/POSTIT.md',
    description: 'Backlog notes (skill context)',
    category: 'project',
    profiles: {
      haven: '${haven}/artefacts/POSTIT.md'
    }
  },
  'project-memory': {
    default: '.sailing/artefacts/MEMORY.md',
    description: 'Project-level memory',
    category: 'project',
    profiles: {
      haven: '${haven}/artefacts/MEMORY.md'
    }
  },

  // Worktree/agent isolation (only used when use_worktrees=true)
  worktrees: {
    default: '${haven}/worktrees',
    description: 'Git worktrees for agent isolation',
    category: 'isolation',
    profiles: {
      project: '${haven}/worktrees/${project_hash}',
      sibling: '${sibling}/worktrees'
    }
  },
  agents: {
    default: '${haven}/agents',
    description: 'Agent working directories',
    category: 'isolation',
    profiles: {
      sibling: '${sibling}/agents'
    }
  },
  runs: {
    default: '${haven}/runs',
    description: 'Agent run markers',
    category: 'isolation'
  },
  assignments: {
    default: '${haven}/assignments',
    description: 'Agent assignment files',
    category: 'isolation'
  },
  db: {
    default: '${haven}/db',
    description: 'Database files (agents.json, runs.json)',
    category: 'isolation'
  }
};

/**
 * Category display order and descriptions
 */
export const CATEGORIES: Record<string, string> = {
  data: 'Sailing data',
  state: 'State files',
  project: 'Project-centric files',
  isolation: 'Agent isolation'
};

/**
 * Get default value for a path key
 * @param key Path key
 * @param profile Profile name (haven, sibling, project)
 */
export function getPathDefault(key: string, profile: string | null = null): string | null {
  const schema = PATHS_SCHEMA[key];
  if (!schema) return null;

  if (profile && schema.profiles?.[profile as keyof ProfileOverrides]) {
    return schema.profiles[profile as keyof ProfileOverrides] as string;
  }
  return schema.default;
}

/**
 * Get all path keys
 */
export function getPathKeys(): string[] {
  return Object.keys(PATHS_SCHEMA);
}

/**
 * Get schema for a key
 */
export function getPathSchema(key: string): PathEntry | null {
  return PATHS_SCHEMA[key] || null;
}

/**
 * Generate paths.yaml content from schema
 * @param profile Profile to use for defaults (haven, sibling, project, or null for defaults)
 */
export function generatePathsYaml(profile: string | null = null): string {
  const lines = [
    '# Sailing path configuration',
    '#',
    '# Placeholders:',
    '#   ${haven}   = ~/.sailing/havens/<project_hash>',
    '#   ${sibling} = ../<project>-sailing',
    '#   ^/         = sailing repo (devinstall only)',
    '#   ~/         = user home directory',
    '#',
    profile ? `# Profile: ${profile}` : '# Profile: default',
    '',
    'paths:'
  ];

  // Group by category
  const byCategory: Record<string, { key: string; schema: PathEntry }[]> = {};
  for (const [key, schema] of Object.entries(PATHS_SCHEMA)) {
    const cat = schema.category;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push({ key, schema });
  }

  for (const [category, items] of Object.entries(byCategory)) {
    const catName = CATEGORIES[category] || category;
    lines.push(`  # ${catName}`);

    for (const { key } of items) {
      const value = getPathDefault(key, profile);
      lines.push(`  ${key}: ${value ?? ''}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
