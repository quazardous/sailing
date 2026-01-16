/**
 * PRD commands for rudder CLI
 */
import fs from 'fs';
import path from 'path';
import { findPrdDirs, loadFile, saveFile, toKebab, jsonOut, getPrdsDir, stripComments } from '../managers/core-manager.js';
import { matchesPrdDir } from '../lib/normalize.js';
import { STATUS, normalizeStatus, statusSymbol } from '../lib/lexicon.js';
import { nextId } from '../managers/state-manager.js';
import { parseUpdateOptions } from '../lib/update.js';
import { addDynamicHelp, withModifies } from '../lib/help.js';
import { formatId } from '../managers/core-manager.js';
import { parseSearchReplace, editArtifact, parseMultiSectionContent, processMultiSectionOps } from '../lib/artifact.js';
import { getPrd, getEpicsForPrd, getTasksForPrd, getAllPrds } from '../managers/artefacts-manager.js';
import { createPrdMemoryFile } from '../managers/memory-manager.js';
import { Prd } from '../lib/types/entities.js';
import type { Command } from 'commander';

// Option interfaces
interface ListOptions {
  status?: string;
  tag?: string[];
  limit?: number;
  path?: boolean;
  json?: boolean;
}

interface ShowOptions {
  raw?: boolean;
  stripComments?: boolean;
  path?: boolean;
  json?: boolean;
}

interface CreateOptions {
  tag?: string[];
  path?: boolean;
  json?: boolean;
}

interface UpdateOptions {
  status?: string;
  title?: string;
  set?: string[];
  json?: boolean;
}

interface MilestoneOptions {
  addEpic?: string[];
  removeEpic?: string[];
  json?: boolean;
}

interface PatchOptions {
  file?: string;
  dryRun?: boolean;
  json?: boolean;
}

interface EditOptions {
  section?: string;
  content?: string;
  append?: boolean;
  prepend?: boolean;
  json?: boolean;
}

/**
 * Register PRD commands
 */
