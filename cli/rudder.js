#!/usr/bin/env node
/**
 * Rudder CLI - Project governance for sailing workflow
 *
 * Command syntax:
 *   rudder <group>:<command> [options]   # Colon notation (preferred)
 *   rudder <group> <command> [options]   # Space notation (also works)
 *
 * The colon syntax is expanded internally: task:list → task list
 *
 * Project root detection:
 *   1. --root <path> flag (highest priority)
 *   2. SAILING_PROJECT environment variable
 *   3. Walk up from script location to find .sailing/
 *   4. Walk up from current directory (fallback)
 *
 * Examples:
 *   rudder task:list PRD-001 --status wip
 *   rudder task:show T042
 *   rudder deps:validate --fix
 *   rudder task list PRD-001             # Same as task:list
 *
 * Dev mode (from repo):
 *   SAILING_PROJECT=/path/to/project rudder task:list
 *   rudder --root /path/to/project task:list
 */
import { program } from 'commander';
import path from 'path';
import { setProjectRoot, setScriptDir } from './lib/core.js';

// Set script directory for project root detection
setScriptDir(import.meta.dirname);

// Check for --root flag or SAILING_PROJECT env BEFORE parsing
const args = process.argv.slice(2);
let rootPath = process.env.SAILING_PROJECT;

// Extract --root flag manually (before commander parses)
const rootIdx = args.indexOf('--root');
if (rootIdx !== -1 && args[rootIdx + 1]) {
  rootPath = args[rootIdx + 1];
  // Remove --root and its value from args
  args.splice(rootIdx, 2);
}

// Set explicit project root if provided
if (rootPath) {
  setProjectRoot(path.resolve(rootPath));
}

// Now import version (which uses core.js and needs project root set)
import { getMainVersion } from './lib/version.js';
import { registerPrdCommands } from './commands/prd.js';
import { registerEpicCommands } from './commands/epic.js';
import { registerTaskCommands } from './commands/task.js';
import { registerStoryCommands } from './commands/story.js';
import { registerDepsCommands } from './commands/deps.js';
import { registerMemoryCommands } from './commands/memory.js';
import { registerUtilCommands } from './commands/util.js';
import { registerPermissionsCommands } from './commands/permissions.js';
import { registerContextCommands } from './commands/context.js';
import { registerTagCommands } from './commands/tag.js';
import { registerAgentCommands } from './commands/agent.js';
import { registerGcCommands } from './commands/gc.js';
import { registerAssignCommands } from './commands/assign.js';
import { registerSandboxCommands } from './commands/sandbox.js';
import { registerWorktreeCommands } from './commands/worktree.js';
import { registerSpawnCommands } from './commands/spawn.js';
import { registerWorkflowCommands } from './commands/workflow.js';
import { registerArtifactCommands } from './commands/artifact.js';
import { registerDbCommands } from './commands/db.js';
import { registerFindCommands } from './commands/find.js';
import { registerRenumberCommands } from './commands/renumber.js';

// Expand colon syntax: task:list → task list (first arg only, if it looks like group:command)
let commandExpanded = false;
const expandedArgs = args.flatMap(arg => {
  // Only expand first arg that looks like group:command (e.g., task:list, epic:show)
  // Skip if already expanded, starts with -, contains =, or has multiple colons
  if (!commandExpanded && arg.includes(':') && !arg.startsWith('-') && !arg.includes('=')) {
    const parts = arg.split(':');
    // Only expand if exactly 2 parts and both look like command names (lowercase, no spaces)
    if (parts.length === 2 && /^[a-z-]+$/.test(parts[0]) && /^[a-z-]+$/.test(parts[1])) {
      commandExpanded = true;
      return parts;
    }
  }
  return [arg];
});

// Setup program
program
  .name('rudder')
  .description('Project governance CLI for sailing workflow\n\nSyntax: rudder <group>:<command> or rudder <group> <command>\n\nHelp:\n  rudder -h              All commands\n  rudder <group> -h      Group commands (e.g., rudder task -h)\n  rudder <cmd> -h        Command options (e.g., rudder task:list -h)')
  .version(getMainVersion());

// Register command groups
registerPrdCommands(program);
registerEpicCommands(program);
registerTaskCommands(program);
registerStoryCommands(program);
registerDepsCommands(program);
registerMemoryCommands(program);
registerContextCommands(program);
registerTagCommands(program);
registerAgentCommands(program);
registerGcCommands(program);
registerAssignCommands(program);
registerSandboxCommands(program);
registerWorktreeCommands(program);
registerSpawnCommands(program);
registerWorkflowCommands(program);
registerArtifactCommands(program);
registerDbCommands(program);
registerFindCommands(program);
registerRenumberCommands(program);
registerUtilCommands(program);
registerPermissionsCommands(program);

// Parse with expanded args
program.parse(['node', 'rudder', ...expandedArgs]);

// Show help if no command
if (expandedArgs.length === 0) {
  program.help();
}
