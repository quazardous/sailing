/**
 * Artifact commands for rudder CLI
 * Provides section-based editing for PRD, Epic, and Task files.
 */
import fs from 'fs';
import path from 'path';
import { jsonOut, stripComments } from '../managers/core-manager.js';
import { addDynamicHelp, withModifies } from '../lib/help.js';
import {
  parseMarkdownSections,
  serializeSections,
  parseSearchReplace,
  applySearchReplace,
  editArtifact,
  listSections,
  getSection,
  parseMultiSectionContent,
  applySedCommands,
  parseCheckboxItems
} from '../lib/artifact.js';
import { getTask, getEpic, getPrd } from '../managers/artefacts-manager.js';
import type { Command } from 'commander';

// ============================================================================
// Types
// ============================================================================

interface ArtifactInfo {
  path: string;
  type: 'task' | 'epic' | 'prd';
}

interface SectionOp {
  op: string;
  section: string;
  content?: string;
  sedCommands?: string[];
  item?: string;
}

interface OriginalOp {
  op: string;
  section: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Resolve artifact ID to file path
 */
function resolveArtifact(id: string): ArtifactInfo | null {
  const normalized = id.toUpperCase();

  if (normalized.startsWith('T')) {
    const file = getTask(normalized)?.file;
    return file ? { path: file, type: 'task' } : null;
  }

  if (normalized.startsWith('E')) {
    const file = getEpic(normalized)?.file;
    return file ? { path: file, type: 'epic' } : null;
  }

  if (normalized.startsWith('PRD-')) {
    const file = getPrd(normalized)?.file;
    return file ? { path: file, type: 'prd' } : null;
  }

  return null;
}

/**
 * Read content from stdin
 * @returns {Promise<string>}
 */
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');

    // Check if stdin has data (piped or heredoc)
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }

    process.stdin.on('readable', () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk;
      }
    });

    process.stdin.on('end', () => {
      resolve(data);
    });

    process.stdin.on('error', reject);
  });
}

// ============================================================================
// Command Registration
// ============================================================================

/**
 * Register artifact commands
 */
