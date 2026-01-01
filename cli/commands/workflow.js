/**
 * Workflow commands for rudder CLI
 * Renders workflow matrix for documentation and validation
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { jsonOut, getPrompting } from '../lib/core.js';
import { getAgentConfig } from '../lib/config.js';
import { addDynamicHelp } from '../lib/help.js';

/**
 * Load workflows.yaml (raw)
 */
function loadWorkflowsConfig() {
  const promptingDir = getPrompting();
  const workflowPath = path.join(promptingDir, 'workflows.yaml');

  if (!fs.existsSync(workflowPath)) {
    return null;
  }

  const content = fs.readFileSync(workflowPath, 'utf8');
  return yaml.load(content);
}

/**
 * Compose workflow objects from 4-section structure
 * Merges operations[name] metadata with orchestration[name] steps
 */
function composeWorkflows(config) {
  if (!config) return null;

  const workflows = {};

  // Only include operations that have orchestration defined
  for (const [name, steps] of Object.entries(config.orchestration || {})) {
    const opMeta = config.operations?.[name] || {};
    workflows[name] = {
      entity: opMeta.entity,
      description: opMeta.description,
      phases: steps  // Keep 'phases' internally for render functions
    };
  }

  return workflows;
}

/**
 * Get current execution mode
 */
function getCurrentMode() {
  const config = getAgentConfig();
  return config.use_subprocess ? 'subprocess' : 'inline';
}

/**
 * Filter commands by mode
 */
function filterByMode(commands, mode) {
  return commands.filter(cmd => cmd.mode === 'both' || cmd.mode === mode);
}

/**
 * Render workflow as text
 */
