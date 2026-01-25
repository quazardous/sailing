/**
 * Story modification commands (patch, edit)
 */
import fs from 'fs';
import { jsonOut } from '../../managers/core-manager.js';
import { normalizeId } from '../../lib/normalize.js';
import { parseSearchReplace, editArtifact, parseMultiSectionContent, processMultiSectionOps } from '../../lib/artifact.js';
import { findStoryFile } from './helpers.js';
/**
 * Register story modification commands
 */
export function registerModifyCommands(story) {
    // story:patch - Apply SEARCH/REPLACE blocks to story
    story.command('patch <id>')
        .description('Apply SEARCH/REPLACE blocks to story (stdin or file)')
        .option('-f, --file <path>', 'Read patch from file instead of stdin')
        .option('--dry-run', 'Show what would be changed without applying')
        .option('--json', 'JSON output')
        .action(async (id, options) => {
        const result = findStoryFile(id);
        if (!result) {
            console.error(`Story not found: ${id}`);
            process.exit(1);
        }
        const storyPath = result.file;
        let patchContent;
        if (options.file) {
            if (!fs.existsSync(options.file)) {
                console.error(`Patch file not found: ${options.file}`);
                process.exit(1);
            }
            patchContent = fs.readFileSync(options.file, 'utf8');
        }
        else {
            patchContent = await new Promise((resolve) => {
                let data = '';
                if (process.stdin.isTTY) {
                    resolve('');
                    return;
                }
                process.stdin.setEncoding('utf8');
                process.stdin.on('readable', () => {
                    let chunk = process.stdin.read();
                    while (chunk !== null) {
                        data += chunk.toString();
                        chunk = process.stdin.read();
                    }
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
                jsonOut({ id, ops, dry_run: true });
            }
            else {
                console.log(`Would apply ${ops.length} patch(es) to ${id}`);
            }
            return;
        }
        const editResult = editArtifact(storyPath, ops);
        if (options.json) {
            jsonOut({ id, ...editResult });
        }
        else if (editResult.success) {
            console.log(`✓ Applied ${editResult.applied} patch(es) to ${id}`);
        }
        else {
            console.error(`✗ Applied ${editResult.applied}/${ops.length}, errors:`);
            editResult.errors.forEach(e => console.error(`  - ${e}`));
            process.exit(1);
        }
    });
    // story:edit - Edit story sections
    story.command('edit <id>')
        .description('Edit story section(s)')
        .option('-s, --section <name>', 'Section to edit (omit for multi-section stdin)')
        .option('-c, --content <text>', 'New content (or use stdin)')
        .option('-a, --append', 'Append to section instead of replace')
        .option('-p, --prepend', 'Prepend to section instead of replace')
        .option('--json', 'JSON output')
        .addHelpText('after', `
Usage Examples:

  # Single section via --content
  rudder story:edit S001 -s "Description" -c "New description text"

  # Single section via stdin (heredoc)
  rudder story:edit S001 -s "Acceptance Criteria" <<'EOF'
  - [ ] Criteria 1
  - [ ] Criteria 2
  EOF

  # Single section via pipe
  echo "New content" | rudder story:edit S001 -s "Notes"

  # Multi-section edit (omit -s)
  rudder story:edit S001 <<'EOF'
  ## Description
  Full replacement...

  ## Acceptance Criteria [append]
  - [ ] New criterion

  ## Tasks [check]
  T001
  EOF

Operations: [replace] (default), [append], [prepend], [delete], [create], [sed], [check], [uncheck], [toggle], [patch]
Note: Sections are auto-created if they don't exist (replace/append/prepend).
`)
        .action(async (id, options) => {
        const result = findStoryFile(id);
        if (!result) {
            console.error(`Story not found: ${id}`);
            process.exit(1);
        }
        const storyPath = result.file;
        let content = options.content;
        if (!content) {
            content = await new Promise((resolve) => {
                let data = '';
                if (process.stdin.isTTY) {
                    resolve('');
                    return;
                }
                process.stdin.setEncoding('utf8');
                process.stdin.on('readable', () => {
                    let chunk = process.stdin.read();
                    while (chunk !== null) {
                        data += chunk.toString();
                        chunk = process.stdin.read();
                    }
                });
                process.stdin.on('end', () => resolve(data));
            });
            content = content.trim();
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
        const { expandedOps, errors: processErrors } = processMultiSectionOps(storyPath, ops);
        if (processErrors.length > 0) {
            processErrors.forEach(e => console.error(e));
            process.exit(1);
        }
        const editResult = editArtifact(storyPath, expandedOps);
        if (options.json) {
            jsonOut({ id: normalizeId(id), ...editResult });
        }
        else if (editResult.success) {
            if (originalOps.length === 1) {
                console.log(`✓ ${originalOps[0].op} on ${originalOps[0].section} in ${normalizeId(id)}`);
            }
            else {
                const byOp = {};
                originalOps.forEach(o => { byOp[o.op] = (byOp[o.op] || 0) + 1; });
                const summary = Object.entries(byOp).map(([op, n]) => `${op}:${n}`).join(', ');
                console.log(`✓ ${originalOps.length} sections in ${normalizeId(id)} (${summary})`);
            }
        }
        else {
            console.error(`✗ Failed: ${editResult.errors.join(', ')}`);
            process.exit(1);
        }
    });
}