export function registerArtifactCommands(program: Command): void {
  const artifact = program.command('artifact')
    .description('Edit PRD/Epic/Task markdown artifacts');

  addDynamicHelp(artifact, { entityType: 'artifact' });

  // artifact:show - Show artifact content or specific section
  artifact.command('show <id>')
    .description('Show artifact content or specific section')
    .option('-s, --section <name>', 'Show only this section')
    .option('-l, --list', 'List section names only')
    .option('--comments', 'Include template comments (stripped by default)')
    .option('--json', 'JSON output')
    .action((id: string, options: {
      section?: string;
      list?: boolean;
      comments?: boolean;
      json?: boolean;
    }) => {
      const resolved = resolveArtifact(id);
      if (!resolved) {
        console.error(`Artifact not found: ${id}`);
        process.exit(1);
      }

      if (options.list) {
        const sections = listSections(resolved.path);
        if (options.json) {
          jsonOut({ id, type: resolved.type, sections });
        } else {
          console.log(`Sections in ${id}:\n`);
          sections.forEach(s => console.log(`  ## ${s}`));
        }
        return;
      }

      if (options.section) {
        const content = getSection(resolved.path, options.section);
        if (content === null) {
          console.error(`Section not found: ${options.section}`);
          process.exit(1);
        }
        if (options.json) {
          jsonOut({ id, section: options.section, content });
        } else {
          console.log(content);
        }
        return;
      }

      // Show full content (without frontmatter)
      let raw = fs.readFileSync(resolved.path, 'utf8');
      if (!options.comments) {
        raw = stripComments(raw);
      }
      const parsed = parseMarkdownSections(raw);

      if (options.json) {
        const sectionsObj: Record<string, string> = {};
        for (const [k, v] of parsed.sections) {
          sectionsObj[k] = v;
        }
        jsonOut({ id, type: resolved.type, sections: sectionsObj, order: parsed.order });
      } else {
        // Print without frontmatter
        console.log(serializeSections({ ...parsed, frontmatter: '' }));
      }
    });

  // artifact:edit - Edit a section (or multiple sections via stdin)
  withModifies(artifact.command('edit <id>'), ['task'])
    .description('Edit section(s) in an artifact')
    .option('-s, --section <name>', 'Section to edit (omit for multi-section stdin)')
    .option('-c, --content <text>', 'New content (or use stdin)')
    .option('-a, --append', 'Append to section instead of replace')
    .option('-p, --prepend', 'Prepend to section instead of replace')
    .option('--json', 'JSON output')
    .addHelpText('after', `
Multi-Section Format (omit --section):
  Use ## headers to edit multiple sections at once.
  Add [op] after section name to specify operation.

Operations:
  [replace]   Replace section content (default)
  [append]    Add content at end of section
  [prepend]   Add content at start of section
  [delete]    Remove section entirely
  [sed]       Search/replace with regex: s/pattern/replacement/g
  [check]     Check checkbox items (partial match)
  [uncheck]   Uncheck checkbox items
  [toggle]    Toggle checkbox state
  [patch]     Apply SEARCH/REPLACE blocks (Aider-style)

Examples:
  # Single section
  bin/rudder artifact:edit T001 --section "Deliverables" <<'EOF'
  - [ ] New item
  EOF

  # Multiple sections with mixed operations
  bin/rudder artifact:edit T001 <<'EOF'
  ## Description
  Full replacement content...

  ## Deliverables [append]
  - [ ] New item at end

  ## Deliverables [sed]
  s/v1\\.0/v2.0/g
  s/old text/new text/

  ## Deliverables [check]
  First item
  Second item

  ## Notes [patch]
  <<<<<<< SEARCH
  old content
  =======
  new content
  >>>>>>> REPLACE
  EOF
`)
    .action(async (id: string, options: {
      section?: string;
      content?: string;
      append?: boolean;
      prepend?: boolean;
      json?: boolean;
    }) => {
      const resolved = resolveArtifact(id);
      if (!resolved) {
        console.error(`Artifact not found: ${id}`);
        process.exit(1);
      }

      // Get content from option or stdin
      let content = options.content;
      if (!content) {
        content = await readStdin();
        content = content.trim();
      }

      if (!content) {
        console.error('Content required via --content or stdin');
        process.exit(1);
      }

      // Determine operation
      let opType = 'replace';
      if (options.append) opType = 'append';
      if (options.prepend) opType = 'prepend';

      let ops;

      if (options.section) {
        // Single section mode
        ops = [{
          op: opType,
          section: options.section,
          content
        }];
      } else {
        // Multi-section mode: parse ## headers from stdin
        ops = parseMultiSectionContent(content, opType);
        if (ops.length === 0) {
          console.error('No sections found. Use --section or format stdin with ## headers');
          process.exit(1);
        }
      }

      // Track original ops for output (before transformation)
      const originalOps: OriginalOp[] = (ops as SectionOp[]).map((o: SectionOp) => ({ op: o.op, section: o.section }));

      // Process special operations: sed, check, uncheck, toggle, patch
      const expandedOps: SectionOp[] = [];
      for (const op of ops as SectionOp[]) {
        if (op.op === 'sed' && op.sedCommands && op.sedCommands.length > 0) {
          // Get current section content and apply sed commands
          const sectionContent: string | null = getSection(resolved.path, op.section);
          if (sectionContent === null) {
            console.error(`Section not found for sed: ${op.section}`);
            process.exit(1);
          }
          expandedOps.push({
            op: 'replace',
            section: op.section,
            content: applySedCommands(sectionContent, op.sedCommands)
          });
        } else if (op.op === 'patch') {
          // Parse SEARCH/REPLACE blocks and apply to section
          const patches = parseSearchReplace(op.content || '');
          if (patches.length === 0) {
            console.error(`No SEARCH/REPLACE blocks found for patch: ${op.section}`);
            process.exit(1);
          }
          let sectionContent: string | null = getSection(resolved.path, op.section);
          if (sectionContent === null) {
            console.error(`Section not found for patch: ${op.section}`);
            process.exit(1);
          }
          for (const patch of patches) {
            const result = applySearchReplace(sectionContent, patch.search, patch.replace);
            if (!result.success) {
              console.error(`Patch failed on ${op.section}: ${result.error}`);
              process.exit(1);
            }
            sectionContent = result.content ?? '';
          }
          expandedOps.push({
            op: 'replace',
            section: op.section,
            content: sectionContent
          });
        } else if (['check', 'uncheck', 'toggle'].includes(op.op)) {
          // Create individual checkbox ops for each item
          for (const item of parseCheckboxItems(op.content || '')) {
            expandedOps.push({
              op: op.op,
              section: op.section,
              item
            });
          }
        } else {
          expandedOps.push(op);
        }
      }
      ops = expandedOps;

      const result = editArtifact(resolved.path, ops);

      if (options.json) {
        jsonOut({ id, ...result });
      } else if (result.success) {
        if (originalOps.length === 1) {
          console.log(`✓ ${originalOps[0].op} on ${originalOps[0].section} in ${id}`);
        } else {
          // Group by operation type for cleaner output
          const byOp = {};
          originalOps.forEach(o => {
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

  // artifact:check - Check a deliverable checkbox
  withModifies(artifact.command('check <id> <item>'), ['task'])
    .description('Check a deliverable checkbox')
    .option('-s, --section <name>', 'Section containing checkbox (default: Deliverables)')
    .option('--json', 'JSON output')
    .action((id: string, item: string, options: { section?: string; json?: boolean }) => {
      const resolved = resolveArtifact(id);
      if (!resolved) {
        console.error(`Artifact not found: ${id}`);
        process.exit(1);
      }

      const section = options.section || 'Deliverables';
      const ops = [{ op: 'check', section, item }];
      const result = editArtifact(resolved.path, ops);

      if (options.json) {
        jsonOut({ id, item, checked: result.success, ...result });
      } else if (result.success) {
        console.log(`✓ Checked: ${item}`);
      } else {
        console.error(`✗ Failed: ${result.errors.join(', ')}`);
        process.exit(1);
      }
    });

  // artifact:uncheck - Uncheck a deliverable checkbox
  withModifies(artifact.command('uncheck <id> <item>'), ['task'])
    .description('Uncheck a deliverable checkbox')
    .option('-s, --section <name>', 'Section containing checkbox (default: Deliverables)')
    .option('--json', 'JSON output')
    .action((id: string, item: string, options: { section?: string; json?: boolean }) => {
      const resolved = resolveArtifact(id);
      if (!resolved) {
        console.error(`Artifact not found: ${id}`);
        process.exit(1);
      }

      const section = options.section || 'Deliverables';
      const ops = [{ op: 'uncheck', section, item }];
      const result = editArtifact(resolved.path, ops);

      if (options.json) {
        jsonOut({ id, item, unchecked: result.success, ...result });
      } else if (result.success) {
        console.log(`✓ Unchecked: ${item}`);
      } else {
        console.error(`✗ Failed: ${result.errors.join(', ')}`);
        process.exit(1);
      }
    });

  // artifact:patch - Apply SEARCH/REPLACE blocks (Aider-style)
  withModifies(artifact.command('patch <id>'), ['task'])
    .description('Apply SEARCH/REPLACE blocks to artifact (stdin or file)')
    .option('-f, --file <path>', 'Read patch from file instead of stdin')
    .option('--dry-run', 'Show what would be changed without applying')
    .option('--json', 'JSON output')
    .action(async (id: string, options: {
      file?: string;
      dryRun?: boolean;
      json?: boolean;
    }) => {
      const resolved = resolveArtifact(id);
      if (!resolved) {
        console.error(`Artifact not found: ${id}`);
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
      } else {
        patchContent = await readStdin();
      }

      if (!patchContent.trim()) {
        console.error('No patch content provided');
        process.exit(1);
      }

      // Parse SEARCH/REPLACE blocks
      const ops = parseSearchReplace(patchContent);

      if (ops.length === 0) {
        console.error('No valid SEARCH/REPLACE blocks found');
        console.error('Expected format:');
        console.error('<<<<<<< SEARCH');
        console.error('old content');
        console.error('=======');
        console.error('new content');
        console.error('>>>>>>> REPLACE');
        process.exit(1);
      }

      if (options.dryRun) {
        if (options.json) {
          jsonOut({ id, ops, dry_run: true });
        } else {
          console.log(`Would apply ${ops.length} patch(es) to ${id}:\n`);
          ops.forEach((op, i) => {
            console.log(`--- Patch ${i + 1} ---`);
            console.log('SEARCH:');
            console.log(op.search);
            console.log('REPLACE:');
            console.log(op.replace);
            console.log('');
          });
        }
        return;
      }

      const result = editArtifact(resolved.path, ops);

      if (options.json) {
        jsonOut({ id, ...result });
      } else if (result.success) {
        console.log(`✓ Applied ${result.applied} patch(es) to ${id}`);
      } else {
        console.error(`✗ Applied ${result.applied}/${ops.length}, errors:`);
        result.errors.forEach(e => console.error(`  - ${e}`));
        process.exit(1);
      }
    });

  // artifact:ops - Apply JSON ops array
  withModifies(artifact.command('ops <id>'), ['task'])
    .description('Apply JSON operations array to artifact')
    .option('-f, --file <path>', 'Read ops from file instead of stdin')
    .option('--json', 'JSON output')
    .action(async (id: string, options: { file?: string; json?: boolean }) => {
      const resolved = resolveArtifact(id);
      if (!resolved) {
        console.error(`Artifact not found: ${id}`);
        process.exit(1);
      }

      // Read ops
      let opsContent;
      if (options.file) {
        if (!fs.existsSync(options.file)) {
          console.error(`Ops file not found: ${options.file}`);
          process.exit(1);
        }
        opsContent = fs.readFileSync(options.file, 'utf8');
      } else {
        opsContent = await readStdin();
      }

      let ops;
      try {
        ops = JSON.parse(opsContent);
        if (!Array.isArray(ops)) {
          ops = [ops]; // Allow single op
        }
      } catch (e) {
        console.error(`Invalid JSON: ${e.message}`);
        process.exit(1);
      }

      const result = editArtifact(resolved.path, ops);

      if (options.json) {
        jsonOut({ id, ...result });
      } else if (result.success) {
        console.log(`✓ Applied ${result.applied} op(s) to ${id}`);
      } else {
        console.error(`✗ Applied ${result.applied}/${ops.length}, errors:`);
        result.errors.forEach(e => console.error(`  - ${e}`));
        process.exit(1);
      }
    });
}
