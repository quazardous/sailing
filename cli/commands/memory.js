/**
 * Memory commands for rudder CLI
 *
 * Access control:
 * - skill/coordinator: full access (show, sync, edit, escalations)
 * - agent: blocked (memory is read-only, provided via context:load)
 */
import fs from 'fs';
import { jsonOut, findPrdDirs, findFiles } from '../lib/core.js';
import { normalizeId } from '../lib/normalize.js';
import { addDynamicHelp } from '../lib/help.js';
import {
  getMemoryDirPath,
  ensureMemoryDir,
  logFilePath,
  memoryFilePath,
  memoryFileExists,
  readLogFile,
  findLogFiles,
  findTaskEpic,
  parseLogLevels,
  createMemoryFile,
  mergeTaskLog,
  prdMemoryFilePath,
  prdMemoryExists,
  createPrdMemoryFile,
  projectMemoryFilePath,
  projectMemoryExists,
  getHierarchicalMemory,
  findEpicPrd
} from '../lib/memory.js';

/**
 * Check if role is allowed for memory write operations
 * Agents are blocked - they receive memory via context:load only
 */
function checkWriteAccess(role, commandName) {
  if (role === 'agent') {
    console.error(`ERROR: ${commandName} is not available to agents.`);
    console.error('Agents receive memory via context:load at task start.');
    console.error('Memory consolidation is performed by skill/coordinator only.');
    process.exit(1);
  }
}

/**
 * Register memory commands
 */
