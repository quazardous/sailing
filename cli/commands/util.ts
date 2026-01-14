/**
 * Utility commands for rudder CLI
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import yaml from 'js-yaml';
import {
  findPrdDirs,
  findFiles,
  loadFile,
  saveFile,
  jsonOut,
  getSailingDir,
  getStateFile,
  getConfigFile,
  getComponentsFile,
  getPrdsDir,
  getConfigInfo,
  getPathsInfo,
  findProjectRoot,
  getArtefactsDir,
  getMemoryDir,
  getTemplatesDir,
  getPromptingDir,
  getWorktreesDir,
  getAgentsDir,
  getRunsDir,
  getAssignmentsDir,
  getPathType
} from '../lib/core.js';
import { getPlaceholders, resolvePlaceholders, computeProjectHash, clearCache } from '../lib/paths.js';
import { PATHS_SCHEMA, CATEGORIES, getPathDefault, getPathKeys, generatePathsYaml } from '../lib/paths-schema.js';
import { addDynamicHelp } from '../lib/help.js';
import { loadState, saveState } from '../lib/state.js';
import { getAllVersions, getMainVersion, getMainComponentName, bumpComponentVersion, findComponent, loadComponents } from '../lib/version.js';
import { buildDependencyGraph } from '../lib/graph.js';
import { isStatusDone, isStatusInProgress, isStatusNotStarted, statusSymbol } from '../lib/lexicon.js';
import { loadConfig as loadAgentConfig, getConfigDisplay, getSchema, getConfigPath, getAgentConfig } from '../lib/config.js';
import { ConfigDisplayItem, PathInfo, ConfigSchema, PathsInfo, CheckResults, CheckEntry, ConfigSchemaEntry } from '../lib/types/config.js';

type PathSchemaEntry = (typeof PATHS_SCHEMA)[keyof typeof PATHS_SCHEMA];

/**
 * Register utility commands
 */
