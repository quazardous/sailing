/**
 * Context Composition Library
 *
 * Pure/stateless functions for context composition.
 * I/O functions take paths as parameters (no manager imports).
 * Manager wrappers provide the paths from config.
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
export function resolveInject(roleDef, mode, useWorktrees = true) {
    const inject = roleDef?.inject ?? {};
    const modeConfig = inject[mode];
    // Default empty result
    const result = { files: [], fragments: [], exclude: [] };
    // Helper to merge config into result
    const mergeConfig = (config) => {
        if (!config)
            return;
        if (Array.isArray(config)) {
            result.files.push(...config);
        }
        else if (typeof config === 'object') {
            result.files.push(...(config.files ?? []));
            result.fragments.push(...(config.fragments ?? []));
            result.exclude.push(...(config.exclude ?? []));
        }
    };
    // 1. Apply mode-specific config (inline or subprocess)
    mergeConfig(modeConfig);
    // 2. Apply 'both' mode config
    mergeConfig(inject.both);
    // 3. Apply worktrees/no_worktrees conditional
    if (useWorktrees) {
        mergeConfig(inject.worktrees);
    }
    else {
        mergeConfig(inject.no_worktrees);
    }
    return result;
}
/**
 * Get fragments from a set definition
 * Handles both legacy array format and new object format
 * @param setDef - Set definition (array or object with fragments/roles)
 * @returns { fragments: string[], roles: string[] | null }
 */
export function getSetFragments(setDef) {
    if (!setDef)
        return { fragments: [], roles: null };
    // Legacy format: array of fragments
    if (Array.isArray(setDef)) {
        return { fragments: setDef, roles: null };
    }
    // New format: { fragments: [...], roles?: [...] }
    if (typeof setDef === 'object') {
        return {
            fragments: setDef.fragments ?? [],
            roles: setDef.roles ?? null // null = all roles allowed
        };
    }
    return { fragments: [], roles: null };
}
/**
 * Resolve fragments for an operation and role
 * @param config - Loaded workflows.yaml
 * @param operation - Operation name
 * @param role - Role name (optional, will use operation's default if not specified)
 * @param mode - Execution mode ('inline' or 'subprocess')
 * @param useWorktrees - Whether worktrees are enabled
 * @returns Resolved fragments info or null
 */
export function resolveFragments(config, operation, role, mode, useWorktrees = true) {
    // Get operation metadata (fallback to default)
    const opMeta = config.operations?.[operation] ?? config.operations?.['default'];
    if (!opMeta)
        return null;
    // Get allowed roles (support both 'roles' array and legacy 'role' string)
    const allowedRoles = opMeta.roles ?? (opMeta.role ? [opMeta.role] : ['agent']);
    const defaultRole = allowedRoles[0];
    const resolvedRole = role ?? defaultRole;
    // Validate role is allowed for this operation
    if (role && !allowedRoles.includes(role)) {
        return null; // Role not allowed
    }
    const roleDef = config.roles?.[resolvedRole];
    if (!roleDef)
        return null;
    // Collect fragments from role's base_sets (no role filtering - base_sets are role-specific)
    const fragments = [];
    const baseSets = roleDef.base_sets ?? [];
    for (const setName of baseSets) {
        const { fragments: setFragments } = getSetFragments(config.sets?.[setName]);
        fragments.push(...setFragments);
    }
    // Add operation-specific sets from matrix (with role filtering)
    const opSets = config.matrix?.[operation] ?? [];
    for (const setName of opSets) {
        const { fragments: setFragments, roles: allowedSetRoles } = getSetFragments(config.sets?.[setName]);
        // If set has role restriction, check if current role is allowed
        if (allowedSetRoles && !allowedSetRoles.includes(resolvedRole)) {
            continue; // Skip this set - not for this role
        }
        // Avoid duplicates
        for (const frag of setFragments) {
            if (!fragments.includes(frag)) {
                fragments.push(frag);
            }
        }
    }
    // Get inject config for mode
    const injectConfig = resolveInject(roleDef, mode, useWorktrees);
    return {
        fragments,
        role: resolvedRole,
        roleDef,
        exclude: injectConfig.exclude,
        injectFragments: injectConfig.fragments,
        injectFiles: injectConfig.files
    };
}
/**
 * Render orchestration workflow for a specific operation and mode
 * Returns clean markdown without conditionals
 * @param config - Loaded workflows.yaml
 * @param command - Operation/command name
 * @param mode - 'inline' or 'subprocess'
 * @param actualRole - The resolved role
 * @returns Rendered markdown or null
 */
export function renderOrchestration(config, command, mode, actualRole) {
    const steps = config.orchestration?.[command];
    if (!steps)
        return null;
    const opMeta = config.operations?.[command] ?? {};
    const entity = opMeta.entity?.toUpperCase() ?? 'ENTITY';
    const role = actualRole || 'agent';
    const lines = [];
    lines.push(`## Workflow: ${command}`);
    lines.push('');
    lines.push(`Mode: **${mode}** | Role: **${role}** | Entity: **${entity}**`);
    lines.push('');
    for (const phase of steps) {
        // Filter commands by mode
        const commands = (phase.commands ?? []).filter((cmd) => cmd.mode === 'both' || cmd.mode === mode);
        if (commands.length === 0)
            continue;
        lines.push(`### ${phase.name} (${phase.actor})`);
        lines.push('');
        for (const cmd of commands) {
            const cmdStr = cmd.cmd.replace(/\{(\w+)\}/g, (_, key) => `<${key}>`);
            const required = cmd.required ? ' **[required]**' : '';
            const condition = cmd.condition ? ` _(if ${cmd.condition})_` : '';
            lines.push(`- \`${cmdStr}\`${required}${condition}`);
            lines.push(`  → ${cmd.purpose}`);
            if (cmd.note) {
                lines.push(`  ⚠ ${cmd.note}`);
            }
        }
        lines.push('');
    }
    return lines.join('\n');
}
// ============================================================================
// I/O Functions (path parameters - no manager imports)
// ============================================================================
/**
 * Load workflows.yaml from a specific directory
 * @param promptingDir - Absolute path to prompting directory
 */
export function loadWorkflowsConfigFrom(promptingDir) {
    const configPath = path.join(promptingDir, 'workflows.yaml');
    if (!fs.existsSync(configPath)) {
        return null;
    }
    const content = fs.readFileSync(configPath, 'utf8');
    return yaml.load(content);
}
/**
 * Load a prompting fragment from a specific directory
 * @param promptingDir - Absolute path to prompting directory
 * @param fragmentPath - Path relative to prompting/ (without .md)
 */
export function loadFragmentFrom(promptingDir, fragmentPath) {
    const fullPath = path.join(promptingDir, `${fragmentPath}.md`);
    if (!fs.existsSync(fullPath)) {
        return null;
    }
    return fs.readFileSync(fullPath, 'utf8').trim();
}
/**
 * Load a project file from absolute path
 * @param absolutePath - Absolute path to the file
 * @param key - Key name for the source reference
 */
export function loadProjectFileFrom(absolutePath, key) {
    try {
        if (fs.existsSync(absolutePath)) {
            const content = fs.readFileSync(absolutePath, 'utf8').trim();
            return { content, source: `project:${key}` };
        }
    }
    catch {
        // Ignore errors
    }
    return null;
}