export function registerMemoryCommands(program) {
  const memory = program.command('memory').description('Memory operations (logs, consolidation)');

  addDynamicHelp(memory, { entityType: 'memory' });

  // memory:show <ID> - unified memory display (hierarchical: project → PRD → epic)
  memory.command('show <id>')
    .description('Show memory for any entity (hierarchical: project → PRD → epic)')
    .option('--full', 'Show full memory (all sections)')
    .option('--epic-only', 'Show only epic memory (skip PRD/project)')
    .option('--json', 'JSON output')
    .action((id, options) => {
      ensureMemoryDir();

      const normalized = normalizeId(id);

      // Get hierarchical memory
      const hierarchy = getHierarchicalMemory(normalized);

      if (!hierarchy.epic && !hierarchy.prd && !hierarchy.project) {
        if (options.json) {
          jsonOut({ id: normalized, exists: false, hierarchy: null });
        } else {
          console.log(`No memory for ${normalized}`);
        }
        return;
      }

      // Helper to extract Agent Context section
      const extractAgentContext = (content) => {
        const match = content.match(/## Agent Context\s*([\s\S]*?)(?=\n## |$)/);
        if (!match) return '';
        return match[1].replace(/<!--[\s\S]*?-->/g, '').trim();
      };

      // Helper to extract relevant sections from PRD memory
      const extractPrdContext = (content) => {
        const match = content.match(/## Cross-Epic Patterns\s*([\s\S]*?)(?=\n## |$)/);
        if (!match) return '';
        return match[1].replace(/<!--[\s\S]*?-->/g, '').trim();
      };

      // Helper to extract relevant sections from Project memory
      const extractProjectContext = (content) => {
        const sections = [];
        const archMatch = content.match(/## Architecture Decisions\s*([\s\S]*?)(?=\n## |$)/);
        const patternMatch = content.match(/## Patterns & Conventions\s*([\s\S]*?)(?=\n## |$)/);
        if (archMatch) {
          const cleaned = archMatch[1].replace(/<!--[\s\S]*?-->/g, '').trim();
          if (cleaned) sections.push(cleaned);
        }
        if (patternMatch) {
          const cleaned = patternMatch[1].replace(/<!--[\s\S]*?-->/g, '').trim();
          if (cleaned) sections.push(cleaned);
        }
        return sections.join('\n\n');
      };

      if (options.json) {
        const result = {
          id: normalized,
          exists: true,
          full: options.full || false
        };
        if (hierarchy.project) {
          result.project = {
            path: hierarchy.project.path,
            content: options.full ? hierarchy.project.content : extractProjectContext(hierarchy.project.content)
          };
        }
        if (hierarchy.prd) {
          result.prd = {
            id: hierarchy.prd.id,
            path: hierarchy.prd.path,
            content: options.full ? hierarchy.prd.content : extractPrdContext(hierarchy.prd.content)
          };
        }
        if (hierarchy.epic) {
          result.epic = {
            id: hierarchy.epic.id,
            path: hierarchy.epic.path,
            content: options.full ? hierarchy.epic.content : extractAgentContext(hierarchy.epic.content)
          };
        }
        jsonOut(result);
        return;
      }

      // Human-readable output with consistent format
      // Format matches memory:edit: ## ID:Section
      const sep = '─'.repeat(60);

      if (options.full) {
        // Show full content of all levels
        console.log(`# Memory: ${normalized}\n`);
        console.log(sep);

        if (hierarchy.project && !options.epicOnly) {
          console.log('\n## PROJECT:Architecture Decisions\n');
          const arch = hierarchy.project.content.match(/## Architecture Decisions\s*([\s\S]*?)(?=\n## |$)/);
          if (arch) console.log(arch[1].replace(/<!--[\s\S]*?-->/g, '').trim() || '(empty)');

          console.log('\n## PROJECT:Patterns & Conventions\n');
          const pat = hierarchy.project.content.match(/## Patterns & Conventions\s*([\s\S]*?)(?=\n## |$)/);
          if (pat) console.log(pat[1].replace(/<!--[\s\S]*?-->/g, '').trim() || '(empty)');

          console.log('\n' + sep);
        }

        if (hierarchy.prd && !options.epicOnly) {
          console.log(`\n## ${hierarchy.prd.id}:Cross-Epic Patterns\n`);
          const cross = hierarchy.prd.content.match(/## Cross-Epic Patterns\s*([\s\S]*?)(?=\n## |$)/);
          if (cross) console.log(cross[1].replace(/<!--[\s\S]*?-->/g, '').trim() || '(empty)');

          console.log('\n' + sep);
        }

        if (hierarchy.epic) {
          console.log(`\n## ${hierarchy.epic.id}:Agent Context\n`);
          const ctx = hierarchy.epic.content.match(/## Agent Context\s*([\s\S]*?)(?=\n## |$)/);
          if (ctx) console.log(ctx[1].replace(/<!--[\s\S]*?-->/g, '').trim() || '(empty)');

          console.log(`\n## ${hierarchy.epic.id}:Escalation\n`);
          const esc = hierarchy.epic.content.match(/## Escalation\s*([\s\S]*?)(?=\n## |$)/);
          if (esc) console.log(esc[1].replace(/<!--[\s\S]*?-->/g, '').trim() || '(empty)');

          console.log(`\n## ${hierarchy.epic.id}:Story\n`);
          const story = hierarchy.epic.content.match(/## Story\s*([\s\S]*?)(?=\n## |$)/);
          if (story) console.log(story[1].replace(/<!--[\s\S]*?-->/g, '').trim() || '(empty)');
        }
      } else {
        // Show Agent Context sections only (default)
        console.log(`# Memory: ${normalized}\n`);
        console.log(sep);

        if (hierarchy.project && !options.epicOnly) {
          const ctx = extractProjectContext(hierarchy.project.content);
          if (ctx) {
            console.log('\n## PROJECT:Architecture Decisions\n');
            console.log(ctx);
            console.log('\n' + sep);
          }
        }

        if (hierarchy.prd && !options.epicOnly) {
          const ctx = extractPrdContext(hierarchy.prd.content);
          if (ctx) {
            console.log(`\n## ${hierarchy.prd.id}:Cross-Epic Patterns\n`);
            console.log(ctx);
            console.log('\n' + sep);
          }
        }

        if (hierarchy.epic) {
          const ctx = extractAgentContext(hierarchy.epic.content);
          if (ctx) {
            console.log(`\n## ${hierarchy.epic.id}:Agent Context\n`);
            console.log(ctx);
          }
        }

        // Show hint if no content found
        if (!hierarchy.project && !hierarchy.prd && !hierarchy.epic) {
          console.log(`No agent context for ${normalized}`);
        }
      }
    });

  // memory:sync [ID] - merge task→epic logs, show content, create missing .md
  memory.command('sync')
    .description('Merge task→epic logs, show pending content (skill/coordinator only)')
    .argument('[id]', 'Epic (ENNN) or Task (TNNN) ID - filters to that epic')
    .option('--no-create', 'Do not create missing memory (.md) files')
    .option('--role <role>', 'Role context (skill, coordinator, agent)')
    .option('--json', 'JSON output')
    .action((id, options) => {
      // Block agents - they don't manage memory
      checkWriteAccess(options.role, 'memory:sync');
      ensureMemoryDir();

      // Resolve target epic if ID provided
      let targetEpicId = null;
      if (id) {
        const normalized = normalizeId(id);
        if (normalized.startsWith('E')) {
          targetEpicId = normalized;
        } else if (normalized.startsWith('T')) {
          const taskInfo = findTaskEpic(normalized);
          if (!taskInfo) {
            console.error(`Task ${normalized} not found or has no parent epic`);
            process.exit(1);
          }
          targetEpicId = taskInfo.epicId;
        } else {
          console.error(`Invalid ID: ${id} (expected ENNN or TNNN)`);
          process.exit(1);
        }
      }

      let deletedEmpty = 0;
      let mergedTasks = 0;
      let createdMd = 0;

      // Step 1: Merge all task logs into epic logs
      const taskLogs = findLogFiles().filter(f => f.type === 'task');

      for (const { id: taskId } of taskLogs) {
        // Skip if filtering by epic and this task belongs to different epic
        if (targetEpicId) {
          const taskInfo = findTaskEpic(taskId);
          if (!taskInfo || taskInfo.epicId !== targetEpicId) continue;
        }

        const result = mergeTaskLog(taskId);
        if (result.merged) mergedTasks++;
        if (result.deleted) deletedEmpty++;
      }

      // Step 2: Collect epic logs
      let epicLogFiles = findLogFiles().filter(f => f.type === 'epic');

      // Filter by target epic if specified
      if (targetEpicId) {
        epicLogFiles = epicLogFiles.filter(f => f.id === targetEpicId);
      }

      const epicLogs = [];

      for (const { id: epicId, path: logPath } of epicLogFiles) {
        const content = readLogFile(epicId);

        // Delete empty logs
        if (!content) {
          fs.unlinkSync(logPath);
          deletedEmpty++;
          continue;
        }

        const mdExists = memoryFileExists(epicId);

        // Create epic .md if missing (unless --no-create)
        if (!mdExists && options.create !== false) {
          createMemoryFile(epicId);
          createdMd++;
        }

        // Create PRD .md if missing (unless --no-create)
        const prdId = findEpicPrd(epicId);
        if (prdId && !prdMemoryExists(prdId) && options.create !== false) {
          createPrdMemoryFile(prdId);
          createdMd++;
        }

        const levels = parseLogLevels(content);
        const totalEntries = Object.values(levels).reduce((a, b) => a + b, 0);

        epicLogs.push({
          id: epicId,
          lines: content.split('\n').length,
          entries: totalEntries,
          levels,
          hasMd: mdExists || (options.create !== false),
          content
        });
      }

      // Step 3: Collect all memory files (epic, prd, project)
      const memDir = getMemoryDirPath();
      const allMemoryFiles = fs.existsSync(memDir)
        ? fs.readdirSync(memDir).filter(f => f.endsWith('.md'))
        : [];

      // Epic memory files
      const epicMemoryFiles = allMemoryFiles
        .filter(f => f.startsWith('E'))
        .map(f => {
          const epicId = f.replace('.md', '');
          const filePath = memoryFilePath(epicId);
          const content = fs.readFileSync(filePath, 'utf8');
          const prdId = findEpicPrd(epicId);
          return { id: epicId, path: filePath, prdId, content };
        });

      // Ensure PRD memory exists for each epic's PRD (unless --no-create)
      if (options.create !== false) {
        const prdIds = new Set(epicMemoryFiles.map(e => e.prdId).filter(Boolean));
        for (const prdId of prdIds) {
          if (!prdMemoryExists(prdId)) {
            createPrdMemoryFile(prdId);
            createdMd++;
          }
        }
      }

      // Re-read PRD memory files (may have been created above)
      const updatedMemoryFiles = fs.existsSync(memDir)
        ? fs.readdirSync(memDir).filter(f => f.endsWith('.md'))
        : [];

      // PRD memory files
      const prdMemoryFiles = updatedMemoryFiles
        .filter(f => f.startsWith('PRD-'))
        .map(f => {
          const prdId = f.replace('.md', '');
          const filePath = prdMemoryFilePath(prdId);
          const content = fs.readFileSync(filePath, 'utf8');
          return { id: prdId, path: filePath, content };
        });

      // Project memory file
      const projectMemoryFile = projectMemoryExists()
        ? {
            path: projectMemoryFilePath(),
            content: fs.readFileSync(projectMemoryFilePath(), 'utf8')
          }
        : null;

      // No pending logs
      const hasPendingLogs = epicLogs.length > 0;

      if (options.json) {
        jsonOut({
          pending: hasPendingLogs,
          mergedTasks,
          deletedEmpty,
          createdMd,
          logs: epicLogs.map(e => ({
            id: e.id,
            lines: e.lines,
            entries: e.entries,
            levels: e.levels,
            hasMd: e.hasMd,
            content: e.content
          })),
          memory: {
            epics: epicMemoryFiles.map(e => ({ id: e.id, prdId: e.prdId, path: e.path })),
            prds: prdMemoryFiles.map(p => ({ id: p.id, path: p.path })),
            project: projectMemoryFile ? { path: projectMemoryFile.path } : null
          }
        });
        return;
      }

      // Human-readable output
      if (mergedTasks > 0) console.log(`Merged: ${mergedTasks} task logs → epic logs`);
      if (deletedEmpty > 0) console.log(`Deleted: ${deletedEmpty} empty logs`);
      if (createdMd > 0) console.log(`Created: ${createdMd} memory files`);

      // Show pending logs if any
      if (hasPendingLogs) {
        console.log(`\n⚠ PENDING LOGS: ${epicLogs.length} epic(s)\n`);
        console.log('='.repeat(60) + '\n');

        for (const epic of epicLogs) {
          const mdStatus = epic.hasMd ? '✓' : '○ (no .md)';
          console.log(`## ${epic.id} ${mdStatus}`);
          console.log(`   ${epic.lines} lines, ${epic.entries} entries`);
          console.log(`   TIP=${epic.levels.TIP} INFO=${epic.levels.INFO} WARN=${epic.levels.WARN} ERROR=${epic.levels.ERROR} CRITICAL=${epic.levels.CRITICAL}\n`);
          console.log(epic.content);
          console.log('\n---\n');
        }

        console.log('='.repeat(60));
        console.log('\nMapping:');
        console.log('  [TIP]      → Agent Context');
        console.log('  [ERROR]    → Escalation');
        console.log('  [CRITICAL] → Escalation');
        console.log('  [INFO]     → Story');
        console.log('  [WARN]     → Story');

        console.log('\nAfter consolidation:');
        for (const epic of epicLogs) {
          console.log(`  rudder epic:clean-logs ${epic.id}`);
        }
      } else {
        console.log('✓ No pending logs');
      }

      // Show memory files and edit commands
      console.log('\n' + '='.repeat(60));
      console.log('\n# Memory Files\n');

      // Project level
      console.log('## Project');
      if (projectMemoryFile) {
        console.log('  ✓ PROJECT');
        console.log('    rudder memory:edit PROJECT --section "Architecture Decisions" <<\'EOF\'');
        console.log('    <content>');
        console.log('    EOF');
      } else {
        console.log('  ○ No project memory (run install.sh or devinstall.sh)');
      }

      // PRD level
      console.log('\n## PRD');
      if (prdMemoryFiles.length === 0) {
        console.log('  ○ No PRD memories');
      } else {
        for (const prd of prdMemoryFiles) {
          console.log(`  ✓ ${prd.id}`);
          console.log(`    rudder memory:edit ${prd.id} --section "Cross-Epic Patterns" <<'EOF'`);
          console.log('    <content>');
          console.log('    EOF');
        }
      }

      // Epic level
      console.log('\n## Epic');
      if (epicMemoryFiles.length === 0) {
        console.log('  ○ No epic memories');
      } else {
        for (const epic of epicMemoryFiles) {
          const prdRef = epic.prdId ? ` (${epic.prdId})` : '';
          console.log(`  ✓ ${epic.id}${prdRef}`);
          console.log(`    rudder memory:edit ${epic.id} --section "Agent Context" <<'EOF'`);
          console.log('    <content>');
          console.log('    EOF');
        }
      }

      // Commands guide
      console.log('\n' + '='.repeat(60));
      console.log('\n# Commands\n');
      console.log('## View memory (hierarchical)');
      console.log('');
      console.log('  rudder memory:show E001          # Agent context only');
      console.log('  rudder memory:show E001 --full   # All sections');
      console.log('');
      console.log('Output format: ## ID:Section (matches memory:edit)');

      // Consolidation guide (only when there are pending logs)
      if (hasPendingLogs) {
        console.log('\n## Consolidate logs (multi-section edit)');
        console.log('');
        console.log('  rudder memory:edit <<\'EOF\'');
        console.log('  ## E001:Agent Context [append]');
        console.log('  - Reformulated tip here');
        console.log('');
        console.log('  ## E001:Escalation [append]');
        console.log('  - Blocker or issue description');
        console.log('');
        console.log('  ## PRD-001:Cross-Epic Patterns');
        console.log('  - Pattern observed in multiple epics');
        console.log('');
        console.log('  ## PROJECT:Architecture Decisions');
        console.log('  - Decision and rationale');
        console.log('  EOF');
        console.log('');
        console.log('After consolidation:');
        for (const epic of epicLogs) {
          console.log(`  rudder epic:clean-logs ${epic.id}`);
        }
        console.log('');
        console.log('Mapping: [TIP]→Agent Context, [ERROR/CRITICAL]→Escalation');
        console.log('Escalation = Reformulation. Never copy-paste.');
      }
    });

  // memory:escalations - list memory files with escalation content
  memory.command('escalations')
    .description('List memory files with escalations')
    .option('--prd <id>', 'Filter by PRD (PRD-NNN)')
    .option('--epic <id>', 'Filter by epic (ENNN)')
    .option('--json', 'JSON output')
    .action((options) => {
      ensureMemoryDir();

      let files = fs.readdirSync(getMemoryDirPath()).filter(f => f.endsWith('.md') && f.startsWith('E'));

      // Filter by specific epic
      if (options.epic) {
        const epicId = normalizeId(options.epic);
        files = files.filter(f => f.replace('.md', '') === epicId);
      }

      // Filter by PRD - need to check which epics belong to this PRD
      if (options.prd) {
        const prdId = options.prd.toUpperCase();
        const prdEpics = new Set();

        for (const prdDir of findPrdDirs()) {
          if (prdDir.includes(prdId)) {
            const epicsDir = prdDir + '/epics';
            const epicFiles = findFiles(epicsDir, /^E\d+.*\.md$/);
            for (const ef of epicFiles) {
              const match = ef.match(/E\d+/);
              if (match) prdEpics.add(normalizeId(match[0]));
            }
          }
        }

        files = files.filter(f => prdEpics.has(f.replace('.md', '')));
      }
      const results = [];

      for (const file of files) {
        const epicId = file.replace('.md', '');
        const content = fs.readFileSync(memoryFilePath(epicId), 'utf8');

        // Extract Escalation section (between ## Escalation and next ## heading)
        const match = content.match(/## Escalation\s*\n([\s\S]*?)(?=\n## [A-Z])/);
        if (match) {
          const section = match[1].trim();
          // Remove HTML comments
          const cleaned = section.replace(/<!--[\s\S]*?-->/g, '').trim();
          // Get non-empty lines
          const lines = cleaned.split('\n').filter(l => l.trim()).join('\n');

          if (lines) {
            results.push({ id: epicId, escalations: lines });
          }
        }
      }

      if (options.json) {
        jsonOut(results);
        return;
      }

      if (results.length === 0) {
        console.log('✓ No escalations');
        return;
      }

      console.log(`⚠ ${results.length} epic(s) with escalations\n`);
      for (const { id, escalations } of results) {
        console.log(`## ${id}`);
        console.log(escalations);
        console.log('');
      }
    });

  // Helper: get memory file path for ID
  function getMemoryPath(id) {
    if (id.startsWith('E')) {
      return memoryFilePath(id);
    } else if (id.startsWith('PRD-')) {
      return prdMemoryFilePath(id);
    } else if (id === 'PROJECT') {
      return projectMemoryFilePath();
    }
    return null;
  }

  // Helper: edit a single section in a memory file
  function editMemorySection(memoryId, section, content, operation) {
    const filePath = getMemoryPath(memoryId);
    if (!filePath) {
      return { error: `Invalid memory ID: ${memoryId}` };
    }
    if (!fs.existsSync(filePath)) {
      return { error: `Memory file not found for ${memoryId}` };
    }

    const fileContent = fs.readFileSync(filePath, 'utf8');
    const sectionHeader = `## ${section}`;
    const sectionRegex = new RegExp(`(${sectionHeader}\\s*\\n)([\\s\\S]*?)(?=\\n## [A-Z]|$)`, 'i');
    const match = fileContent.match(sectionRegex);

    if (!match) {
      return { error: `Section "${section}" not found in ${memoryId}` };
    }

    const existingContent = match[2].replace(/<!--[\s\S]*?-->/g, '').trim();
    let newSectionContent;

    if (operation === 'append') {
      newSectionContent = existingContent ? `${existingContent}\n${content}` : content;
    } else if (operation === 'prepend') {
      newSectionContent = existingContent ? `${content}\n${existingContent}` : content;
    } else {
      newSectionContent = content;
    }

    const updatedContent = fileContent.replace(match[0], `${match[1]}${newSectionContent}\n\n`);
    fs.writeFileSync(filePath, updatedContent);

    return { success: true, id: memoryId, section, operation };
  }

  // memory:edit [ID] - edit memory section(s)
  memory.command('edit [id]')
    .description('Edit memory section(s) (skill/coordinator only)')
    .option('-s, --section <name>', 'Section to edit (single-ID mode)')
    .option('-c, --content <text>', 'New content (or use stdin)')
    .option('-a, --append', 'Append to section instead of replace')
    .option('-p, --prepend', 'Prepend to section instead of replace')
    .option('--role <role>', 'Role context (skill, coordinator, agent)')
    .option('--json', 'JSON output')
    .action((id, options) => {
      // Block agents from editing memory
      checkWriteAccess(options.role, 'memory:edit');
      ensureMemoryDir();

      // Get content from stdin or option
      let inputContent = options.content;
      if (!inputContent && !process.stdin.isTTY) {
        inputContent = fs.readFileSync(0, 'utf8').trim();
      }

      if (!inputContent) {
        console.error('No content provided. Use --content or pipe via stdin.');
        process.exit(1);
      }

      // === MULTI-SECTION MODE (no ID provided) ===
      // Format: ## ID:Section [operation]
      if (!id) {
        const headerRegex = /^## ([A-Z0-9-]+):(.+?)(?:\s*\[(append|prepend|replace)\])?\s*$/gm;
        const sections = [];
        let lastIndex = 0;
        let match;

        // Find all section headers
        const matches = [];
        while ((match = headerRegex.exec(inputContent)) !== null) {
          matches.push({
            fullMatch: match[0],
            id: match[1].toUpperCase(),
            section: match[2].trim(),
            operation: match[3] || 'replace',
            index: match.index
          });
        }

        if (matches.length === 0) {
          console.error('No sections found. Use format: ## ID:Section [operation]');
          console.error('Examples:');
          console.error('  ## E001:Agent Context');
          console.error('  ## E001:Escalation [append]');
          console.error('  ## PRD-001:Cross-Epic Patterns');
          console.error('  ## PROJECT:Architecture Decisions');
          process.exit(1);
        }

        // Extract content for each section
        for (let i = 0; i < matches.length; i++) {
          const current = matches[i];
          const nextIndex = matches[i + 1]?.index ?? inputContent.length;
          const headerEnd = current.index + current.fullMatch.length;
          const content = inputContent.slice(headerEnd, nextIndex).trim();

          sections.push({
            id: current.id === 'PROJECT' ? 'PROJECT' : normalizeId(current.id),
            section: current.section,
            operation: current.operation,
            content
          });
        }

        // Apply all edits
        const results = [];
        for (const sec of sections) {
          const result = editMemorySection(sec.id, sec.section, sec.content, sec.operation);
          results.push({ ...sec, ...result });
        }

        // Output
        const errors = results.filter(r => r.error);
        const successes = results.filter(r => r.success);

        if (options.json) {
          jsonOut({ edited: successes.length, errors: errors.length, results });
          return;
        }

        if (successes.length > 0) {
          console.log(`✓ ${successes.length} section(s) edited:`);
          for (const r of successes) {
            console.log(`  ${r.id}:${r.section} (${r.operation})`);
          }
        }
        if (errors.length > 0) {
          console.error(`\n✗ ${errors.length} error(s):`);
          for (const r of errors) {
            console.error(`  ${r.id}:${r.section} - ${r.error}`);
          }
          process.exit(1);
        }
        return;
      }

      // === SINGLE-ID MODE ===
      const normalized = id.toUpperCase() === 'PROJECT' ? 'PROJECT' : normalizeId(id);

      if (!options.section) {
        console.error('Section required. Use --section "Agent Context" or similar.');
        console.error('Or use multi-section mode: rudder memory:edit <<EOF');
        process.exit(1);
      }

      const operation = options.append ? 'append' : options.prepend ? 'prepend' : 'replace';
      const result = editMemorySection(normalized, options.section, inputContent, operation);

      if (result.error) {
        console.error(result.error);
        process.exit(1);
      }

      if (options.json) {
        jsonOut(result);
      } else {
        console.log(`✓ ${options.section} ${operation === 'replace' ? 'replaced' : operation + 'ed'} in ${normalized}`);
      }
    });

}