export function registerUtilCommands(program) {
  // config group
  const config = program.command('config')
    .description('Configuration management (show, check)')
    .option('--json', 'JSON output')
    .action((options) => {
      // Default: show config
      const info = getConfigInfo();
      const configDisplay = getConfigDisplay();

      if (options.json) {
        jsonOut({
          projectRoot: info.projectRoot,
          sailingDir: info.sailingDir,
          cliPath: info.cliPath,
          configFile: getConfigFile(),
          configExists: fs.existsSync(getConfigFile()),
          settings: configDisplay,
          paths: info.paths
        });
        return;
      }

      // YAML-style output
      console.log('# Sailing Configuration\n');
      console.log(`# project_root: ${info.projectRoot}`);
      console.log(`# sailing_dir: ${info.sailingDir}`);
      console.log(`# config_file: ${getConfigFile()} ${fs.existsSync(getConfigFile()) ? '✓' : '(using defaults)'}`);

      // Group settings by section
      const sections: Record<string, ConfigDisplayItem[]> = {};
      for (const item of configDisplay) {
        const [section] = item.key.split('.');
        if (!sections[section]) sections[section] = [];
        sections[section].push(item);
      }

      for (const [section, items] of Object.entries(sections)) {
        console.log(`\n${section}:`);
        for (const item of items) {
          const keyName = item.key.split('.').slice(1).join('.');
          const marker = item.isDefault ? '' : '  # (custom)';
          const valuesHint = item.values ? ` [${item.values.join('|')}]` : '';
          console.log(`  # ${item.description}${valuesHint}`);
          console.log(`  ${keyName}: ${item.value}${marker}`);
        }
      }

      console.log('\n# Configured paths');
      console.log('paths:');
      for (const [key, val] of Object.entries(info.paths)) {
        const pathInfo = val as PathInfo;
        const markers = [];
        if (pathInfo.isCustom) markers.push('custom');
        if (pathInfo.isAbsolute) markers.push('external');  // outside project root
        const marker = markers.length > 0 ? `  # (${markers.join(', ')})` : '';
        console.log(`  ${key}: ${pathInfo.path}${marker}`);
      }
    });

  addDynamicHelp(config, { entityType: 'config' });

  // config:init - generate config.yaml from schema
  config.command('init')
    .description('Generate config.yaml from schema with defaults')
    .option('--force', 'Overwrite existing config.yaml')
    .action((options) => {
      const configPath = getConfigPath();

      if (fs.existsSync(configPath) && !options.force) {
        console.error(`config.yaml already exists: ${configPath}`);
        console.error('Use --force to overwrite');
        process.exit(1);
      }

      const schema: ConfigSchema = getSchema();
      const lines = ['# Sailing configuration', '# Generated from schema - edit as needed', ''];

      // Group by section
      const sections: Record<string, Array<ConfigSchemaEntry & { key: string }>> = {};
      for (const [key, def] of Object.entries(schema)) {
        const [section, ...rest] = key.split('.');
        if (!sections[section]) sections[section] = [];
        sections[section].push({ key: rest.join('.'), ...def });
      }

      for (const [section, items] of Object.entries(sections)) {
        lines.push(`${section}:`);
        for (const item of items) {
          // Add description as comment
          lines.push(`  # ${item.description}`);
          if (item.values) {
            lines.push(`  # Valid: ${item.values.join(', ')}`);
          }
          // Add key: value
          const value = typeof item.default === 'string' ? item.default : JSON.stringify(item.default);
          lines.push(`  ${item.key}: ${value}`);
          lines.push('');
        }
      }

      fs.writeFileSync(configPath, lines.join('\n'));
      console.log(`Created: ${configPath}`);
    });

  // config:get - get a config value
  config.command('get <key>')
    .description('Get a config value (e.g., agent.mcp_mode)')
    .action((key: string) => {
      const schema: ConfigSchema = getSchema();

      // Validate key exists in schema
      if (!schema[key]) {
        console.error(`Unknown config key: ${key}`);
        console.error('\nAvailable keys:');
        Object.keys(schema).sort().forEach(k => console.error(`  ${k}`));
        process.exit(1);
      }

      // Get current value (merged config)
      const agentConfig = getAgentConfig();
      const [section, ...rest] = key.split('.');
      const property = rest.join('.');

      // Navigate to the value
      let value: unknown;
      if (section === 'agent') {
        value = agentConfig[property];
      } else if (section === 'git') {
        value = agentConfig[`git_${property}`] ?? schema[key].default;
      } else {
        // For other sections, read from raw config
        const configPath = getConfigPath();
        if (fs.existsSync(configPath)) {
          try {
            const configData = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, Record<string, unknown>> || {};
            value = configData[section]?.[property] ?? schema[key].default;
          } catch {
            value = schema[key].default;
          }
        } else {
          value = schema[key].default;
        }
      }

      console.log(value);
    });

  // config:set - set a config value
  config.command('set <key> <value>')
    .description('Set a config value (e.g., agent.mcp_mode socket)')
    .action((key: string, value: string) => {
      const schema: ConfigSchema = getSchema();

      // Validate key exists in schema
      if (!schema[key]) {
        console.error(`Unknown config key: ${key}`);
        console.error('\nAvailable keys:');
        Object.keys(schema).sort().forEach(k => console.error(`  ${k}`));
        process.exit(1);
      }

      const def = schema[key];

      // Validate value against schema
      let parsedValue: unknown = value;

      if (def.type === 'boolean') {
        if (value === 'true' || value === '1') parsedValue = true;
        else if (value === 'false' || value === '0') parsedValue = false;
        else {
          console.error(`Invalid boolean value: ${value} (use true/false)`);
          process.exit(1);
        }
      } else if (def.type === 'number') {
        parsedValue = parseFloat(value);
        if (isNaN(parsedValue as number)) {
          console.error(`Invalid number value: ${value}`);
          process.exit(1);
        }
      } else if (def.type === 'enum' && def.values) {
        if (!def.values.includes(value)) {
          console.error(`Invalid value: ${value}`);
          console.error(`Valid values: ${def.values.join(', ')}`);
          process.exit(1);
        }
      }

      // Set the value preserving comments
      const configPath = getConfigPath();
      const [section, ...rest] = key.split('.');
      const property = rest.join('.');

      // Format value for YAML
      const yamlValue = typeof parsedValue === 'string' ? parsedValue : String(parsedValue);

      if (!fs.existsSync(configPath)) {
        // Create new file
        fs.writeFileSync(configPath, `${section}:\n  ${property}: ${yamlValue}\n`);
        console.log(`Set ${key} = ${parsedValue}`);
        return;
      }

      // Read and modify in-place to preserve comments
      const lines = fs.readFileSync(configPath, 'utf8').split('\n');
      let inSection = false;
      let sectionIndent = 0;
      let foundKey = false;
      let sectionEndIndex = -1;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trimStart();

        // Check for section start (no leading whitespace, ends with :)
        if (!line.startsWith(' ') && !line.startsWith('\t') && trimmed.endsWith(':') && !trimmed.startsWith('#')) {
          const sectionName = trimmed.slice(0, -1);
          if (sectionName === section) {
            inSection = true;
            sectionIndent = 2; // Standard YAML indent
            sectionEndIndex = i;
          } else if (inSection) {
            // Exited section without finding key
            sectionEndIndex = i;
            break;
          }
        } else if (inSection && trimmed && !trimmed.startsWith('#')) {
          // Check if this is our property
          const match = trimmed.match(/^(\w+):/);
          if (match && match[1] === property) {
            // Replace this line, preserve any inline comment
            const commentMatch = line.match(/#.*$/);
            const comment = commentMatch ? '  ' + commentMatch[0] : '';
            lines[i] = `  ${property}: ${yamlValue}${comment}`;
            foundKey = true;
            break;
          }
          sectionEndIndex = i + 1;
        }
      }

      if (!foundKey) {
        if (sectionEndIndex === -1) {
          // Section doesn't exist, add it
          lines.push(`${section}:`);
          lines.push(`  ${property}: ${yamlValue}`);
        } else {
          // Add key to existing section
          lines.splice(sectionEndIndex, 0, `  ${property}: ${yamlValue}`);
        }
      }

      fs.writeFileSync(configPath, lines.join('\n'));
      console.log(`Set ${key} = ${parsedValue}`);
    });

  // config:check
  config.command('check')
    .description('Validate project setup (files, folders, YAML syntax)')
    .option('--json', 'JSON output')
    .option('--fix', 'Create missing directories and files')
    .action((options) => {
      const results: CheckResults = {
        git: [],
        directories: [],
        files: [],
        yaml: [],
        state: null,
        config: [],
        summary: { ok: 0, warn: 0, error: 0 }
      };

      const check = (
        category: keyof Omit<CheckResults, 'state' | 'summary'>,
        name: string,
        status: CheckEntry['status'],
        message = ''
      ) => {
        const entry: CheckEntry = { name, status, message };
        results[category].push(entry);
        if (status === 'ok') results.summary.ok++;
        else if (status === 'warn') results.summary.warn++;
        else results.summary.error++;
        return status;
      };

      const projectRoot = findProjectRoot();
      const sailingDir = getSailingDir();
      const agentConfig = getAgentConfig();

      // 0. Check git repository
      let hasGitRepo = false;
      let gitBranch = null;
      let gitClean = false;
      let hasGit = false;
      let hasCommits = false;

      try {
        execSync('git --version', { stdio: ['pipe', 'pipe', 'pipe'] });
        hasGit = true;
        check('git', 'git', 'ok', 'Git available');
      } catch {
        check('git', 'git', 'error', 'Git not found (install git)');
      }

      if (hasGit) {
        try {
          execSync('git rev-parse --git-dir 2>/dev/null', {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
          });
          hasGitRepo = true;
          check('git', 'repository', 'ok', 'Valid git repository');

          // Get branch
          try {
            gitBranch = execSync('git branch --show-current 2>/dev/null', {
              cwd: projectRoot,
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'pipe']
            }).trim();
            if (gitBranch) {
              check('git', 'branch', 'ok', gitBranch);
            } else {
              check('git', 'branch', 'warn', 'Detached HEAD');
            }
          } catch {
            check('git', 'branch', 'warn', 'Could not determine branch');
          }

          // Check working tree status
          try {
            const status = execSync('git status --porcelain 2>/dev/null', {
              cwd: projectRoot,
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'pipe']
            }).trim();
            if (status === '') {
              gitClean = true;
              check('git', 'status', 'ok', 'Working tree clean');
            } else {
              const lines = status.split('\n').length;
              check('git', 'status', 'warn', `${lines} uncommitted change(s)`);
            }
          } catch {
            check('git', 'status', 'warn', 'Could not check status');
          }

          // Check for commits (required for worktrees)
          try {
            execSync('git rev-parse HEAD 2>/dev/null', {
              cwd: projectRoot,
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'pipe']
            });
            hasCommits = true;
          } catch {
            if (agentConfig.use_worktrees) {
              check('git', 'commits', 'error', 'No commits (required for worktrees)');
            }
          }
        } catch {
          // Not a git repo - try to fix if requested
          if (options.fix) {
            try {
              execSync('git init', {
                cwd: projectRoot,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
              });
              hasGitRepo = true;
              check('git', 'repository', 'ok', 'Initialized git repository');
            } catch (e) {
              check('git', 'repository', 'error', `Failed to init: ${e.message}`);
            }
          } else if (agentConfig.use_worktrees) {
            check('git', 'repository', 'error', 'Not a git repository (required for worktrees)');
          } else {
            check('git', 'repository', 'warn', 'Not a git repository');
          }
        }
      }

      // 1. Check required directories
      const requiredDirs = [
        { name: '.sailing', path: sailingDir },
        { name: 'artefacts', path: getArtefactsDir() },
        { name: 'memory', path: getMemoryDir() },
        { name: 'templates', path: getTemplatesDir() },
        { name: 'prompting', path: getPromptingDir() },
        { name: 'prds', path: getPrdsDir() }
      ];

      // Subprocess-only directories (haven-based, only when use_subprocess is enabled)
      const subprocessDirs = [
        { name: 'haven', path: resolvePlaceholders('${haven}') },
        { name: 'runs', path: getRunsDir() },
        { name: 'assignments', path: getAssignmentsDir() }
      ];

      // Worktree-only directories (only when use_worktrees is enabled)
      const worktreeDirs = [
        { name: 'worktrees', path: getWorktreesDir() },
        { name: 'agents', path: getAgentsDir() }
      ];

      for (const dir of requiredDirs) {
        if (fs.existsSync(dir.path)) {
          check('directories', dir.name, 'ok', dir.path);
        } else if (options.fix) {
          try {
            fs.mkdirSync(dir.path, { recursive: true });
            check('directories', dir.name, 'ok', `${dir.path} (created)`);
          } catch (e) {
            check('directories', dir.name, 'error', `Failed to create: ${e.message}`);
          }
        } else {
          check('directories', dir.name, 'error', `Missing: ${dir.path}`);
        }
      }

      // Subprocess directories - only check/create if use_subprocess is enabled
      for (const dir of subprocessDirs) {
        if (agentConfig.use_subprocess) {
          if (fs.existsSync(dir.path)) {
            check('directories', dir.name, 'ok', dir.path);
          } else if (options.fix) {
            try {
              fs.mkdirSync(dir.path, { recursive: true });
              check('directories', dir.name, 'ok', `${dir.path} (created)`);
            } catch (e) {
              check('directories', dir.name, 'error', `Failed to create: ${e.message}`);
            }
          } else {
            check('directories', dir.name, 'error', `Missing: ${dir.path}`);
          }
        } else {
          // Not needed - skip silently or show as skipped
          if (fs.existsSync(dir.path)) {
            check('directories', dir.name, 'ok', `${dir.path} (not required)`);
          }
        }
      }

      // Worktree directories - only check/create if use_worktrees is enabled
      for (const dir of worktreeDirs) {
        if (agentConfig.use_worktrees) {
          if (fs.existsSync(dir.path)) {
            check('directories', dir.name, 'ok', dir.path);
          } else if (options.fix) {
            try {
              fs.mkdirSync(dir.path, { recursive: true });
              check('directories', dir.name, 'ok', `${dir.path} (created)`);
            } catch (e) {
              check('directories', dir.name, 'error', `Failed to create: ${e.message}`);
            }
          } else {
            check('directories', dir.name, 'error', `Missing: ${dir.path}`);
          }
        } else {
          // Not needed - skip silently or show as skipped
          if (fs.existsSync(dir.path)) {
            check('directories', dir.name, 'ok', `${dir.path} (not required)`);
          }
          // If doesn't exist and not needed, don't report
        }
      }

      // 2. Check config files exist
      // Get dist directory (for --fix to copy templates)
      const distDir = path.join(path.dirname(path.dirname(import.meta.dirname)), 'dist');

      // Generator function for config.yaml from schema
      const generateConfigYaml = () => {
        const schema: ConfigSchema = getSchema();
        const lines = ['# Sailing configuration', '# Generated from schema - edit as needed', ''];
        const sections: Record<string, Array<ConfigSchemaEntry & { key: string }>> = {};
        for (const [key, def] of Object.entries(schema)) {
          const [section, ...rest] = key.split('.');
          if (!sections[section]) sections[section] = [];
          sections[section].push({ key: rest.join('.'), ...def });
        }
        for (const [section, items] of Object.entries(sections)) {
          lines.push(`${section}:`);
          for (const item of items) {
            lines.push(`  # ${item.description}`);
            if (item.values) lines.push(`  # Valid: ${item.values.join(', ')}`);
            const value = typeof item.default === 'string' ? item.default : JSON.stringify(item.default);
            lines.push(`  ${item.key}: ${value}`);
            lines.push('');
          }
        }
        return lines.join('\n');
      };

      const configFiles = [
        { name: 'paths.yaml', path: path.join(sailingDir, 'paths.yaml'), dist: 'paths.yaml-dist' },
        { name: 'config.yaml', path: getConfigFile(), generator: generateConfigYaml },
        { name: 'components.yaml', path: getComponentsFile(), dist: 'components.yaml-dist' },
        { name: 'state.json', path: getStateFile(), required: true, defaultContent: '{"counters":{"prd":0,"epic":0,"task":0,"story":0}}' }
      ];

      for (const file of configFiles) {
        if (fs.existsSync(file.path)) {
          check('files', file.name, 'ok', file.path);
        } else if (options.fix) {
          try {
            // Create from dist template, generator, or default content
            if (file.dist) {
              const distPath = path.join(distDir, file.dist);
              if (fs.existsSync(distPath)) {
                fs.copyFileSync(distPath, file.path);
                check('files', file.name, 'ok', `${file.path} (created from template)`);
              } else {
                check('files', file.name, 'error', `Template not found: ${distPath}`);
              }
            } else if (file.generator) {
              fs.writeFileSync(file.path, file.generator());
              check('files', file.name, 'ok', `${file.path} (generated from schema)`);
            } else if (file.defaultContent) {
              fs.writeFileSync(file.path, file.defaultContent);
              check('files', file.name, 'ok', `${file.path} (created with defaults)`);
            }
          } catch (e) {
            check('files', file.name, 'error', `Failed to create: ${e.message}`);
          }
        } else if (file.required) {
          check('files', file.name, 'error', `Missing: ${file.path}`);
        } else {
          check('files', file.name, 'warn', `Not found (optional): ${file.path}`);
        }
      }

      // 3. Check project-centric files (convention)
      const pathsInfo = getPathsInfo();
      const projectFiles = [
        { name: 'TOOLSET.md', key: 'toolset', required: false, desc: 'Build/test commands (project-specific)' },
        { name: 'STACK.md', key: 'stack', required: false, desc: 'Tech stack documentation' },
        { name: 'ROADMAP.md', key: 'roadmap', required: true, desc: 'Project vision and milestones' },
        { name: 'POSTIT.md', key: 'postit', required: false, desc: 'Informal backlog for PRD creation' }
      ];

      for (const file of projectFiles) {
        const info = pathsInfo[file.key];
        if (!info) continue;

        if (fs.existsSync(info.absolute)) {
          check('files', file.name, 'ok', info.relative);
        } else if (file.required) {
          check('files', file.name, 'warn', `Missing: ${info.relative} (${file.desc})`);
        }
        // Optional files: don't report if missing
      }

      // 4. Validate YAML syntax
      const yamlFiles = [
        { name: 'paths.yaml', path: path.join(sailingDir, 'paths.yaml') },
        { name: 'config.yaml', path: getConfigFile() },
        { name: 'components.yaml', path: getComponentsFile() }
      ];

      for (const file of yamlFiles) {
        if (!fs.existsSync(file.path)) continue;
        try {
          const content = fs.readFileSync(file.path, 'utf8');
          yaml.load(content);
          check('yaml', file.name, 'ok', 'Valid YAML');
        } catch (e) {
          check('yaml', file.name, 'error', `Invalid YAML: ${e.message}`);
        }
      }

      // 5. Validate state.json
      const stateFile = getStateFile();
      if (fs.existsSync(stateFile)) {
        try {
          const content = fs.readFileSync(stateFile, 'utf8');
          const state = JSON.parse(content);
          if (state.counters && typeof state.counters.prd === 'number') {
            results.state = { status: 'ok', counters: state.counters };
            results.summary.ok++;
          } else {
            results.state = { status: 'warn', message: 'Missing or invalid counters' };
            results.summary.warn++;
          }
        } catch (e) {
          results.state = { status: 'error', message: `Invalid JSON: ${e.message}` };
          results.summary.error++;
        }
      }

      // 6. Validate agent config loads
      try {
        loadAgentConfig();
        check('yaml', 'agent config', 'ok', 'Config loads successfully');
      } catch (e) {
        check('yaml', 'agent config', 'error', `Failed to load: ${e.message}`);
      }

      // 7. Validate config hierarchy (use_subprocess requirements)
      results.config = [];
      const configCheck = (name, status, message) => {
        results.config.push({ name, status, message });
        if (status === 'ok') results.summary.ok++;
        else if (status === 'warn') results.summary.warn++;
        else results.summary.error++;
      };

      // Hierarchy: use_subprocess → use_worktrees → sandbox → risky_mode
      const hasSubprocess = agentConfig.use_subprocess;
      const hasWorktrees = agentConfig.use_worktrees;
      const hasSandbox = agentConfig.sandbox;
      const hasRisky = agentConfig.risky_mode;

      // use_subprocess
      if (hasSubprocess) {
        configCheck('use_subprocess', 'ok', 'Subprocess mode enabled');
      } else if (hasWorktrees || hasSandbox || hasRisky) {
        configCheck('use_subprocess', 'warn', 'Required by other options but disabled');
      }

      // use_worktrees (requires use_subprocess + git + commits)
      if (hasWorktrees) {
        if (!hasSubprocess) {
          configCheck('use_worktrees', 'warn', 'Requires use_subprocess: true');
        } else if (!hasGitRepo) {
          configCheck('use_worktrees', 'error', 'Requires git repository (not found)');
        } else if (!hasCommits) {
          configCheck('use_worktrees', 'error', 'Requires at least one commit');
        } else {
          configCheck('use_worktrees', 'ok', 'Worktree isolation enabled');
        }
      } else if (hasSandbox || hasRisky) {
        configCheck('use_worktrees', 'warn', 'Required by sandbox/risky_mode but disabled');
      }

      // sandbox (requires use_worktrees)
      if (hasSandbox) {
        if (!hasWorktrees) {
          configCheck('sandbox', 'warn', 'Requires use_worktrees: true');
        } else if (!hasSubprocess) {
          configCheck('sandbox', 'warn', 'Requires use_subprocess: true');
        } else {
          configCheck('sandbox', 'ok', 'Sandbox mode enabled');
        }
      } else if (hasRisky) {
        configCheck('sandbox', 'warn', 'Required by risky_mode but disabled');
      }

      // risky_mode (requires sandbox)
      if (hasRisky) {
        if (!hasSandbox) {
          configCheck('risky_mode', 'warn', 'Requires sandbox: true');
        } else if (!hasWorktrees) {
          configCheck('risky_mode', 'warn', 'Requires use_worktrees: true');
        } else if (!hasSubprocess) {
          configCheck('risky_mode', 'warn', 'Requires use_subprocess: true');
        } else {
          configCheck('risky_mode', 'ok', 'Risky mode enabled (--dangerously-skip-permissions)');
        }
      }

      // Output
      if (options.json) {
        jsonOut(results);
        return;
      }

      const symbol = (s) => s === 'ok' ? '✓' : s === 'warn' ? '⚠' : '✗';

      console.log('Project Check\n');

      console.log('Git:');
      for (const g of results.git) {
        console.log(`  ${symbol(g.status)} ${g.name.padEnd(12)} ${g.message}`);
      }

      console.log('\nDirectories:');
      for (const d of results.directories) {
        console.log(`  ${symbol(d.status)} ${d.name.padEnd(12)} ${d.message}`);
      }

      console.log('\nFiles:');
      for (const f of results.files) {
        console.log(`  ${symbol(f.status)} ${f.name.padEnd(16)} ${f.message}`);
      }

      console.log('\nYAML Validation:');
      for (const y of results.yaml) {
        console.log(`  ${symbol(y.status)} ${y.name.padEnd(16)} ${y.message}`);
      }

      if (results.state) {
        console.log('\nState:');
        if (results.state.status === 'ok') {
          const c = results.state.counters || {};
          console.log(`  ${symbol('ok')} counters        PRD=${c.prd} Epic=${c.epic} Task=${c.task} Story=${c.story || 0}`);
        } else {
          console.log(`  ${symbol(results.state.status)} state.json      ${results.state.message}`);
        }
      }

      if (results.config && results.config.length > 0) {
        console.log('\nConfig Hierarchy:');
        for (const c of results.config) {
          console.log(`  ${symbol(c.status)} ${c.name.padEnd(16)} ${c.message}`);
        }
      }

      console.log('\nSummary:');
      console.log(`  ✓ OK: ${results.summary.ok}  ⚠ Warnings: ${results.summary.warn}  ✗ Errors: ${results.summary.error}`);

      if (results.summary.error > 0 || results.summary.warn > 0) {
        console.log('\nRun with --fix to create missing directories and files');
        if (results.summary.error > 0) process.exit(1);
      }
    });

  // paths group
  const paths = program.command('paths')
    .description('Path management (show paths, placeholders, resolve)')
    .argument('[key]', 'Path key (roadmap, artefacts, haven, agents, runs, assignments, worktrees, ...)')
    .option('--json', 'JSON output')
    .option('-p, --placeholders', 'Include placeholders in output')
    .option('-n, --no-resolve', 'Show paths with placeholders (unresolved)')
    .option('-r, --realpath', 'Show fully resolved absolute paths')
    .action((key, options) => {
      const pathsInfo = getPathsInfo();

      // Helper to get display value based on flags
      const getDisplay = (v) => {
        if (options.resolve === false) return v.template || v.relative;
        if (options.realpath) return v.absolute;
        return v.relative;
      };

      if (key) {
        if (!pathsInfo[key]) {
          console.error(`Unknown path key: ${key}`);
          console.error(`Available: ${Object.keys(pathsInfo).join(', ')}`);
          process.exit(1);
        }
        console.log(getDisplay(pathsInfo[key]));
        return;
      }

      if (options.json) {
        const result: any = { paths: {} };
        for (const [k, v] of Object.entries(pathsInfo)) {
          result.paths[k] = getDisplay(v);
        }
        if (options.placeholders) {
          result.placeholders = getPlaceholders();
        }
        jsonOut(options.placeholders ? result : result.paths);
        return;
      }

      // Human readable - paths
      console.log('Paths:\n');
      for (const [k, v] of Object.entries(pathsInfo)) {
        console.log(`  ${k.padEnd(12)} ${getDisplay(v)}`);
      }

      // Placeholders if requested
      if (options.placeholders) {
        const ph = getPlaceholders();
        console.log('\nPlaceholders:\n');
        for (const [k, v] of Object.entries(ph.builtin)) {
          console.log(`  %${k}%`.padEnd(20) + v);
        }
        if (Object.keys(ph.custom).length > 0) {
          console.log('\n  Custom (paths.yaml):');
          for (const [k, v] of Object.entries(ph.custom)) {
            console.log(`  %${k}%`.padEnd(20) + v);
          }
        }
      }
    });

  addDynamicHelp(paths, { entityType: 'paths' });

  // paths:placeholders
  paths.command('placeholders')
    .description('Show available placeholders and their values')
    .option('--json', 'JSON output')
    .action((options) => {
      const ph = getPlaceholders();

      if (options.json) {
        jsonOut(ph);
        return;
      }

      console.log('Built-in placeholders:\n');
      for (const [k, v] of Object.entries(ph.builtin)) {
        console.log(`  %${k}%`.padEnd(20) + v);
      }

      if (Object.keys(ph.custom).length > 0) {
        console.log('\nCustom placeholders (from paths.yaml):\n');
        for (const [k, v] of Object.entries(ph.custom)) {
          console.log(`  %${k}%`.padEnd(20) + v);
        }
      }
    });

  // paths:resolve
  paths.command('resolve <path>')
    .description('Resolve placeholders in a path string')
    .action((pathStr) => {
      const resolved = resolvePlaceholders(pathStr);
      console.log(resolved);
    });

  // paths:hash
  paths.command('hash')
    .description('Show project hash (used for ${project_hash})')
    .action(() => {
      const hash = computeProjectHash();
      console.log(hash);
    });

  // paths:raw
  paths.command('raw')
    .description('Show raw paths.yaml content (unresolved)')
    .option('--json', 'JSON output')
    .action((options) => {
      const projectRoot = findProjectRoot();
      const pathsFile = path.join(projectRoot, '.sailing', 'paths.yaml');

      if (!fs.existsSync(pathsFile)) {
        console.log('No paths.yaml found (using defaults)');
        return;
      }

      const content = fs.readFileSync(pathsFile, 'utf8');

      if (options.json) {
        jsonOut(yaml.load(content));
        return;
      }

      console.log(content);
    });

  // paths:check
  paths.command('check')
    .description('Validate paths exist and are writable')
    .action(() => {
      const pathsInfo = getPathsInfo();
      let allOk = true;

      console.log('Checking paths:\n');

      for (const [key, info] of Object.entries(pathsInfo)) {
        const p = info.absolute;
        let status = '✓';
        let note = '';

        if (!fs.existsSync(p)) {
          status = '✗';
          note = ' (not found)';
          allOk = false;
        } else {
          try {
            fs.accessSync(p, fs.constants.W_OK);
          } catch {
            status = '⚠';
            note = ' (not writable)';
          }
        }

        console.log(`  ${status} ${key.padEnd(12)} ${p}${note}`);
      }

      console.log('');
      if (allOk) {
        console.log('All paths OK');
      } else {
        console.log('Some paths missing or not writable');
        process.exit(1);
      }
    });

  // paths:init - generate paths.yaml from schema
  paths.command('init')
    .description('Generate paths.yaml from schema')
    .option('--profile <name>', 'Use profile defaults (haven, sibling, project)')
    .option('--force', 'Overwrite existing paths.yaml')
    .option('--dry-run', 'Show what would be generated')
    .action((options) => {
      const sailingDir = getSailingDir();
      const pathsFile = path.join(sailingDir, 'paths.yaml');

      if (fs.existsSync(pathsFile) && !options.force && !options.dryRun) {
        console.error(`paths.yaml already exists: ${pathsFile}`);
        console.error('Use --force to overwrite or --dry-run to preview');
        process.exit(1);
      }

      const content = generatePathsYaml(options.profile);

      if (options.dryRun) {
        console.log('Would generate:\n');
        console.log(content);
        return;
      }

      // Ensure .sailing directory exists
      if (!fs.existsSync(sailingDir)) {
        fs.mkdirSync(sailingDir, { recursive: true });
      }

      fs.writeFileSync(pathsFile, content);
      console.log(`Generated: ${pathsFile}`);
      if (options.profile) {
        console.log(`Profile: ${options.profile}`);
      }
    });

  // paths:set - set a path value
  paths.command('set <key> <value>')
    .description('Set a path value in paths.yaml')
    .action((key, value) => {
      // Validate key
      if (!PATHS_SCHEMA[key]) {
        console.error(`Unknown path key: ${key}`);
        console.error(`Available: ${getPathKeys().join(', ')}`);
        process.exit(1);
      }

      const sailingDir = getSailingDir();
      const pathsFile = path.join(sailingDir, 'paths.yaml');

      let config = { paths: {} };

      // Load existing if present
      if (fs.existsSync(pathsFile)) {
        try {
          const content = fs.readFileSync(pathsFile, 'utf8');
          config = yaml.load(content) || { paths: {} };
          if (!config.paths) config.paths = {};
        } catch (e) {
          console.error(`Error reading paths.yaml: ${e.message}`);
          process.exit(1);
        }
      } else {
        // Ensure .sailing directory exists
        if (!fs.existsSync(sailingDir)) {
          fs.mkdirSync(sailingDir, { recursive: true });
        }
      }

      // Set the value
      config.paths[key] = value;

      // Generate YAML
      const lines = ['# Sailing path configuration', '', 'paths:'];
      for (const [k, v] of Object.entries(config.paths)) {
        lines.push(`  ${k}: ${v}`);
      }

      fs.writeFileSync(pathsFile, lines.join('\n') + '\n');
      clearCache(); // Clear path cache

      console.log(`Set: ${key} = ${value}`);
    });

  // paths:get - get a path value (raw or resolved)
  paths.command('get <key>')
    .description('Get a path value')
    .option('-r, --raw', 'Show raw value (unresolved)')
    .action((key, options) => {
      const pathsInfo = getPathsInfo();

      if (!pathsInfo[key]) {
        // Check if it's a valid schema key with default
        if (PATHS_SCHEMA[key]) {
          console.log(options.raw ? PATHS_SCHEMA[key].default : resolvePlaceholders(PATHS_SCHEMA[key].default));
        } else {
          console.error(`Unknown path key: ${key}`);
          process.exit(1);
        }
        return;
      }

      const info = pathsInfo[key];
      console.log(options.raw ? (info.template || info.relative) : info.absolute);
    });

  // paths:schema - show schema info
  paths.command('schema')
    .description('Show paths schema with defaults and profiles')
    .option('--json', 'JSON output')
    .action((options) => {
      if (options.json) {
        jsonOut({ schema: PATHS_SCHEMA, categories: CATEGORIES });
        return;
      }

      // Group by category
      const byCategory: Record<string, Array<PathSchemaEntry & { key: string }>> = {};
      for (const [key, schema] of Object.entries(PATHS_SCHEMA) as [string, PathSchemaEntry][]) {
        const cat = schema.category;
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push({ key, ...schema });
      }

      for (const [category, items] of Object.entries(byCategory)) {
        const catName = CATEGORIES[category] || category;
        console.log(`\n${catName}:`);
        console.log('-'.repeat(catName.length + 1));

        for (const item of items) {
          console.log(`  ${item.key}`);
          console.log(`    default: ${item.default}`);
          if (item.profiles) {
            for (const [profile, value] of Object.entries(item.profiles)) {
              console.log(`    ${profile}: ${value}`);
            }
          }
        }
      }
    });

  // versions
  program.command('versions')
    .description('Show component versions (from components.yaml)')
    .option('--json', 'JSON output')
    .option('--components', 'Show components definition with file path')
    .action((options) => {
      // --components: show raw components definition
      if (options.components) {
        const componentsFile = getComponentsFile();
        const exists = fs.existsSync(componentsFile);
        if (options.json) {
          const config = exists ? loadComponents() : null;
          jsonOut({ file: componentsFile, exists, components: config?.components || [] });
        } else {
          console.log(`## Components: ${componentsFile}`);
          console.log(`## Edit this file to manage component versions.\n`);
          if (!exists) {
            console.log(`File not found. Create it to track component versions.`);
            console.log(`See: docs/version_tracking.md`);
          } else {
            const content = fs.readFileSync(componentsFile, 'utf8');
            console.log(content);
          }
        }
        return;
      }

      const versions = getAllVersions();

      if (options.json) {
        jsonOut(versions);
      } else {
        // Calculate column widths
        const nameWidth = Math.max(10, ...versions.map(v => v.name.length));
        const versionWidth = Math.max(7, ...versions.map(v => v.version.length));
        const sourceWidth = Math.max(6, ...versions.map(v => v.source.length));

        // Header
        const header = `${'Component'.padEnd(nameWidth)}  ${'Version'.padEnd(versionWidth)}  ${'Source'.padEnd(sourceWidth)}  Changelog`;
        console.log(header);
        console.log('-'.repeat(header.length + 10));

        // Rows
        versions.forEach(v => {
          const name = v.main ? `${v.name} *` : v.name;
          const changelog = v.changelog || '-';
          console.log(`${name.padEnd(nameWidth)}  ${v.version.padEnd(versionWidth)}  ${v.source.padEnd(sourceWidth)}  ${changelog}`);
        });
      }
    });

  // version group
  const version = program.command('version')
    .description('Version management (bump)');

  addDynamicHelp(version, { entityType: 'version' });

  // version:bump
  version.command('bump <component> <type>')
    .description('Bump component version (type: major, minor, patch)')
    .option('--dry-run', 'Check if bump is possible without making changes')
    .option('--json', 'JSON output')
    .action((componentKey, bumpType, options) => {
      // Validate bump type
      if (!['major', 'minor', 'patch'].includes(bumpType)) {
        console.error(`Invalid bump type: ${bumpType}`);
        console.error('Use: major, minor, or patch');
        process.exit(1);
      }

      // Check component exists first
      const component = findComponent(componentKey);
      if (!component) {
        const config = loadComponents();
        const available = config.components?.map(c => c.key).join(', ') || '(none)';
        console.error(`Component not found: ${componentKey}`);
        console.error(`Available: ${available}`);
        process.exit(1);
      }

      // Perform bump (or dry-run)
      const result = bumpComponentVersion(componentKey, bumpType, { dryRun: options.dryRun });

      if (options.json) {
        jsonOut(result);
        return;
      }

      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      if (options.dryRun) {
        console.log('Dry run - no changes made\n');
        console.log(`Component:   ${result.component}`);
        console.log(`Source:      ${result.source}`);
        console.log(`Current:     ${result.oldVersion}`);
        console.log(`Would bump:  ${result.oldVersion} → ${result.newVersion} (${bumpType})`);
      } else {
        console.log(`Bumped ${result.component}: ${result.oldVersion} → ${result.newVersion}`);
        console.log(`Source: ${result.source}`);
      }
    });

  // status
  program.command('status')
    .description('Project overview (tasks by status, PRDs)')
    .option('--json', 'JSON output')
    .action((options) => {
      const { tasks, blocks } = buildDependencyGraph();

      // Count tasks by status
      const byStatus = { done: 0, inProgress: 0, notStarted: 0, blocked: 0, cancelled: 0 };
      let ready = 0;

      for (const [id, task] of tasks) {
        if (isStatusDone(task.status)) byStatus.done++;
        else if (isStatusInProgress(task.status)) byStatus.inProgress++;
        else if (isStatusNotStarted(task.status)) {
          byStatus.notStarted++;
          // Check if ready
          const allBlockersDone = task.blockedBy.every(b => {
            const blocker = tasks.get(b);
            return !blocker || isStatusDone(blocker.status);
          });
          if (allBlockersDone) ready++;
        }
        else if (task.status?.toLowerCase().includes('block')) byStatus.blocked++;
        else if (task.status?.toLowerCase().includes('cancel')) byStatus.cancelled++;
      }

      // Count PRDs
      const prds = findPrdDirs().map(d => {
        const prdFile = path.join(d, 'prd.md');
        const file = loadFile(prdFile);
        return {
          id: file?.data?.id || path.basename(d).match(/PRD-\d+/)?.[0],
          title: file?.data?.title || '',
          status: file?.data?.status || 'Unknown'
        };
      });

      const mainVersion = getMainVersion();

      const output = {
        version: mainVersion,
        tasks: {
          total: tasks.size,
          ...byStatus,
          ready
        },
        prds: prds.length,
        prdList: prds
      };

      if (options.json) {
        jsonOut(output);
      } else {
        console.log(`${getMainComponentName()} v${mainVersion}\n`);
        console.log(`Tasks: ${tasks.size} total`);
        console.log(`  ✓ Done: ${byStatus.done}`);
        console.log(`  ● In Progress: ${byStatus.inProgress}`);
        console.log(`  ◌ Not Started: ${byStatus.notStarted} (${ready} ready)`);
        if (byStatus.blocked > 0) console.log(`  ✗ Blocked: ${byStatus.blocked}`);
        if (byStatus.cancelled > 0) console.log(`  ○ Cancelled: ${byStatus.cancelled}`);
        console.log(`\nPRDs: ${prds.length}`);
        prds.forEach(p => {
          console.log(`  ${statusSymbol(p.status)} ${p.id}: ${p.title}`);
        });
      }
    });

  // state group
  const state = program.command('state')
    .description('State management (ID counters)');

  addDynamicHelp(state, { entityType: 'state' });

  // state:show (default)
  state.command('show')
    .description('Show ID counters (PRD, Epic, Task)')
    .option('--json', 'JSON output')
    .action((options) => {
      const stateData = loadState();

      if (options.json) {
        jsonOut(stateData);
      } else {
        console.log('State counters:');
        console.log(`  PRD:  ${stateData.counters.prd}`);
        console.log(`  Epic: ${stateData.counters.epic}`);
        console.log(`  Task: ${stateData.counters.task}`);
        console.log(`\nFile: ${getStateFile()}`);
      }
    });

  // state:set
  state.command('set <type> <value>')
    .description('Set a state counter (type: prd, epic, task)')
    .action((type, value) => {
      const num = parseInt(value, 10);
      if (isNaN(num)) {
        console.error('Value must be a number');
        process.exit(1);
      }

      if (!['prd', 'epic', 'task'].includes(type)) {
        console.error('Type must be prd, epic, or task');
        process.exit(1);
      }

      const stateData = loadState();
      stateData.counters[type] = num;
      saveState(stateData);
      console.log(`Set ${type} counter to ${num}`);
    });

  // feedback group
  const feedback = program.command('feedback')
    .description('Feedback management (agent systemic issues)');

  addDynamicHelp(feedback, { entityType: 'feedback' });

  // feedback:add
  feedback.command('add <message>')
    .description('Log agent feedback (systemic issues, not task-specific)')
    .option('-t, --task <id>', 'Related task')
    .action((message, options) => {
      const feedbackFile = path.join(getSailingDir(), 'feedback.log');
      const date = new Date().toISOString();
      const taskRef = options.task ? ` [${options.task}]` : '';
      const entry = `${date}${taskRef}: ${message}\n`;

      fs.appendFileSync(feedbackFile, entry);
      console.log('Feedback logged.');
    });

  // feedback:list
  feedback.command('list')
    .description('Show feedback log')
    .option('-l, --limit <n>', 'Limit entries', parseInt, 20)
    .action((options) => {
      const feedbackFile = path.join(getSailingDir(), 'feedback.log');

      if (!fs.existsSync(feedbackFile)) {
        console.log('No feedback yet.');
        return;
      }

      const content = fs.readFileSync(feedbackFile, 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const limited = lines.slice(-options.limit);

      console.log('Recent feedback:\n');
      limited.forEach(line => console.log(`  ${line}`));

      if (lines.length > options.limit) {
        console.log(`\n... and ${lines.length - options.limit} more`);
      }
    });

  // init
  program.command('init')
    .description('Initialize sailing project structure')
    .option('-y, --yes', 'Overwrite existing files without prompting')
    .option('--dry-run', 'Show what would be done without making changes')
    .action((options) => {
      const projectRoot = findProjectRoot();
      const sailingDir = getSailingDir();
      const artefactsDir = getArtefactsDir();
      const distDir = path.join(path.dirname(path.dirname(import.meta.dirname)), 'dist');

      let created = 0;
      let skipped = 0;

      // Helper to create file
      const createFile = (destPath, content, label) => {
        const exists = fs.existsSync(destPath);
        if (exists && !options.yes) {
          console.log(`⚠ Exists (skipped): ${label} — use -y to overwrite`);
          skipped++;
          return;
        }
        if (options.dryRun) {
          console.log(`Would ${exists ? 'overwrite' : 'create'}: ${label}`);
        } else {
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.writeFileSync(destPath, content);
          console.log(`✓ ${exists ? 'Overwritten' : 'Created'}: ${label}`);
        }
        created++;
      };

      // Helper to copy from dist
      const copyDist = (src, destPath, label) => {
        const srcPath = path.join(distDir, src);
        if (!fs.existsSync(srcPath)) {
          console.log(`⚠ Template not found: ${src}`);
          return;
        }
        createFile(destPath, fs.readFileSync(srcPath, 'utf8'), label);
      };

      console.log('Initializing sailing...\n');

      // 1. Create directories
      const dirs = [
        { path: sailingDir, label: '.sailing/' },
        { path: artefactsDir, label: 'artefacts/' },
        { path: getMemoryDir(), label: 'memory/' },
        { path: getPrdsDir(), label: 'prds/' }
      ];

      for (const dir of dirs) {
        if (!fs.existsSync(dir.path)) {
          if (options.dryRun) {
            console.log(`Would create dir: ${dir.label}`);
          } else {
            fs.mkdirSync(dir.path, { recursive: true });
            console.log(`✓ Created dir: ${dir.label}`);
          }
        }
      }

      // 2. Config files
      copyDist('paths.yaml-dist', path.join(sailingDir, 'paths.yaml'), 'paths.yaml');
      copyDist('components.yaml-dist', path.join(sailingDir, 'components.yaml'), 'components.yaml');

      // Generate config.yaml from schema
      const schema: ConfigSchema = getSchema();
      const configLines = ['# Sailing configuration', '# Generated from schema', ''];
      const sections: Record<string, Array<ConfigSchemaEntry & { key: string }>> = {};
      for (const [key, def] of Object.entries(schema)) {
        const [section, ...rest] = key.split('.');
        if (!sections[section]) sections[section] = [];
        sections[section].push({ key: rest.join('.'), ...def });
      }
      for (const [section, items] of Object.entries(sections)) {
        configLines.push(`${section}:`);
        for (const item of items) {
          configLines.push(`  # ${item.description}`);
          const value = typeof item.default === 'string' ? item.default : JSON.stringify(item.default);
          configLines.push(`  ${item.key}: ${value}`);
        }
        configLines.push('');
      }
      createFile(path.join(sailingDir, 'config.yaml'), configLines.join('\n'), 'config.yaml');

      // State file
      const stateContent = JSON.stringify({ counters: { prd: 0, epic: 0, task: 0, story: 0 } }, null, 2);
      createFile(path.join(sailingDir, 'state.json'), stateContent, 'state.json');

      // 3. Artefact templates
      copyDist('ROADMAP.md-dist', path.join(artefactsDir, 'ROADMAP.md'), 'ROADMAP.md');
      copyDist('POSTIT.md-dist', path.join(artefactsDir, 'POSTIT.md'), 'POSTIT.md');

      // Summary
      console.log('');
      if (options.dryRun) {
        console.log('Dry run complete. No changes made.');
      } else {
        console.log(`Init complete: ${created} created, ${skipped} skipped`);
        console.log('\nNext: Create a PRD with /dev:prd-create or rudder prd:create "Title"');
      }
    });

  // ensure (migrate to frontmatter)
  program.command('ensure')
    .description('Fix files with missing frontmatter (id, parent)')
    .action(() => {
      let fixed = 0;

      for (const prdDir of findPrdDirs()) {
        // Check PRD
        const prdFile = path.join(prdDir, 'prd.md');
        if (fs.existsSync(prdFile)) {
          const file = loadFile(prdFile);
          if (file && Object.keys(file.data).length === 0) {
            console.log(`Would fix: ${prdFile}`);
            fixed++;
          }
        }

        // Check epics
        findFiles(path.join(prdDir, 'epics'), /^E\d+.*\.md$/).forEach(f => {
          const file = loadFile(f);
          if (file) {
            let needsFix = false;
            const fm = file.data;

            // Ensure required fields
            if (!fm.id) {
              fm.id = path.basename(f, '.md').match(/^E\d+/)?.[0];
              needsFix = true;
            }
            if (!fm.parent) {
              fm.parent = path.basename(prdDir).split('-').slice(0, 2).join('-');
              needsFix = true;
            }

            if (needsFix) {
              saveFile(f, fm, file.body);
              console.log(`Fixed: ${f}`);
              fixed++;
            }
          }
        });

        // Check tasks
        findFiles(path.join(prdDir, 'tasks'), /^T\d+.*\.md$/).forEach(f => {
          const file = loadFile(f);
          if (file) {
            let needsFix = false;
            const fm = file.data;

            if (!fm.id) {
              fm.id = path.basename(f, '.md').match(/^T\d+/)?.[0];
              needsFix = true;
            }
            if (!fm.parent) {
              fm.parent = path.basename(prdDir).split('-').slice(0, 2).join('-');
              needsFix = true;
            }

            if (needsFix) {
              saveFile(f, fm, file.body);
              console.log(`Fixed: ${f}`);
              fixed++;
            }
          }
        });
      }

      console.log(`\nFixed ${fixed} file(s)`);
    });

  // fix:chmod - Fix file permissions (600 → 644)
  const fix = program.command('fix')
    .description('Fix common issues');

  fix.command('chmod')
    .description('Fix file permissions (600 → 644) caused by Claude Code Write tool')
    .option('--dry-run', 'Show what would be done')
    .action((options) => {
      const projectRoot = findProjectRoot();
      const extensions = ['js', 'md', 'yaml', 'yml', 'json', 'sh', 'txt'];
      let fixed = 0;

      const fixPerms = (filePath) => {
        try {
          const stats = fs.statSync(filePath);
          const mode = stats.mode & 0o777;

          // Fix 600 → 644 for regular files
          if (mode === 0o600) {
            if (options.dryRun) {
              console.log(`Would fix: ${path.relative(projectRoot, filePath)}`);
            } else {
              fs.chmodSync(filePath, 0o644);
              console.log(`Fixed: ${path.relative(projectRoot, filePath)}`);
            }
            fixed++;
          }
        } catch {
          // Ignore errors
        }
      };

      const walkDir = (dir) => {
        if (!fs.existsSync(dir)) return;
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              // Skip node_modules and .git
              if (entry.name !== 'node_modules' && entry.name !== '.git') {
                walkDir(fullPath);
              }
            } else if (entry.isFile()) {
              const ext = path.extname(entry.name).slice(1);
              if (extensions.includes(ext) || entry.name.startsWith('.')) {
                fixPerms(fullPath);
              }
            }
          }
        } catch {
          // Ignore permission errors
        }
      };

      console.log('Scanning for files with 600 permissions...\n');
      walkDir(projectRoot);

      if (fixed === 0) {
        console.log('No files need fixing.');
      } else {
        console.log(`\n${options.dryRun ? 'Would fix' : 'Fixed'}: ${fixed} file(s)`);
      }
    });

}
