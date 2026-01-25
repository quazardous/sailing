/**
 * Task modification commands (log, targets, patch, edit)
 */
import fs from 'fs';
import { jsonOut } from '../../managers/core-manager.js';
import { normalizeId } from '../../lib/normalize.js';
import { getAllTasks, getAllEpics } from '../../managers/artefacts-manager.js';
import { appendTaskLog } from '../../managers/memory-manager.js';
import { statusSymbol } from '../../lib/lexicon.js';
import { parseSearchReplace, editArtifact, parseMultiSectionContent, processMultiSectionOps } from '../../lib/artifact.js';
import { readStdin } from '../../lib/stdin.js';
import { findTaskFile } from './helpers.js';
/**
 * Register task:log, task:targets, task:patch, task:edit commands
 */
export function registerModifyCommands(task) {
    // task:log
    task.command('log <id> <message>')
        .description('Log message during task work (→ memory/TNNN.log)')
        .option('--info', 'Progress note (default)')
        .option('--tip', 'Useful learning, command, gotcha')
        .option('--warn', 'Issue encountered, workaround applied')
        .option('--error', 'Significant problem, needs review')
        .option('--critical', 'Cannot continue, blocks completion')
        .option('-f, --file <path>', 'Related file (repeatable)', (v, arr) => arr.concat(v), [])
        .option('-s, --snippet <code>', 'Code snippet (inline)')
        .option('-c, --cmd <command>', 'Related command')
        .action((id, message, options) => {
        // Verify task exists
        const taskFile = findTaskFile(id);
        if (!taskFile) {
            console.error(`Task not found: ${id}`);
            process.exit(1);
        }
        // Determine level from options
        let level = 'INFO';
        if (options.tip)
            level = 'TIP';
        else if (options.warn)
            level = 'WARN';
        else if (options.error)
            level = 'ERROR';
        else if (options.critical)
            level = 'CRITICAL';
        // Build metadata
        const meta = {};
        if (options.file?.length)
            meta.files = options.file;
        if (options.snippet)
            meta.snippet = options.snippet;
        if (options.cmd)
            meta.cmd = options.cmd;
        // Delegate to manager
        const taskId = normalizeId(id);
        appendTaskLog(taskId, level, message, meta);
        // Output
        let output = `[${level}] ${taskId}: ${message}`;
        if (options.file?.length)
            output += ` (files: ${options.file.join(', ')})`;
        if (options.cmd)
            output += ` (cmd: ${options.cmd})`;
        console.log(output);
    });
    // task:targets - find tasks with target_versions for a component
    task.command('targets <component>')
        .description('Find tasks with target_versions for a component')
        .option('--path', 'Include file path (discouraged)')
        .option('--json', 'JSON output')
        .action((component, options) => {
        const results = [];
        // Use artefacts.ts contract - single entry point
        for (const taskEntry of getAllTasks()) {
            const data = taskEntry.data;
            if (data?.target_versions && data.target_versions[component]) {
                const entry = {
                    id: data.id,
                    title: data.title,
                    status: data.status,
                    target_version: data.target_versions[component]
                };
                if (options.path)
                    entry.file = taskEntry.file;
                results.push(entry);
            }
        }
        // Also check epics (artefacts.ts contract)
        for (const epicEntry of getAllEpics()) {
            const data = epicEntry.data;
            if (data?.target_versions && data.target_versions[component]) {
                const entry = {
                    id: data.id,
                    title: data.title,
                    status: data.status,
                    target_version: data.target_versions[component],
                    type: 'epic'
                };
                if (options.path)
                    entry.file = epicEntry.file;
                results.push(entry);
            }
        }
        if (options.json) {
            jsonOut(results);
        }
        else {
            if (results.length === 0) {
                console.log(`No tasks/epics target component: ${component}`);
            }
            else {
                console.log(`Tasks/epics targeting ${component}:\n`);
                results.forEach(r => {
                    const sym = statusSymbol(r.status);
                    const type = r.type === 'epic' ? ' (epic)' : '';
                    console.log(`${sym} ${r.id}: ${r.title}${type}`);
                    console.log(`   target: ${r.target_version} | status: ${r.status}`);
                });
            }
        }
    });
    // task:patch - Apply SEARCH/REPLACE blocks to task
    task.command('patch <id>')
        .description('Apply SEARCH/REPLACE blocks to task (stdin or file)')
        .option('-f, --file <path>', 'Read patch from file instead of stdin')
        .option('--dry-run', 'Show what would be changed without applying')
        .option('--json', 'JSON output')
        .action(async (id, options) => {
        const normalizedId = normalizeId(id);
        const taskPath = findTaskFile(normalizedId);
        if (!taskPath) {
            console.error(`Task not found: ${id}`);
            process.exit(1);
        }
        // Read patch content
        let patchContent;
        if (options.file) {
            if (!fs.existsSync(options.file)) {
                console.error(`Patch file not found: ${options.file}`);
                process.exit(1);
            }
            patchContent = fs.readFileSync(options.file, 'utf8');
        }
        else {
            // Read from stdin
            patchContent = await readStdin();
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
                jsonOut({ id: normalizedId, ops, dry_run: true });
            }
            else {
                console.log(`Would apply ${ops.length} patch(es) to ${normalizedId}`);
            }
            return;
        }
        const result = editArtifact(taskPath, ops);
        if (options.json) {
            jsonOut({ id: normalizedId, ...result });
        }
        else if (result.success) {
            console.log(`✓ Applied ${result.applied} patch(es) to ${normalizedId}`);
        }
        else {
            console.error(`✗ Applied ${result.applied}/${ops.length}, errors:`);
            result.errors.forEach(e => console.error(`  - ${e}`));
            process.exit(1);
        }
    });
    // task:edit - Edit task sections
    task.command('edit <id>')
        .description('Edit task section(s)')
        .option('-s, --section <name>', 'Section to edit (omit for multi-section stdin)')
        .option('-c, --content <text>', 'New content (or use stdin)')
        .option('-a, --append', 'Append to section instead of replace')
        .option('-p, --prepend', 'Prepend to section instead of replace')
        .option('--json', 'JSON output')
        .addHelpText('after', `
Usage Examples:

  # Single section via --content
  rudder task:edit T001 -s "Description" -c "New description text"

  # Single section via stdin (heredoc)
  rudder task:edit T001 -s "Deliverables" <<'EOF'
  - [ ] Item 1
  - [ ] Item 2
  EOF

  # Single section via pipe
  echo "New content" | rudder task:edit T001 -s "Notes"

  # Multi-section edit (omit -s)
  rudder task:edit T001 <<'EOF'
  ## Description
  Full replacement...

  ## Deliverables [append]
  - [ ] New item

  ## Deliverables [check]
  First item
  EOF

Operations: [replace] (default), [append], [prepend], [delete], [create], [sed], [check], [uncheck], [toggle], [patch]
Note: Sections are auto-created if they don't exist (replace/append/prepend).
`)
        .action(async (id, options) => {
        const normalizedId = normalizeId(id);
        const taskPath = findTaskFile(normalizedId);
        if (!taskPath) {
            console.error(`Task not found: ${id}`);
            process.exit(1);
        }
        let content = options.content;
        if (!content) {
            content = (await readStdin()).trim();
        }
        if (!content) {
            console.error('Content required via --content or stdin');
            process.exit(1);
        }
        let opType = 'replace';
        if (options.append)
            opType = 'append';
        if (options.prepend)
            opType = 'prepend';
        const ops = options.section
            ? [{ op: opType, section: options.section, content }]
            : parseMultiSectionContent(content, opType);
        if (ops.length === 0) {
            console.error('No sections found. Use --section or format stdin with ## headers');
            process.exit(1);
        }
        const originalOps = ops.map(o => ({ op: o.op, section: o.section }));
        const { expandedOps, errors: processErrors } = processMultiSectionOps(taskPath, ops);
        if (processErrors.length > 0) {
            processErrors.forEach(e => console.error(e));
            process.exit(1);
        }
        const result = editArtifact(taskPath, expandedOps);
        if (options.json) {
            jsonOut({ id: normalizedId, ...result });
        }
        else if (result.success) {
            if (originalOps.length === 1) {
                console.log(`✓ ${originalOps[0].op} on ${originalOps[0].section} in ${normalizedId}`);
            }
            else {
                const byOp = {};
                originalOps.forEach(o => { byOp[o.op] = ((byOp[o.op]) || 0) + 1; });
                const summary = Object.entries(byOp).map(([op, n]) => `${op}:${n}`).join(', ');
                console.log(`✓ ${originalOps.length} sections in ${normalizedId} (${summary})`);
            }
        }
        else {
            console.error(`✗ Failed: ${result.errors.join(', ')}`);
            process.exit(1);
        }
    });
}
