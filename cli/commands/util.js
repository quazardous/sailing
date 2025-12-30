/**
 * Utility commands for rudder CLI
 */
import fs from 'fs';
import path from 'path';
import { findPrdDirs, findFiles, loadFile, saveFile, jsonOut, getSailingDir, getStateFile, getPrdsDir, getConfigInfo, getPathsInfo } from '../lib/core.js';
import { addDynamicHelp } from '../lib/help.js';
import { loadState, saveState } from '../lib/state.js';
import { getAllVersions, getMainVersion, getMainComponentName } from '../lib/version.js';
import { buildDependencyGraph } from '../lib/graph.js';
import { isStatusDone, isStatusInProgress, isStatusNotStarted, statusSymbol } from '../lib/lexicon.js';

/**
 * Register utility commands
 */
export function registerUtilCommands(program) {
  // config
  program.command('config')
    .description('Show configuration (paths, CLI location)')
    .option('--json', 'JSON output')
    .action((options) => {
      const info = getConfigInfo();

      if (options.json) {
        jsonOut(info);
        return;
      }

      console.log('Sailing Configuration\n');
      console.log(`Project root:  ${info.projectRoot}`);
      console.log(`Sailing dir:   ${info.sailingDir}`);
      console.log(`CLI path:      ${info.cliPath}`);
      console.log(`paths.yaml:    ${info.pathsConfigPath} ${info.pathsConfigExists ? '✓' : '(not found)'}`);
      console.log('\nConfigured paths:\n');

      for (const [key, val] of Object.entries(info.paths)) {
        const markers = [];
        if (val.isCustom) markers.push('custom');
        if (val.isAbsolute) markers.push('absolute');
        const marker = markers.length > 0 ? ` (${markers.join(', ')})` : '';
        console.log(`  ${key.padEnd(12)} ${val.path}${marker}`);
      }
    });

  // paths (authoritative for agents)
  program.command('paths')
    .description('Show paths for agents (authoritative source)')
    .argument('[key]', 'Specific path key (roadmap, postit, artefacts, templates)')
    .option('--json', 'JSON output')
    .action((key, options) => {
      const paths = getPathsInfo();

      if (key) {
        if (!paths[key]) {
          console.error(`Unknown path key: ${key}`);
          console.error(`Available: ${Object.keys(paths).join(', ')}`);
          process.exit(1);
        }
        console.log(paths[key].absolute);
        return;
      }

      if (options.json) {
        const result = {};
        for (const [k, v] of Object.entries(paths)) {
          result[k] = v.absolute;
        }
        jsonOut(result);
        return;
      }

      // Human readable
      for (const [k, v] of Object.entries(paths)) {
        console.log(`${k.padEnd(12)} ${v.relative}`);
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
