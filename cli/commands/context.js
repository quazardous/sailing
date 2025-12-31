/**
 * Context commands for rudder CLI
 * Provides optimized prompting context for agents and skill
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { getPrompting, jsonOut, findProjectRoot, getPathsInfo } from '../lib/core.js';
import { addDynamicHelp } from '../lib/help.js';
import { detectMode, isAgentMode, getAgentInfo } from '../lib/agent-context.js';

/**
 * Load project-centric file if it exists
 * Returns { content, source } or null
 */
function loadProjectFile(key) {
  try {
    const paths = getPathsInfo();
    const info = paths[key];
    if (!info) return null;

    if (fs.existsSync(info.absolute)) {
      const content = fs.readFileSync(info.absolute, 'utf8').trim();
      return { content, source: `project:${key}` };
    }
  } catch {
    // Ignore errors
  }
  return null;
}

/**
 * Load contexts.yaml configuration
 */
function loadContextsConfig() {
  const promptingDir = getPrompting();
  const configPath = path.join(promptingDir, 'contexts.yaml');

  if (!fs.existsSync(configPath)) {
    console.error(`Error: contexts.yaml not found at ${configPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(configPath, 'utf8');
  return yaml.load(content);
}

/**
 * Load a fragment file
 */
function loadFragment(fragmentPath) {
  const promptingDir = getPrompting();
  const fullPath = path.join(promptingDir, `${fragmentPath}.md`);

  if (!fs.existsSync(fullPath)) {
    return null;
  }

  return fs.readFileSync(fullPath, 'utf8').trim();
}

/**
 * Compose context from fragments
 */
function composeContext(type, command, options = {}) {
  const config = loadContextsConfig();
  const typeConfig = config[type];

  if (!typeConfig) {
    console.error(`Error: Unknown context type: ${type}`);
    console.error(`Available types: ${Object.keys(config).join(', ')}`);
    process.exit(1);
  }

  // Get fragments for command, fall back to default
  let fragments = typeConfig[command];
  if (!fragments) {
    fragments = typeConfig['default'];
    if (!fragments) {
      console.error(`Error: No context defined for ${type}:${command}`);
      console.error(`Available: ${Object.keys(typeConfig).join(', ')}`);
      process.exit(1);
    }
  }

  // Load and compose fragments
  const parts = [];
  const sources = [];

  for (const fragmentPath of fragments) {
    const content = loadFragment(fragmentPath);
    if (content) {
      parts.push(content);
      sources.push(fragmentPath);
    } else if (options.debug) {
      console.error(`Warning: Fragment not found: ${fragmentPath}`);
    }
  }

  if (parts.length === 0) {
    console.error(`Error: No fragments loaded for ${type}:${command}`);
    process.exit(1);
  }

  // Auto-include project-centric files (convention over configuration)
  // Agent contexts get: TOOLSET.md + STACK.md
  // Skill contexts get: TOOLSET.md + STACK.md + ROADMAP.md + POSTIT.md
  const projectFiles = ['toolset', 'stack'];
  if (type === 'skill') {
    projectFiles.push('roadmap', 'postit');
  }

  for (const key of projectFiles) {
    const projectFile = loadProjectFile(key);
    if (projectFile) {
      parts.push(projectFile.content);
      sources.push(projectFile.source);
    }
  }

  return {
    content: parts.join('\n\n---\n\n'),
    sources
  };
}

/**
 * List available contexts
 */
function listContexts(type) {
  const config = loadContextsConfig();
  const typeConfig = config[type];

  if (!typeConfig) {
    return [];
  }

  return Object.keys(typeConfig).filter(k => k !== 'default');
}

/**
 * Register context commands
 */
export function registerContextCommands(program) {
  const context = program.command('context')
    .description('Context operations (optimized prompts for agents/skill)');

  // context:agent
  context.command('agent')
    .description('Get agent execution context (optimized prompts)')
    .argument('<command>', 'Command/operation name (task-start, prd-breakdown, etc.)')
    .option('--sources', 'Show fragment sources used')
    .option('--list', 'List available agent contexts')
    .option('--json', 'JSON output')
    .action((command, options) => {
      if (options.list) {
        const contexts = listContexts('agent');
        if (options.json) {
          jsonOut(contexts);
        } else {
          console.log('Available agent contexts:\n');
          contexts.forEach(c => console.log(`  ${c}`));
        }
        return;
      }

      const result = composeContext('agent', command, { debug: options.sources });

      if (options.json) {
        jsonOut({
          type: 'agent',
          command,
          sources: result.sources,
          content: result.content
        });
        return;
      }

      if (options.sources) {
        console.log(`# Agent Context: ${command}`);
        console.log(`# Sources: ${result.sources.join(', ')}\n`);
      }

      console.log(result.content);
    });

  // context:skill
  context.command('skill')
    .description('Get skill orchestration context (reminders, state)')
    .argument('<command>', 'Command/operation name (task-start, prd-breakdown, etc.)')
    .option('--sources', 'Show fragment sources used')
    .option('--list', 'List available skill contexts')
    .option('--json', 'JSON output')
    .action((command, options) => {
      if (options.list) {
        const contexts = listContexts('skill');
        if (options.json) {
          jsonOut(contexts);
        } else {
          console.log('Available skill contexts:\n');
          contexts.forEach(c => console.log(`  ${c}`));
        }
        return;
      }

      const result = composeContext('skill', command, { debug: options.sources });

      if (options.json) {
        jsonOut({
          type: 'skill',
          command,
          sources: result.sources,
          content: result.content
        });
        return;
      }

      if (options.sources) {
        console.log(`# Skill Context: ${command}`);
        console.log(`# Sources: ${result.sources.join(', ')}\n`);
      }

      console.log(result.content);
    });

  // context:show (show a specific fragment)
  context.command('show')
    .description('Show a specific prompting fragment')
    .argument('<fragment>', 'Fragment path (e.g., agent/logging, shared/milestone)')
    .option('--json', 'JSON output')
    .action((fragment, options) => {
      const content = loadFragment(fragment);

      if (!content) {
        console.error(`Error: Fragment not found: ${fragment}`);
        process.exit(1);
      }

      if (options.json) {
        jsonOut({ fragment, content });
        return;
      }

      console.log(content);
    });

  // context:list (list all available contexts)
  context.command('list')
    .description('List all available contexts (from contexts.yaml)')
    .option('--fragments', 'Also show which fragments each context uses')
    .option('--json', 'JSON output')
    .action((options) => {
      const config = loadContextsConfig();

      if (options.json) {
        jsonOut(config);
        return;
      }

      console.log('Available contexts:\n');

      for (const [type, commands] of Object.entries(config)) {
        console.log(`${type}:`);
        for (const [cmd, fragments] of Object.entries(commands)) {
          if (options.fragments) {
            console.log(`  ${cmd}:`);
            fragments.forEach(f => console.log(`    - ${f}`));
          } else {
            console.log(`  ${cmd}`);
          }
        }
        console.log();
      }

      console.log('Usage: rudder context:agent <context>');
      console.log('       rudder context:skill <context>');
    });

  // context:mode (detect execution mode)
  context.command('mode')
    .description('Detect execution mode (main or agent)')
    .option('--json', 'JSON output')
    .action((options) => {
      const mode = detectMode();

      if (options.json) {
        jsonOut(mode);
        return;
      }

      console.log(`Mode: ${mode.mode}`);
      console.log(`Project: ${mode.projectRoot}`);

      if (mode.mode === 'agent') {
        console.log(`\nAgent Context:`);
        console.log(`  Task: ${mode.taskId}`);
        console.log(`  Mission: ${mode.missionPath}`);
        console.log(`  Agent dir: ${mode.agentDir}`);
      }
    });

  // Add dynamic help
  addDynamicHelp(context, `
• agent <context>
    --sources             Show fragment sources
    --list                List available contexts
    --json                JSON output

• skill <context>
    --sources             Show fragment sources
    --list                List available contexts
    --json                JSON output

• show <fragment>
    --json                JSON output

• list
    --fragments           Show fragments for each context
    --json                JSON output

• mode
    --json                JSON output
`);
}
