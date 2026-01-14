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
 * Config overrides (experimental):
 *   --with-config key=value              # Override any config value
 *   --with-path key=value                # Override any path value
 *   Can be specified multiple times for multiple overrides
 *
 * Examples:
 *   rudder task:list PRD-001 --status wip
 *   rudder task:show T042
 *   rudder deps:validate --fix
 *   rudder task list PRD-001             # Same as task:list
 *   rudder --with-config agent.use_subprocess=true agent:spawn T001
 *   rudder --with-path artefacts=/custom/path task:list PRD-001
 *
 * Dev mode (from repo):
 *   SAILING_PROJECT=/path/to/project rudder task:list
 *   rudder --root /path/to/project task:list
 */
import { program, Command } from 'commander';
import path from 'path';
import { setProjectRoot, setScriptDir, setPathOverrides, parsePathOverride } from './lib/core.js';
import { setConfigOverrides, parseConfigOverride } from './lib/config.js';

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

// Extract --with-config flags manually (before commander parses)
// Can be specified multiple times: --with-config key=value --with-config key2=value2
const configOverrides: Record<string, any> = {};
let configIdx = args.indexOf('--with-config');
while (configIdx !== -1) {
  if (args[configIdx + 1]) {
    const parsed = parseConfigOverride(args[configIdx + 1]);
    if (parsed) {
      configOverrides[parsed.key] = parsed.value;
    } else {
      process.exit(1);
    }
    // Remove --with-config and its value from args
    args.splice(configIdx, 2);
  } else {
    console.error('--with-config requires a value (e.g., --with-config agent.use_subprocess=true)');
    process.exit(1);
  }
  configIdx = args.indexOf('--with-config');
}

// Apply config overrides if any
if (Object.keys(configOverrides).length > 0) {
  console.error('⚠️  [experimental] Config overrides applied:');
  for (const [key, value] of Object.entries(configOverrides)) {
    console.error(`   ${key}=${value}`);
  }
  console.error('');
  setConfigOverrides(configOverrides);
}

// Extract --with-path flags manually (before commander parses)
// Can be specified multiple times: --with-path key=value --with-path key2=value2
const pathOverrides: Record<string, string> = {};
let pathIdx = args.indexOf('--with-path');
while (pathIdx !== -1) {
  if (args[pathIdx + 1]) {
    const parsed = parsePathOverride(args[pathIdx + 1]);
    if (parsed) {
      pathOverrides[parsed.key] = parsed.value;
    } else {
      process.exit(1);
    }
    // Remove --with-path and its value from args
    args.splice(pathIdx, 2);
  } else {
    console.error('--with-path requires a value (e.g., --with-path artefacts=/custom/path)');
    process.exit(1);
  }
  pathIdx = args.indexOf('--with-path');
}

// Apply path overrides if any
if (Object.keys(pathOverrides).length > 0) {
  console.error('⚠️  [experimental] Path overrides applied:');
  for (const [key, value] of Object.entries(pathOverrides)) {
    console.error(`   ${key}=${value}`);
  }
  console.error('');
  setPathOverrides(pathOverrides);
}

// Now import version (which uses core.js and needs project root set)
import { getMainVersion, getCliVersion } from './lib/version.js';
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
import { registerArchiveCommands } from './commands/archive.js';
import { registerDashboardCommands } from './commands/dashboard.js';
import { registerDashboardDebugCommands } from './commands/dashboard-debug.js';
import { registerAuditCommands } from './commands/audit.js';
import { registerDiagnoseCommands } from './commands/diagnose.js';

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
  // CLI version should reflect the tool, not the project components
  .version(getCliVersion())
  .configureHelp({
    // Show only command name in global help (no [options] [args])
    subcommandTerm: (cmd) => cmd.name()
  })
  .addHelpText('after', `
Global Options (before command):
  --root <path>              Project root directory (overrides SAILING_PROJECT)
  --with-config <key=value>  Override config value (experimental, repeatable)
  --with-path <key=value>    Override path value (experimental, repeatable)
`);

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
registerArchiveCommands(program);
registerDashboardCommands(program);
registerDashboardDebugCommands(program);
registerAuditCommands(program);
registerDiagnoseCommands(program);
registerUtilCommands(program);
registerPermissionsCommands(program);

// Parse with expanded args
program.parse(['node', 'rudder', ...expandedArgs]);

// Show help if no command
if (expandedArgs.length === 0) {
  program.help();
}
