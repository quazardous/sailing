/**
 * Config commands - Configuration management
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import yaml from 'js-yaml';
import {
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
  resolvePlaceholders,
  loadConfig as loadAgentConfig,
  getConfigDisplay,
  getConfigSchema,
  getConfigPath,
  getAgentConfig
} from '../../managers/core-manager.js';
import { addDynamicHelp } from '../../lib/help.js';
import { ConfigDisplayItem, ConfigSchema, CheckResults, CheckEntry, ConfigSchemaEntry } from '../../lib/types/config.js';

/**
 * Register config commands
 */
export function registerConfigCommands(program) {
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
        const pathInfo = val;
        const markers = [];
        if (pathInfo.isCustom) markers.push('custom');
        if (pathInfo.isAbsolute) markers.push('external');
        const marker = markers.length > 0 ? `  # (${markers.join(', ')})` : '';
        console.log(`  ${key}: ${pathInfo.path}${marker}`);
      }
    });

  addDynamicHelp(config, { entityType: 'config' });

  // config:init
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

      const schema: ConfigSchema = getConfigSchema();
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
          if (item.values) {
            lines.push(`  # Valid: ${item.values.join(', ')}`);
          }
          const value = typeof item.default === 'string' ? item.default : JSON.stringify(item.default);
          lines.push(`  ${item.key}: ${value}`);
          lines.push('');
        }
      }

      fs.writeFileSync(configPath, lines.join('\n'));
      console.log(`Created: ${configPath}`);
    });

  // config:get
  config.command('get <key>')
    .description('Get a config value (e.g., agent.mcp_mode)')
    .action((key: string) => {
      const schema: ConfigSchema = getConfigSchema();

      if (!schema[key]) {
        console.error(`Unknown config key: ${key}`);
        console.error('\nAvailable keys:');
        Object.keys(schema).sort().forEach(k => console.error(`  ${k}`));
        process.exit(1);
      }

      const agentConfig = getAgentConfig();
      const [section, ...rest] = key.split('.');
      const property = rest.join('.');

      let value: unknown;
      if (section === 'agent') {
        value = agentConfig[property];
      } else if (section === 'git') {
        value = agentConfig[`git_${property}`] ?? schema[key].default;
      } else {
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

  // config:set
  config.command('set <key> <value>')
    .description('Set a config value (e.g., agent.mcp_mode socket)')
    .action((key: string, value: string) => {
      const schema: ConfigSchema = getConfigSchema();

      if (!schema[key]) {
        console.error(`Unknown config key: ${key}`);
        console.error('\nAvailable keys:');
        Object.keys(schema).sort().forEach(k => console.error(`  ${k}`));
        process.exit(1);
      }

      const def = schema[key];
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

      const configPath = getConfigPath();
      const [section, ...rest] = key.split('.');
      const property = rest.join('.');
      const yamlValue = typeof parsedValue === 'string' ? parsedValue : String(parsedValue);

      if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, `${section}:\n  ${property}: ${yamlValue}\n`);
        console.log(`Set ${key} = ${parsedValue}`);
        return;
      }

      const lines = fs.readFileSync(configPath, 'utf8').split('\n');
      let inSection = false;
      let foundKey = false;
      let sectionEndIndex = -1;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trimStart();

        if (!line.startsWith(' ') && !line.startsWith('\t') && trimmed.endsWith(':') && !trimmed.startsWith('#')) {
          const sectionName = trimmed.slice(0, -1);
          if (sectionName === section) {
            inSection = true;
            sectionEndIndex = i;
          } else if (inSection) {
            sectionEndIndex = i;
            break;
          }
        } else if (inSection && trimmed && !trimmed.startsWith('#')) {
          const match = trimmed.match(/^(\w+):/);
          if (match && match[1] === property) {
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
          lines.push(`${section}:`);
          lines.push(`  ${property}: ${yamlValue}`);
        } else {
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

      // Git checks
      let hasGitRepo = false;
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

          try {
            const gitBranch = execSync('git branch --show-current 2>/dev/null', {
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

          try {
            const status = execSync('git status --porcelain 2>/dev/null', {
              cwd: projectRoot,
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'pipe']
            }).trim();
            if (status === '') {
              check('git', 'status', 'ok', 'Working tree clean');
            } else {
              const lines = status.split('\n').length;
              check('git', 'status', 'warn', `${lines} uncommitted change(s)`);
            }
          } catch {
            check('git', 'status', 'warn', 'Could not check status');
          }

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

      // Directory checks
      const requiredDirs = [
        { name: '.sailing', path: sailingDir },
        { name: 'artefacts', path: getArtefactsDir() },
        { name: 'memory', path: getMemoryDir() },
        { name: 'templates', path: getTemplatesDir() },
        { name: 'prompting', path: getPromptingDir() },
        { name: 'prds', path: getPrdsDir() }
      ];

      const subprocessDirs = [
        { name: 'haven', path: resolvePlaceholders('${haven}') },
        { name: 'runs', path: getRunsDir() },
        { name: 'assignments', path: getAssignmentsDir() }
      ];

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
          if (fs.existsSync(dir.path)) {
            check('directories', dir.name, 'ok', `${dir.path} (not required)`);
          }
        }
      }

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
          if (fs.existsSync(dir.path)) {
            check('directories', dir.name, 'ok', `${dir.path} (not required)`);
          }
        }
      }

      // File checks
      const distDir = path.join(path.dirname(path.dirname(import.meta.dirname)), 'dist');

      const generateConfigYaml = () => {
        const schema: ConfigSchema = getConfigSchema();
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

      // Project files check
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
      }

      // YAML validation
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

      // State validation
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

      // Config load check
      try {
        loadAgentConfig();
        check('yaml', 'agent config', 'ok', 'Config loads successfully');
      } catch (e) {
        check('yaml', 'agent config', 'error', `Failed to load: ${e.message}`);
      }

      // Config hierarchy validation
      results.config = [];
      const configCheck = (name, status, message) => {
        results.config.push({ name, status, message });
        if (status === 'ok') results.summary.ok++;
        else if (status === 'warn') results.summary.warn++;
        else results.summary.error++;
      };

      const hasSubprocess = agentConfig.use_subprocess;
      const hasWorktrees = agentConfig.use_worktrees;
      const hasSandbox = agentConfig.sandbox;
      const hasRisky = agentConfig.risky_mode;

      if (hasSubprocess) {
        configCheck('use_subprocess', 'ok', 'Subprocess mode enabled');
      } else if (hasWorktrees || hasSandbox || hasRisky) {
        configCheck('use_subprocess', 'warn', 'Required by other options but disabled');
      }

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

  return config;
}