function renderWorkflow(name, workflow, mode, options = {}) {
  const lines = [];
  const entity = workflow.entity?.toUpperCase() || 'ENTITY';

  lines.push(`# Workflow: ${name}`);
  lines.push(`# Mode: ${mode}`);
  lines.push(`# Entity: ${entity}`);
  lines.push('');
  lines.push(workflow.description);
  lines.push('');

  for (const phase of workflow.phases || []) {
    const commands = filterByMode(phase.commands || [], mode);
    if (commands.length === 0) continue;

    lines.push(`## ${phase.name} (${phase.actor})`);
    lines.push('');

    for (const cmd of commands) {
      const cmdStr = cmd.cmd.replace(/\{(\w+)\}/g, (_, key) => `<${key}>`);
      const required = cmd.required ? ' [required]' : '';
      const condition = cmd.condition ? ` (if ${cmd.condition})` : '';

      lines.push(`  ${cmdStr}${required}${condition}`);
      lines.push(`    → ${cmd.purpose}`);
      if (cmd.output && options.verbose) {
        lines.push(`    ← ${cmd.output}`);
      }
      if (cmd.note) {
        lines.push(`    ⚠ ${cmd.note}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Render workflow comparison matrix
 */
function renderMatrix(workflows) {
  const lines = [];

  lines.push('# Workflow Matrix: Inline vs Subprocess');
  lines.push('');
  lines.push('Legend: ● both modes | ◐ inline only | ◑ subprocess only');
  lines.push('');

  for (const [name, workflow] of Object.entries(workflows)) {
    lines.push(`## ${name}`);
    lines.push('');
    lines.push('| Phase | Actor | Command | Mode |');
    lines.push('|-------|-------|---------|------|');

    for (const phase of workflow.phases || []) {
      for (const cmd of phase.commands || []) {
        const cmdStr = cmd.cmd.replace(/\{(\w+)\}/g, (_, key) => `<${key}>`);
        const modeIcon = cmd.mode === 'both' ? '●' : cmd.mode === 'inline' ? '◐' : '◑';
        lines.push(`| ${phase.name} | ${phase.actor} | \`${cmdStr}\` | ${modeIcon} |`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Render quick reference for current mode
 */
function renderQuickRef(workflows, mode) {
  const lines = [];

  lines.push(`# Quick Reference: ${mode} mode`);
  lines.push('');

  for (const [name, workflow] of Object.entries(workflows)) {
    const entity = workflow.entity?.toUpperCase() || 'ENTITY';

    lines.push(`## ${name} (${entity})`);
    lines.push('');

    // Group by actor
    const skillCmds = [];
    const agentCmds = [];

    for (const phase of workflow.phases || []) {
      const commands = filterByMode(phase.commands || [], mode);
      for (const cmd of commands) {
        const cmdStr = cmd.cmd.replace(/\{(\w+)\}/g, (_, key) => `<${key}>`);
        if (phase.actor === 'skill') {
          skillCmds.push(cmdStr);
        } else {
          agentCmds.push(cmdStr);
        }
      }
    }

    if (skillCmds.length > 0) {
      lines.push('**Skill:**');
      skillCmds.forEach(c => lines.push(`  ${c}`));
    }
    if (agentCmds.length > 0) {
      lines.push('**Agent:**');
      agentCmds.forEach(c => lines.push(`  ${c}`));
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Register workflow commands
 */
export function registerWorkflowCommands(program) {
  const workflow = program.command('workflow')
    .description('Workflow operations (matrix, documentation)');

  // workflow:show <name>
  workflow.command('show')
    .description('Show workflow for an operation')
    .argument('<name>', 'Workflow name (task-start, epic-breakdown, etc.)')
    .option('--mode <mode>', 'Execution mode (inline, subprocess, auto)', 'auto')
    .option('--verbose', 'Show output descriptions')
    .option('--json', 'JSON output')
    .action((name, options) => {
      const config = loadWorkflowsConfig();
      if (!config) {
        console.error('Error: workflows.yaml not found');
        process.exit(1);
      }

      const workflows = composeWorkflows(config);
      const wf = workflows?.[name];
      if (!wf) {
        console.error(`Error: Unknown workflow: ${name}`);
        console.error(`Available: ${Object.keys(workflows || {}).join(', ')}`);
        process.exit(1);
      }

      const mode = options.mode === 'auto' ? getCurrentMode() : options.mode;

      if (options.json) {
        const filtered = {
          name,
          mode,
          ...wf,
          phases: wf.phases.map(p => ({
            ...p,
            commands: filterByMode(p.commands || [], mode)
          })).filter(p => p.commands.length > 0)
        };
        jsonOut(filtered);
        return;
      }

      console.log(renderWorkflow(name, wf, mode, { verbose: options.verbose }));
    });

  // workflow:matrix
  workflow.command('matrix')
    .description('Show comparison matrix (inline vs subprocess)')
    .option('--json', 'JSON output')
    .action((options) => {
      const config = loadWorkflowsConfig();
      if (!config) {
        console.error('Error: workflows.yaml not found');
        process.exit(1);
      }

      const workflows = composeWorkflows(config);
      if (options.json) {
        jsonOut(workflows);
        return;
      }

      console.log(renderMatrix(workflows));
    });

  // workflow:quick
  workflow.command('quick')
    .description('Quick reference for current mode')
    .option('--mode <mode>', 'Execution mode (inline, subprocess, auto)', 'auto')
    .option('--json', 'JSON output')
    .action((options) => {
      const config = loadWorkflowsConfig();
      if (!config) {
        console.error('Error: workflows.yaml not found');
        process.exit(1);
      }

      const workflows = composeWorkflows(config);
      const mode = options.mode === 'auto' ? getCurrentMode() : options.mode;

      if (options.json) {
        jsonOut({ mode, workflows });
        return;
      }

      console.log(renderQuickRef(workflows, mode));
    });

  // workflow:list
  workflow.command('list')
    .description('List available workflows')
    .option('--json', 'JSON output')
    .action((options) => {
      const config = loadWorkflowsConfig();
      if (!config) {
        console.error('Error: workflows.yaml not found');
        process.exit(1);
      }

      const workflows = composeWorkflows(config);
      if (options.json) {
        jsonOut(Object.keys(workflows || {}));
        return;
      }

      console.log('Available workflows:\n');
      for (const [name, wf] of Object.entries(workflows || {})) {
        console.log(`  ${name.padEnd(20)} ${wf.description || ''}`);
      }
    });

  // Add dynamic help
  addDynamicHelp(workflow, `
• show <name>           Show workflow steps for an operation
    --mode <mode>       inline, subprocess, or auto (default: auto)
    --verbose           Include output descriptions
    --json              JSON output

• matrix                Show inline vs subprocess comparison
    --json              JSON output

• quick                 Quick reference for current mode
    --mode <mode>       inline, subprocess, or auto (default: auto)
    --json              JSON output

• list                  List available workflows
    --json              JSON output

Current mode: Determined by config.yaml agent.use_subprocess
`);
}