export function registerPrdCommands(program: Command): void {
  const prd = program.command('prd').description('PRD operations (product requirements)');

  // Dynamic help generated from registered commands
  addDynamicHelp(prd, { entityType: 'prd' });

  const statusHelp = STATUS.prd.join(', ');

  // prd:list
  prd.command('list')
    .description('List PRDs with epic/task counts')
    .option('-s, --status <status>', `Filter by status (${statusHelp})`)
    .option('-t, --tag <tag>', 'Filter by tag (repeatable, AND logic)', (v, arr) => arr.concat(v), [])
    .option('-l, --limit <n>', 'Limit results', parseInt)
    .option('--path', 'Include directory path (discouraged)')
    .option('--json', 'JSON output')
    .action((options: ListOptions) => {
      const prds: (Prd & { dir?: string; epics: number; tasks: number })[] = [];

      for (const prdEntry of getAllPrds()) {
        const data = prdEntry.data;

        // Status filter
        if (options.status) {
          const targetStatus = normalizeStatus(options.status, 'prd');
          const prdStatus = normalizeStatus(data.status, 'prd');
          if (targetStatus !== prdStatus) continue;
        }

        // Tag filter (AND logic)
        if (options.tag && options.tag.length > 0) {
          const prdTags: string[] = data.tags || [];
          const allTagsMatch = options.tag.every((t: string) => prdTags.includes(t));
          if (!allTagsMatch) continue;
        }

        // Count epics and tasks (artefacts.ts contract)
        const epicCount = getEpicsForPrd(prdEntry.num).length;
        const taskCount = getTasksForPrd(prdEntry.num).length;

        const result: Prd & { dir?: string; epics: number; tasks: number } = {
          id: data.id || prdEntry.id,
          title: data.title || '',
          status: data.status || 'Unknown',
          parent: data.parent || '',
          epics: epicCount,
          tasks: taskCount
        };
        if (options.path) result.dir = prdEntry.dir;
        prds.push(result);
      }

      // Sort by ID
      prds.sort((a, b) => {
        const numA = parseInt(a.id?.match(/\d+/)?.[0] || '0');
        const numB = parseInt(b.id?.match(/\d+/)?.[0] || '0');
        return numA - numB;
      });

      // Apply limit
      const limited = options.limit ? prds.slice(0, options.limit) : prds;

      if (options.json) {
        jsonOut(limited);
      } else {
        if (limited.length === 0) {
          console.log('No PRDs found.');
        } else {
          limited.forEach(p => {
            const sym = statusSymbol(p.status);
            console.log(`${sym} ${p.id}: ${p.title} [${p.status}] (${p.epics} epics, ${p.tasks} tasks)`);
          });
          if (options.limit && prds.length > options.limit) {
            console.log(`\n... and ${prds.length - options.limit} more`);
          }
        }
      }
    });

  // prd:show
  prd.command('show <id>')
    .description('Show PRD details (epics, tasks by status)')
    .option('--raw', 'Dump raw markdown')
    .option('--strip-comments', 'Strip template comments from output')
    .option('--path', 'Include file path (discouraged)')
    .option('--json', 'JSON output')
    .action((id: string, options: ShowOptions) => {
      const prdDir = findPrdDirs().find(d => matchesPrdDir(d, id));
      if (!prdDir) {
        console.error(`PRD not found: ${id}`);
        process.exit(1);
      }

      const prdFile = path.join(prdDir, 'prd.md');

      // Raw mode: dump file content
      if (options.raw) {
        if (options.path) console.log(`# File: ${prdFile}\n`);
        const content = fs.readFileSync(prdFile, 'utf8');
        console.log(options.stripComments ? stripComments(content) : content);
        return;
      }

      const file = loadFile(prdFile);
      if (!file) {
        console.error(`PRD file not found: ${prdFile}`);
        process.exit(1);
      }

      // Get epics and tasks (artefacts.ts contract)
      const epics = getEpicsForPrd(id).map(e => ({
        id: e.data?.id,
        title: e.data?.title,
        status: e.data?.status
      }));

      const tasks = getTasksForPrd(id).map(t => ({
        id: t.data?.id,
        status: t.data?.status
      }));

      const tasksByStatus: Record<string, number> = {};
      tasks.forEach(t => {
        const status = t.status || 'Unknown';
        tasksByStatus[status] = (tasksByStatus[status] || 0) + 1;
      });

      const output: Record<string, unknown> = {
        ...file.data,
        epicCount: epics.length,
        taskCount: tasks.length,
        epics,
        tasksByStatus
      };
      if (options.path) {
        output.dir = prdDir;
        output.file = prdFile;
      }

      if (options.json) {
        jsonOut(output);
      } else {
        console.log(`# ${file.data.id}: ${file.data.title}\n`);
        console.log(`Status: ${file.data.status}`);
        console.log(`\nEpics: ${epics.length}`);
        epics.forEach(e => {
          console.log(`  ${statusSymbol(e.status)} ${e.id}: ${e.title}`);
        });
        console.log(`\nTasks: ${tasks.length}`);
        Object.entries(tasksByStatus).forEach(([status, count]) => {
          console.log(`  ${statusSymbol(status)} ${status}: ${count}`);
        });
        if (options.path) console.log(`\nDirectory: ${prdDir}`);
      }
    });

  // prd:create
  withModifies(prd.command('create <title>'), ['prd'])
    .description('Create PRD directory + prd.md (status: Draft)')
    .option('--tag <tag>', 'Add tag (repeatable, slugified to kebab-case)', (v, arr) => arr.concat(v), [])
    .option('--path', 'Show file path')
    .option('--json', 'JSON output')
    .action((title: string, options: CreateOptions) => {
      const num = nextId('prd');
      const id = formatId('PRD-', num);
      const dirName = `${id}-${toKebab(title)}`;
      const prdsDir = getPrdsDir();
      const prdDir = path.join(prdsDir, dirName);

      if (!fs.existsSync(prdsDir)) {
        fs.mkdirSync(prdsDir, { recursive: true });
      }

      fs.mkdirSync(prdDir);
      fs.mkdirSync(path.join(prdDir, 'epics'));
      fs.mkdirSync(path.join(prdDir, 'tasks'));

      const data: Prd = {
        id,
        title,
        status: 'Draft',
        parent: '',
        tags: []
      };

      // Add tags if specified (slugified to kebab-case)
      if (options.tag && options.tag.length > 0) {
        data.tags = options.tag.map((t: string) => toKebab(t));
      }

      const body = `\n# ${id}: ${title}\n\n## Problem Statement\n\n[Describe the problem]\n\n## Goals\n\n- [Goal 1]\n\n## Non-Goals\n\n- [Non-goal 1]\n\n## Solution Overview\n\n[High-level approach]\n`;

      const prdFile = path.join(prdDir, 'prd.md');
      saveFile(prdFile, data, body);

      // Create PRD memory file
      createPrdMemoryFile(id);

      if (options.json) {
        const output: Record<string, unknown> = { id, title };
        if (options.path) {
          output.dir = prdDir;
          output.file = prdFile;
        }
        jsonOut(output);
      } else {
        console.log(`Created: ${id} - ${title}`);
        if (options.path) console.log(`File: ${prdFile}`);
        console.log(`\n${'─'.repeat(60)}\n`);
        console.log(fs.readFileSync(prdFile, 'utf8'));
        console.log(`${'─'.repeat(60)}`);
        console.log(`\nEdit with CLI:`);
        console.log(`  rudder artifact patch ${id} <<EOF`);
        console.log(`  ## Problem Statement`);
        console.log(`  Your problem description here...`);
        console.log(`  EOF`);
        console.log(`\nMore: rudder artifact --help`);
      }
    });

  // prd:update
  withModifies(prd.command('update <id>'), ['prd'])
    .description('Update PRD (status, title)')
    .option('-s, --status <status>', `Set status (${statusHelp})`)
    .option('-t, --title <title>', 'Set title')
    .option('--set <key=value>', 'Set any frontmatter field (repeatable)', (v, arr) => arr.concat(v), [])
    .option('--json', 'JSON output')
    .action((id: string, options: UpdateOptions) => {
      const prdDir = findPrdDirs().find(d => matchesPrdDir(d, id));
      if (!prdDir) {
        console.error(`PRD not found: ${id}`);
        process.exit(1);
      }

      const prdFile = path.join(prdDir, 'prd.md');
      const file = loadFile(prdFile);
      if (!file) {
        console.error(`PRD file not found: ${prdFile}`);
        process.exit(1);
      }

      const opts: { status?: string; title?: string; set: string[] | null } = {
        status: options.status,
        title: options.title,
        set: options.set && options.set.length > 0 ? options.set : null
      };

      const { updated, data } = parseUpdateOptions(opts, file.data, 'prd') as { updated: boolean; data: Partial<Prd> };

      if (updated) {
        saveFile(prdFile, data, file.body);
        if (options.json) {
          jsonOut(data);
        } else {
          console.log(`Updated: ${data.id}`);
        }
      } else {
        console.log('No changes made.');
      }
    });

  // prd:milestone
  withModifies(prd.command('milestone <prd-id> <milestone-id>'), ['prd'])
    .description('Manage PRD milestone (add/remove epics)')
    .option('--add-epic <epic>', 'Add epic to milestone (repeatable)', (v, arr) => arr.concat(v), [])
    .option('--remove-epic <epic>', 'Remove epic from milestone (repeatable)', (v, arr) => arr.concat(v), [])
    .option('--json', 'JSON output')
    .action((prdId: string, milestoneId: string, options: MilestoneOptions) => {
      const prdDir = findPrdDirs().find(d => matchesPrdDir(d, prdId));
      if (!prdDir) {
        console.error(`PRD not found: ${prdId}`);
        process.exit(1);
      }

      const prdFile = path.join(prdDir, 'prd.md');
      const file = loadFile(prdFile);
      if (!file) {
        console.error(`PRD file not found: ${prdFile}`);
        process.exit(1);
      }

      // Ensure milestones array exists
      if (!file.data.milestones) {
        file.data.milestones = [];
      }

      // Find or create milestone
      let milestone: { id: string; epics: string[] } | undefined = (file.data.milestones as { id: string; epics: string[] }[]).find((m: { id: string; epics: string[] }) => m.id === milestoneId);
      if (!milestone) {
        milestone = { id: milestoneId, epics: [] };
        file.data.milestones.push(milestone);
      }

      // Ensure epics array exists
      if (!milestone.epics) {
        milestone.epics = [];
      }

      let updated = false;
      const added: string[] = [];
      const removed: string[] = [];
      const skipped: string[] = [];

      // Add epics
      for (const epic of (options.addEpic || [])) {
        const epicId: string = epic.toUpperCase();
        if (milestone.epics.includes(epicId)) {
          skipped.push(epicId);
        } else {
          milestone.epics.push(epicId);
          added.push(epicId);
          updated = true;
        }
      }

      // Remove epics
      for (const epic of (options.removeEpic || [])) {
        const epicId: string = epic.toUpperCase();
        const idx: number = milestone.epics.indexOf(epicId);
        if (idx >= 0) {
          milestone.epics.splice(idx, 1);
          removed.push(epicId);
          updated = true;
        } else {
          skipped.push(epicId);
        }
      }

      // Sort epics for consistency
      milestone.epics.sort();

      if (updated) {
        saveFile(prdFile, file.data, file.body);
      }

      const result = {
        prd: file.data.id as string | undefined,
        milestone: milestoneId,
        epics: milestone.epics,
        added,
        removed,
        skipped,
        updated
      };

      if (options.json) {
        jsonOut(result);
      } else {
        if (!updated && added.length === 0 && removed.length === 0) {
          console.log(`Milestone ${milestoneId}: ${milestone.epics.join(', ') || '(no epics)'}`);
        } else {
          if (added.length > 0) {
            console.log(`Added to ${milestoneId}: ${added.join(', ')}`);
          }
          if (removed.length > 0) {
            console.log(`Removed from ${milestoneId}: ${removed.join(', ')}`);
          }
          if (skipped.length > 0) {
            console.log(`Skipped (no change): ${skipped.join(', ')}`);
          }
          console.log(`${milestoneId} epics: ${milestone.epics.join(', ') || '(none)'}`);
        }
      }
    });

  // prd:patch - Apply SEARCH/REPLACE blocks to PRD
  withModifies(prd.command('patch <id>'), ['prd'])
    .description('Apply SEARCH/REPLACE blocks to PRD (stdin or file)')
    .option('-f, --file <path>', 'Read patch from file instead of stdin')
    .option('--dry-run', 'Show what would be changed without applying')
    .option('--json', 'JSON output')
    .action(async (id: string, options: PatchOptions) => {
      const prdPath = getPrd(id)?.file;

      if (!prdPath) {
        console.error(`PRD not found: ${id}`);
        process.exit(1);
      }

      let patchContent: string;
      if (options.file) {
        if (!fs.existsSync(options.file)) {
          console.error(`Patch file not found: ${options.file}`);
          process.exit(1);
        }
        patchContent = fs.readFileSync(options.file, 'utf8');
      } else {
        patchContent = await new Promise<string>((resolve) => {
          let data = '';
          if (process.stdin.isTTY) { resolve(''); return; }
          process.stdin.setEncoding('utf8');
          process.stdin.on('readable', () => {
            let chunk: string | null;
            while ((chunk = process.stdin.read() as string | null) !== null) data += chunk;
          });
          process.stdin.on('end', () => resolve(data));
        });
      }

      if (!patchContent.trim()) {
        console.error('No patch content provided');
        process.exit(1);
      }

      const ops = parseSearchReplace(patchContent);
      if (ops.length === 0) {
        console.error('No valid SEARCH/REPLACE blocks found');
        process.exit(1);
      }

      if (options.dryRun) {
        if (options.json) {
          jsonOut({ id, ops, dry_run: true } as Record<string, unknown>);
        } else {
          console.log(`Would apply ${ops.length} patch(es) to ${id}`);
        }
        return;
      }

      const result = editArtifact(prdPath, ops);

      if (options.json) {
        jsonOut({ id, ...result } as Record<string, unknown>);
      } else if (result.success) {
        console.log(`✓ Applied ${result.applied} patch(es) to ${id}`);
      } else {
        console.error(`✗ Applied ${result.applied}/${ops.length}, errors:`);
        result.errors.forEach(e => console.error(`  - ${e}`));
        process.exit(1);
      }
    });

  // prd:edit - Edit PRD sections (delegates to artifact:edit logic)
  withModifies(prd.command('edit <id>'), ['prd'])
    .description('Edit PRD section(s)')
    .option('-s, --section <name>', 'Section to edit (omit for multi-section stdin)')
    .option('-c, --content <text>', 'New content (or use stdin)')
    .option('-a, --append', 'Append to section instead of replace')
    .option('-p, --prepend', 'Prepend to section instead of replace')
    .option('--json', 'JSON output')
    .addHelpText('after', `
Multi-section format: use ## headers with optional [op]
Operations: [replace], [append], [prepend], [delete], [sed], [check], [uncheck], [toggle], [patch]
See: bin/rudder artifact edit --help for full documentation
`)
    .action(async (id: string, options: EditOptions) => {
      const prdPath = getPrd(id)?.file;
      if (!prdPath) {
        console.error(`PRD not found: ${id}`);
        process.exit(1);
      }

      // Get content from option or stdin
      let content: string | undefined = options.content;
      if (!content) {
        content = await new Promise<string>((resolve) => {
          let data = '';
          if (process.stdin.isTTY) { resolve(''); return; }
          process.stdin.setEncoding('utf8');
          process.stdin.on('readable', () => {
            let chunk: string | null;
            while ((chunk = process.stdin.read() as string | null) !== null) data += chunk;
          });
          process.stdin.on('end', () => resolve(data));
        });
        content = content.trim();
      }

      if (!content) {
        console.error('Content required via --content or stdin');
        process.exit(1);
      }

      // Determine default operation
      let opType = 'replace';
      if (options.append) opType = 'append';
      if (options.prepend) opType = 'prepend';

      type OpType = { op: string; section: string; content: string };
      let ops: OpType[];
      if (options.section) {
        ops = [{ op: opType, section: options.section, content }];
      } else {
        ops = parseMultiSectionContent(content, opType) as OpType[];
        if (ops.length === 0) {
          console.error('No sections found. Use --section or format stdin with ## headers');
          process.exit(1);
        }
      }

      // Track original ops for output
      const originalOps: { op: string; section: string }[] = ops.map((o: OpType) => ({ op: o.op, section: o.section }));

      // Process special operations (sed, patch, check, etc.)
      const { expandedOps, errors: processErrors } = processMultiSectionOps(prdPath, ops);
      if (processErrors.length > 0) {
        processErrors.forEach(e => console.error(e));
        process.exit(1);
      }

      const result = editArtifact(prdPath, expandedOps);

      if (options.json) {
        jsonOut({ id, ...result } as Record<string, unknown>);
      } else if (result.success) {
        if (originalOps.length === 1) {
          console.log(`✓ ${originalOps[0].op} on ${originalOps[0].section} in ${id}`);
        } else {
          const byOp: Record<string, number> = {};
          originalOps.forEach((o: { op: string; section: string }) => {
            byOp[o.op] = (byOp[o.op] || 0) + 1;
          });
          const summary = Object.entries(byOp).map(([op, n]) => `${op}:${n}`).join(', ');
          console.log(`✓ ${originalOps.length} sections in ${id} (${summary})`);
        }
      } else {
        console.error(`✗ Failed: ${result.errors.join(', ')}`);
        process.exit(1);
      }
    });
}
