/**
 * Task show commands
 */
import fs from 'fs';
import { loadFile, jsonOut, stripComments } from '../../managers/core-manager.js';
import { normalizeId } from '../../lib/normalize.js';
import { getHierarchicalMemory, ensureMemoryDir } from '../../managers/memory-manager.js';
import { isStatusDone } from '../../lib/lexicon.js';
import { buildDependencyGraph, blockersResolved } from '../../managers/graph-manager.js';
import { findTaskFile, findEpicParent } from './helpers.js';
import type { Command } from 'commander';
import type {
  TaskShowAgentResult,
  TaskShowFullResult,
  TaskShowOptions,
  TaskShowMemoryOptions
} from '../../lib/types/task-options.js';

/**
 * Register task:show and task:show-memory commands
 */
export function registerShowCommands(task: Command): void {
  // task:show
  task.command('show <id>')
    .description('Show task details (blockers, dependents, ready status)')
    .option('--role <role>', 'Role context: agent (minimal), skill/coordinator (full)')
    .option('--raw', 'Dump raw markdown')
    .option('--strip-comments', 'Strip template comments from output')
    .option('--path', 'Include file path (discouraged)')
    .option('--json', 'JSON output')
    .action((id: string, options: TaskShowOptions) => {
      const taskFile = findTaskFile(id);
      if (!taskFile) {
        console.error(`Task not found: ${id}`);
        process.exit(1);
      }

      // Raw mode: dump file content
      if (options.raw) {
        if (options.path) console.log(`# File: ${taskFile}\n`);
        const content = fs.readFileSync(taskFile, 'utf8');
        console.log(options.stripComments ? stripComments(content) : content);
        return;
      }

      const file = loadFile(taskFile);
      const fileData = file?.data as Record<string, unknown> | undefined;
      const isAgentRole = options.role === 'agent';

      // Agent role: minimal output (just what's needed to execute)
      if (isAgentRole) {
        const result: TaskShowAgentResult = {
          id: (fileData?.id as string) || '',
          title: (fileData?.title as string) || '',
          status: (fileData?.status as string) || '',
          parent: (fileData?.parent as string) || ''
        };
        if (options.path) result.file = taskFile;

        if (options.json) {
          jsonOut(result);
        } else {
          console.log(`# ${result.id}: ${result.title}\n`);
          console.log(`Status: ${result.status}`);
          console.log(`Parent: ${result.parent || '-'}`);
          console.log(`\n→ Use task:show-memory ${result.id} for Agent Context`);
          if (options.path) {
            console.log(`→ Use Read tool on ${taskFile} for full deliverables`);
          } else {
            console.log(`→ Use task:show ${result.id} --raw for full deliverables`);
          }
        }
        return;
      }

      // Full output for skill/coordinator
      const { tasks, blocks } = buildDependencyGraph();
      const normalizedId = normalizeId(id);
      const graphTask = tasks.get(normalizedId);

      const dependents = blocks.get(normalizedId) || [];
      const isReady = graphTask ? blockersResolved(graphTask, tasks) : false;

      const result: TaskShowFullResult = {
        ...fileData,
        blockers: graphTask?.blockedBy || [],
        dependents,
        ready: isReady && !isStatusDone((fileData?.status as string) || '')
      };
      if (options.path) result.file = taskFile;

      if (options.json) {
        jsonOut(result);
      } else {
        console.log(`# ${fileData?.id}: ${fileData?.title}\n`);
        console.log(`Status: ${fileData?.status}`);
        console.log(`Assignee: ${(fileData?.assignee as string) || 'unassigned'}`);
        console.log(`Effort: ${(fileData?.effort as string) || '-'}`);
        console.log(`Priority: ${(fileData?.priority as string) || 'normal'}`);
        console.log(`Parent: ${(fileData?.parent as string) || '-'}`);

        if (graphTask?.blockedBy?.length > 0) {
          console.log(`\nBlocked by: ${graphTask.blockedBy.join(', ')}`);
        }
        if (dependents.length > 0) {
          console.log(`Blocks: ${dependents.join(', ')}`);
        }
        if (result.ready) {
          console.log('\n✓ Ready to start');
        }
        if (options.path) console.log(`\nFile: ${taskFile}`);
      }
    });

  /**
   * task:show-memory - Agent-focused memory view
   *
   * WHY THIS EXISTS (vs memory:show):
   * - memory:show is the general-purpose command for skill/coordinator
   * - task:show-memory is specialized for agents executing tasks
   *
   * WHAT IT INCLUDES:
   * 1. Hierarchical memory (epic → PRD → project)
   *    - Tips, learnings, patterns from previous work
   * 2. Epic Technical Notes (from epic file itself)
   *    - Stack recommendations, integration approach, constraints
   * 3. Task dependency context
   *    - Resolved blockers, related tasks info
   *
   * This gives agents everything they need without reading epic/PRD files directly
   * (which would violate the "agents don't read planning docs" principle).
   */
  task.command('show-memory <id>')
    .description('Show agent-focused memory context for a task')
    .option('--json', 'JSON output')
    .action((id: string, options: TaskShowMemoryOptions) => {
      const taskFile = findTaskFile(id);
      if (!taskFile) {
        console.error(`Task not found: ${id}`);
        process.exit(1);
      }

      const file = loadFile(taskFile);
      const taskId = file.data.id as string;
      const epicParent = findEpicParent(taskFile);

      ensureMemoryDir();

      // Collect context
      const context: Record<string, unknown> = {
        taskId,
        epicId: epicParent?.prdId || null,
        memory: null,
        technicalNotes: null,
        dependencies: null
      };

      // 1. Hierarchical memory (epic → PRD → project)
      if (epicParent) {
        const epicFileData = loadFile(epicParent.epicFile);
        if (epicFileData) {
          const hierarchy = getHierarchicalMemory(epicFileData.data.id);
          const memoryParts: Array<{ level: string; name: string; content: string }> = [];

          // Extract agent-relevant sections
          const extractSections = (content: string | undefined, level: string): Array<{ level: string; name: string; content: string }> => {
            if (!content) return [];
            const sections: Array<{ level: string; name: string; content: string }> = [];
            const regex = /^## ([^\n]+)\n([\s\S]*?)(?=\n## [A-Z]|$)/gm;
            let match: RegExpExecArray | null;
            while ((match = regex.exec(content)) !== null) {
              const name = match[1].trim();
              const body = match[2].replace(/<!--[\s\S]*?-->/g, '').trim();
              if (body) sections.push({ level, name, content: body });
            }
            return sections;
          };

          if (hierarchy.project) {
            memoryParts.push(...extractSections(hierarchy.project.content, 'PROJECT'));
          }
          if (hierarchy.prd) {
            memoryParts.push(...extractSections(hierarchy.prd.content, 'PRD'));
          }
          if (hierarchy.epic) {
            memoryParts.push(...extractSections(hierarchy.epic.content, 'EPIC'));
          }

          context.memory = memoryParts;

          // 2. Epic Technical Notes (from epic file, not memory)
          const epicContent = epicFileData.body || '';
          const techNotesMatch = epicContent.match(/## Technical Notes\n([\s\S]*?)(?=\n## |$)/);
          if (techNotesMatch) {
            context.technicalNotes = techNotesMatch[1].replace(/<!--[\s\S]*?-->/g, '').trim();
          }
        }
      }

      // 3. Task dependencies (resolved blockers)
      const { tasks } = buildDependencyGraph();
      const taskData = tasks.get(normalizeId(id));
      if (taskData?.blockedBy?.length) {
        context.dependencies = {
          blockedBy: taskData.blockedBy,
          allResolved: taskData.blockedBy.every(dep => {
            const depTask = tasks.get(dep);
            return depTask && isStatusDone(depTask.status);
          })
        };
      }

      // Output
      if (options.json) {
        jsonOut(context);
        return;
      }

      // Human-readable
      const sep = '─'.repeat(60);
      console.log(`# Agent Context: ${taskId}\n`);

      if (context.epicId) {
        console.log(`Epic: ${context.epicId}`);
      }

      // Technical Notes (most actionable for implementation)
      if (context.technicalNotes) {
        console.log(`\n${sep}`);
        console.log(`## Technical Notes (from ${context.epicId})\n`);
        console.log(context.technicalNotes);
      }

      // Memory sections
      const memoryArray = context.memory as Array<{ level: string; name: string; content: string }> | null;
      if (memoryArray && memoryArray.length) {
        console.log(`\n${sep}`);
        console.log('## Memory (tips & learnings)\n');
        for (const sec of memoryArray) {
          console.log(`### [${sec.level}] ${sec.name}\n`);
          console.log(sec.content);
          console.log('');
        }
      }

      // Dependencies
      const deps = context.dependencies as { blockedBy: string[]; allResolved: boolean } | null;
      if (deps) {
        console.log(`\n${sep}`);
        console.log('## Dependencies\n');
        console.log(`Blocked by: ${deps.blockedBy.join(', ')}`);
        console.log(`All resolved: ${deps.allResolved ? '✓' : '✗'}`);
      }

      if (!memoryArray?.length && !context.technicalNotes && !deps) {
        console.log('(No memory or context available for this task)');
      }
    });
}
