/**
 * Utility commands for rudder CLI
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { findPrdDirs, findFiles, loadFile, saveFile, jsonOut, getSailingDir, getStateFile, getConfigFile, getComponentsFile, getPrdsDir, getConfigInfo, getPathsInfo, findProjectRoot, getArtefactsDir, getMemoryDir, getTemplatesDir, getPromptingDir } from '../lib/core.js';
import { getPlaceholders, resolvePlaceholders, computeProjectHash } from '../lib/paths.js';
import { addDynamicHelp } from '../lib/help.js';
import { loadState, saveState } from '../lib/state.js';
import { getAllVersions, getMainVersion, getMainComponentName } from '../lib/version.js';
import { buildDependencyGraph } from '../lib/graph.js';
import { isStatusDone, isStatusInProgress, isStatusNotStarted, statusSymbol } from '../lib/lexicon.js';
import { loadConfig as loadAgentConfig, getConfigDisplay, getSchema, getConfigPath, getAgentConfig } from '../lib/config.js';
import { getWorktreesDir, getAgentsDir, getPathType } from '../lib/core.js';

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
      const sections = {};
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
        const markers = [];
        if (val.isCustom) markers.push('custom');
        if (val.isAbsolute) markers.push('absolute');
        const marker = markers.length > 0 ? `  # (${markers.join(', ')})` : '';
        console.log(`  ${key}: ${val.path}${marker}`);
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

      const schema = getSchema();
      const lines = ['# Sailing configuration', '# Generated from schema - edit as needed', ''];

      // Group by section
      const sections = {};
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

  // config:check
  config.command('check')
    .description('Validate project setup (files, folders, YAML syntax)')
    .option('--json', 'JSON output')
    .option('--fix', 'Create missing directories and files')
    .action((options) => {
      const results = {
        directories: [],
        files: [],
        yaml: [],
        state: null,
        summary: { ok: 0, warn: 0, error: 0 }
      };

      const check = (category, name, status, message = '') => {
        const entry = { name, status, message };
        results[category].push(entry);
        if (status === 'ok') results.summary.ok++;
        else if (status === 'warn') results.summary.warn++;
        else results.summary.error++;
        return status;
      };

      const projectRoot = findProjectRoot();
      const sailingDir = getSailingDir();
      const agentConfig = getAgentConfig();

      // 1. Check required directories
      const requiredDirs = [
        { name: '.sailing', path: sailingDir },
        { name: 'artefacts', path: getArtefactsDir() },
        { name: 'memory', path: getMemoryDir() },
        { name: 'templates', path: getTemplatesDir() },
        { name: 'prompting', path: getPromptingDir() },
        { name: 'prds', path: getPrdsDir() }
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
        const schema = getSchema();
        const lines = ['# Sailing configuration', '# Generated from schema - edit as needed', ''];
        const sections = {};
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

      // 3. Validate YAML syntax
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

      // 4. Validate state.json
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

      // 5. Validate agent config loads
      try {
        loadAgentConfig();
        check('yaml', 'agent config', 'ok', 'Config loads successfully');
      } catch (e) {
        check('yaml', 'agent config', 'error', `Failed to load: ${e.message}`);
      }

      // Output
      if (options.json) {
        jsonOut(results);
        return;
      }

      const symbol = (s) => s === 'ok' ? '✓' : s === 'warn' ? '⚠' : '✗';

      console.log('Project Check\n');

      console.log('Directories:');
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
          const c = results.state.counters;
          console.log(`  ${symbol('ok')} counters        PRD=${c.prd} Epic=${c.epic} Task=${c.task} Story=${c.story || 0}`);
        } else {
          console.log(`  ${symbol(results.state.status)} state.json      ${results.state.message}`);
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
        const result = { paths: {} };
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
    .description('Show project hash (used for %project_hash%)')
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

  // versions
  program.command('versions')
    .description('Show component versions (from components.yaml)')
    .option('--json', 'JSON output')
    .action((options) => {
      const versions = getAllVersions();

      if (options.json) {
        jsonOut(versions);
      } else {
        console.log('Component Versions:\n');
        versions.forEach(v => {
          const marker = v.main ? ' (main)' : '';
          console.log(`  ${v.name}: ${v.version}${marker}`);
        });
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
    .description('Initialize sailing (copy -dist templates → create prds/)')
    .option('-y, --yes', 'Overwrite existing files without prompting')
    .option('--dry-run', 'Show what would be done without making changes')
    .action((options) => {
      const distFiles = [
        { src: 'ROADMAP.md-dist', dest: 'ROADMAP.md' },
        { src: 'POSTIT.md-dist', dest: 'POSTIT.md' },
        { src: 'components.yaml-dist', dest: 'components.yaml' }
      ];

      let created = 0;
      let skipped = 0;
      let overwritten = 0;

      const sailingDir = getSailingDir();
      for (const { src, dest } of distFiles) {
        const srcPath = path.join(sailingDir, src);
        const destPath = path.join(sailingDir, dest);

        // Check if source exists
        if (!fs.existsSync(srcPath)) {
          console.log(`⚠ Template not found: ${src}`);
          continue;
        }

        // Check if destination exists
        if (fs.existsSync(destPath)) {
          if (options.yes) {
            if (options.dryRun) {
              console.log(`Would overwrite: ${dest}`);
            } else {
              fs.copyFileSync(srcPath, destPath);
              console.log(`✓ Overwritten: ${dest}`);
            }
            overwritten++;
          } else {
            console.log(`⚠ Exists (skipped): ${dest} — use -y to overwrite`);
            skipped++;
          }
        } else {
          if (options.dryRun) {
            console.log(`Would create: ${dest}`);
          } else {
            fs.copyFileSync(srcPath, destPath);
            console.log(`✓ Created: ${dest}`);
          }
          created++;
        }
      }

      // Create prds directory if needed
      const prdsDir = getPrdsDir();
      if (!fs.existsSync(prdsDir)) {
        if (options.dryRun) {
          console.log('Would create: prds/');
        } else {
          fs.mkdirSync(prdsDir, { recursive: true });
          console.log('✓ Created: prds/');
        }
      }

      // Summary
      console.log('');
      if (options.dryRun) {
        console.log('Dry run complete. No changes made.');
      } else {
        console.log(`Init complete: ${created} created, ${overwritten} overwritten, ${skipped} skipped`);
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

}
