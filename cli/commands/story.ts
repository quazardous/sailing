/**
 * Story commands for rudder CLI
 */
import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { findPrdDirs, loadFile, saveFile, toKebab, loadTemplate, jsonOut, stripComments } from '../managers/core-manager.js';
import { normalizeId, matchesPrdDir } from '../lib/normalize.js';
import { getAllEpics, getAllTasks, getEpic, getTask, getStory, getAllStories as getStoriesFromIndex, getPrd } from '../managers/artefacts-manager.js';
import { nextId } from '../managers/state-manager.js';
import { addDynamicHelp } from '../lib/help.js';
import { formatId } from '../managers/core-manager.js';
import { parseSearchReplace, editArtifact, parseMultiSectionContent, processMultiSectionOps } from '../lib/artifact.js';
import { Story } from '../lib/types/entities.js';

const STORY_TYPES = ['user', 'technical', 'api'];

interface StoryListOptions {
  type?: string;
  limit?: number;
  prd?: string;
  path?: boolean;
  json?: boolean;
}

interface StoryShowOptions {
  raw?: boolean;
  stripComments?: boolean;
  path?: boolean;
  json?: boolean;
}

interface StoryCreateOptions {
  type: string;
  parentStory?: string;
  path?: boolean;
  json?: boolean;
}

interface StoryUpdateOptions {
  type?: string;
  parentStory?: string;
  clearParent?: boolean;
  title?: string;
  set?: string[];
  json?: boolean;
}

interface StoryTreeOptions {
  prd?: string;
}

interface StoryRootsOptions {
  prd?: string;
  path?: boolean;
  json?: boolean;
}

interface StoryLeavesOptions {
  prd?: string;
  path?: boolean;
  json?: boolean;
}

interface StoryChildrenOptions {
  json?: boolean;
}

interface StoryAncestorsOptions {
  json?: boolean;
}

interface StoryOrphansOptions {
  prd?: string;
  path?: boolean;
  json?: boolean;
}

interface StoryValidateOptions {
  prd?: string;
  json?: boolean;
}

interface StoryBookOptions {
  prd?: string;
  epic?: string;
  task?: string;
  json?: boolean;
}

interface StoryPatchOptions {
  file?: string;
  dryRun?: boolean;
  json?: boolean;
}

interface StoryEditOptions {
  section?: string;
  content?: string;
  append?: boolean;
  prepend?: boolean;
  json?: boolean;
}

interface StoryReference {
  [key: string]: string[];
}

interface StoryReferences {
  epics: StoryReference;
  tasks: StoryReference;
}

/**
 * Find a story file by ID (uses artefacts.ts contract)
 */
function findStoryFile(storyId) {
  const storyEntry = getStory(storyId);
  if (!storyEntry) return null;
  return { file: storyEntry.file, prdDir: storyEntry.prdDir };
}

/**
 * Get all stories across all PRDs (uses artefacts.ts contract)
 * @param prdFilter - Optional PRD filter
 * @param includePath - Include file paths in result (default: false for privacy)
 */
function getAllStories(prdFilter = null, includePath = false): (Story & { prd: string; file?: string })[] {
  // Get stories from artefacts index, optionally filter by PRD
  let storyEntries = getStoriesFromIndex();

  if (prdFilter) {
    const prd = getPrd(prdFilter);
    if (prd) {
      storyEntries = storyEntries.filter(s => s.prdDir === prd.dir);
    } else {
      // Fallback: filter by prdDir path containing prdFilter
      storyEntries = storyEntries.filter(s => matchesPrdDir(s.prdDir, prdFilter));
    }
  }

  return storyEntries.map(entry => {
    const prdName = path.basename(entry.prdDir);
    const storyEntry: Story & { prd: string; file?: string } = {
      id: entry.data?.id || entry.id,
      title: entry.data?.title || '',
      status: entry.data?.status || 'Draft',
      type: entry.data?.type || 'user',
      parent: entry.data?.parent || '',
      parent_story: entry.data?.parent_story || null,
      prd: prdName
    };
    if (includePath) storyEntry.file = entry.file;
    return storyEntry;
  });
}

/**
 * Get all epics and tasks with their story references
 */
function getStoryReferences(): StoryReferences {
  const refs: StoryReferences = { epics: {}, tasks: {} };

  // Use artefacts.ts contract for epics
  for (const epicEntry of getAllEpics()) {
    const data = epicEntry.data;
    if (!data) continue;
    const stories = data.stories || [];
    stories.forEach(s => {
      const sid = normalizeId(s);
      if (!refs.epics[sid]) refs.epics[sid] = [];
      refs.epics[sid].push(data.id);
    });
  }

  // Use artefacts.ts contract for tasks
  for (const taskEntry of getAllTasks()) {
    const data = taskEntry.data;
    if (!data) continue;
    const stories = data.stories || [];
    stories.forEach(s => {
      const sid = normalizeId(s);
      if (!refs.tasks[sid]) refs.tasks[sid] = [];
      refs.tasks[sid].push(data.id);
    });
  }

  return refs;
}

/**
 * Build story tree structure
 */
function buildStoryTree(stories: (Story & { prd: string; file?: string })[]) {
  const byId = new Map<string, Story & { prd: string; file?: string }>();
  const roots: (Story & { prd: string; file?: string })[] = [];
  const children = new Map<string, (Story & { prd: string; file?: string })[]>();

  // Index by ID
  stories.forEach(s => {
    byId.set(normalizeId(s.id), s);
    children.set(normalizeId(s.id), []);
  });

  // Build parent-child relationships
  stories.forEach(s => {
    if (s.parent_story) {
      const parentId = normalizeId(s.parent_story);
      if (children.has(parentId)) {
        children.get(parentId).push(s);
      }
    } else {
      roots.push(s);
    }
  });

  return { byId, roots, children };
}

/**
 * Register story commands
 */
export function registerStoryCommands(program: Command) {
  const story = program.command('story').description('Story operations (narrative context for features)');

  addDynamicHelp(story, { entityType: 'story' });

  // story:list
  story.command('list [prd]')
    .description('List stories (filter by PRD, type)')
    .option('-t, --type <type>', `Filter by type (${STORY_TYPES.join(', ')})`)
    .option('-l, --limit <n>', 'Limit results', parseInt)
    .option('--prd <id>', 'Filter by PRD (alias for positional arg)')
    .option('--path', 'Include file path (discouraged)')
    .option('--json', 'JSON output')
    .action((prdArg: string | undefined, options: StoryListOptions) => {
      const prd = prdArg || options.prd;
      let stories = getAllStories(prd, options.path);

      // Type filter
      if (options.type) {
        stories = stories.filter(s => s.type === options.type);
      }

      // Sort by ID
      stories.sort((a, b) => {
        const numA = parseInt(a.id?.match(/\d+/)?.[0] || '0');
        const numB = parseInt(b.id?.match(/\d+/)?.[0] || '0');
        return numA - numB;
      });

      // Apply limit
      const limited = options.limit ? stories.slice(0, options.limit) : stories;

      if (options.json) {
        jsonOut(limited);
      } else {
        if (limited.length === 0) {
          console.log('No stories found.');
        } else {
          limited.forEach(s => {
            const typeIcon = s.type === 'user' ? '👤' : s.type === 'technical' ? '⚙️' : '🔌';
            const parentInfo = s.parent_story ? ` ← ${s.parent_story}` : '';
            console.log(`${typeIcon} ${s.id}: ${s.title} [${s.type}]${parentInfo}`);
          });
          if (options.limit && stories.length > options.limit) {
            console.log(`\n... and ${stories.length - options.limit} more`);
          }
        }
      }
    });

  // story:show
  story.command('show <id>')
    .description('Show story details (children, references)')
    .option('--raw', 'Dump raw markdown')
    .option('--strip-comments', 'Strip template comments from output')
    .option('--path', 'Include file path (discouraged)')
    .option('--json', 'JSON output')
    .action((id: string, options: StoryShowOptions) => {
      const result = findStoryFile(id);
      if (!result) {
        console.error(`Story not found: ${id}`);
        process.exit(1);
      }

      // Raw mode: dump file content
      if (options.raw) {
        if (options.path) console.log(`# File: ${result.file}\n`);
        const content = fs.readFileSync(result.file, 'utf8');
        console.log(options.stripComments ? stripComments(content) : content);
        return;
      }

      const file = loadFile(result.file);
      const storyId = normalizeId(id);
      const refs = getStoryReferences();
      const stories = getAllStories();
      const { children } = buildStoryTree(stories);

      const childrenList: (Story & { prd: string; file?: string })[] = children.get(storyId) || [];
      const epicRefs: string[] = refs.epics[storyId] || [];
      const taskRefs: string[] = refs.tasks[storyId] || [];

      const output: Record<string, unknown> = {
        ...file.data,
        prd: path.basename(result.prdDir),
        children: childrenList.map(c => c.id),
        referencedByEpics: epicRefs,
        referencedByTasks: taskRefs,
        hasTaskReference: taskRefs.length > 0
      };
      if (options.path) output.file = result.file;

      if (options.json) {
        jsonOut(output);
      } else {
        const typeIcon = file.data.type === 'user' ? '👤' : file.data.type === 'technical' ? '⚙️' : '🔌';
        console.log(`# ${typeIcon} ${file.data.id}: ${file.data.title}\n`);
        console.log(`Type: ${file.data.type || 'user'}`);
        console.log(`PRD: ${path.basename(result.prdDir)}`);
        if (file.data.parent_story) {
          console.log(`Parent Story: ${file.data.parent_story}`);
        }

        if (childrenList.length > 0) {
          console.log(`\nChildren: ${childrenList.map(c => c.id).join(', ')}`);
        }

        if (epicRefs.length > 0) {
          console.log(`\nReferenced by Epics: ${epicRefs.join(', ')}`);
        }
        if (taskRefs.length > 0) {
          console.log(`Referenced by Tasks: ${taskRefs.join(', ')}`);
        } else {
          console.log(`\n⚠️  No task references (orphan story)`);
        }

        if (options.path) console.log(`\nFile: ${result.file}`);
      }
    });

  // story:create
  story.command('create <prd> <title>')
    .description('Create story in PRD')
    .option('-t, --type <type>', `Story type (${STORY_TYPES.join('|')})`, 'user')
    .option('--parent-story <id>', 'Parent story ID')
    .option('--path', 'Show file path')
    .option('--json', 'JSON output')
    .action((prd: string, title: string, options: StoryCreateOptions) => {
      if (!STORY_TYPES.includes(options.type)) {
        console.error(`Invalid type: ${options.type}. Use: ${STORY_TYPES.join(', ')}`);
        process.exit(1);
      }

      const prdDir = findPrdDirs().find(d => matchesPrdDir(d, prd));
      if (!prdDir) {
        console.error(`PRD not found: ${prd}`);
        process.exit(1);
      }

      const storiesDir = path.join(prdDir, 'stories');
      if (!fs.existsSync(storiesDir)) {
        fs.mkdirSync(storiesDir, { recursive: true });
      }

      const num = nextId('story');
      const id = formatId('S', num);
      const filename = `${id}-${toKebab(title)}.md`;
      const storyPath = path.join(storiesDir, filename);

      const data: Story = {
        id,
        title,
        status: 'Draft',
        parent: path.basename(prdDir).split('-').slice(0, 2).join('-'),
        parent_story: options.parentStory ? normalizeId(options.parentStory) : null,
        type: options.type as 'user' | 'technical' | 'api'
      };

      // Load template or use minimal body
      let body = loadTemplate('story');
      if (body) {
        body = body.replace(/^---[\s\S]*?---\s*/, '');
        body = body.replace(/# S0000: Story Title/g, `# ${id}: ${title}`);
      } else {
        body = `\n# ${id}: ${title}\n\n## Story\n\n[Define the story]\n\n## Acceptance Criteria\n\n- [ ] Given X, when Y, then Z\n\n## Context\n\n**Where**: \n**Why**: \n**Constraints**: \n`;
      }

      saveFile(storyPath, data, body);

      if (options.json) {
        const output: Record<string, unknown> = { id, title, parent: data.parent, type: data.type };
        if (options.path) output.file = storyPath;
        jsonOut(output);
      } else {
        console.log(`Created: ${id} - ${title} (${data.type})`);
        if (options.path) console.log(`File: ${storyPath}`);
        console.log(`\n${'─'.repeat(60)}\n`);
        console.log(fs.readFileSync(storyPath, 'utf8'));
      }
    });

  // story:update
  story.command('update <id>')
    .description('Update story (type, parent-story)')
    .option('-t, --type <type>', `Set type (${STORY_TYPES.join('|')})`)
    .option('--parent-story <id>', 'Set parent story')
    .option('--clear-parent', 'Remove parent story')
    .option('--title <title>', 'Set title')
    .option('--set <key=value>', 'Set any frontmatter field (repeatable)', (v, arr) => arr.concat(v), [])
    .option('--json', 'JSON output')
    .action((id: string, options: StoryUpdateOptions) => {
      const result = findStoryFile(id);
      if (!result) {
        console.error(`Story not found: ${id}`);
        process.exit(1);
      }

      const file = loadFile(result.file);
      let updated = false;

      if (options.type) {
        if (!STORY_TYPES.includes(options.type)) {
          console.error(`Invalid type: ${options.type}. Use: ${STORY_TYPES.join(', ')}`);
          process.exit(1);
        }
        file.data.type = options.type as 'user' | 'technical' | 'api';
        updated = true;
      }

      if (options.parentStory) {
        file.data.parent_story = normalizeId(options.parentStory);
        updated = true;
      }

      if (options.clearParent) {
        file.data.parent_story = null;
        updated = true;
      }

      if (options.title) {
        file.data.title = options.title;
        updated = true;
      }

      // Handle --set for arbitrary fields
      if (options.set?.length) {
        options.set.forEach(kv => {
          const [key, ...valueParts] = kv.split('=');
          let value: string | number | boolean | null = valueParts.join('=');

          // Parse value types
          if (value === 'null') value = null;
          else if (value === 'true') value = true;
          else if (value === 'false') value = false;
          else if (/^\d+$/.test(value)) value = parseInt(value);

          (file.data as Record<string, unknown>)[key] = value;
          updated = true;
        });
      }

      if (updated) {
        saveFile(result.file, file.data, file.body);
        if (options.json) {
          jsonOut(file.data);
        } else {
          console.log(`Updated: ${file.data.id}`);
        }
      } else {
        console.log('No changes made.');
      }
    });

  // story:tree
  story.command('tree [prd]')
    .description('Show story tree structure')
    .option('--prd <id>', 'Filter by PRD')
    .action((prdArg: string | undefined, options: StoryTreeOptions) => {
      const prd = prdArg || options.prd;
      const stories = getAllStories(prd);
      const { roots, children } = buildStoryTree(stories);

      if (roots.length === 0) {
        console.log('No stories found.');
        return;
      }

      function printTree(story: Story & { prd: string; file?: string }, indent = '') {
        const typeIcon = story.type === 'user' ? '👤' : story.type === 'technical' ? '⚙️' : '🔌';
        console.log(`${indent}${typeIcon} ${story.id}: ${story.title}`);
        const childList: (Story & { prd: string; file?: string })[] = children.get(normalizeId(story.id)) || [];
        childList.forEach((child, i) => {
          const isLast = i === childList.length - 1;
          const prefix = isLast ? '└── ' : '├── ';
          printTree(child, indent + prefix.slice(0, -4));
        });
      }

      roots.forEach(r => printTree(r));
    });

  // story:roots
  story.command('roots [prd]')
    .description('List root stories (no parent)')
    .option('--prd <id>', 'Filter by PRD')
    .option('--path', 'Include file path (discouraged)')
    .option('--json', 'JSON output')
    .action((prdArg: string | undefined, options: StoryRootsOptions) => {
      const prd = prdArg || options.prd;
      const stories = getAllStories(prd, options.path);
      const roots = stories.filter(s => !s.parent_story);

      if (options.json) {
        jsonOut(roots);
      } else {
        if (roots.length === 0) {
          console.log('No root stories found.');
        } else {
          roots.forEach(s => {
            const typeIcon = s.type === 'user' ? '👤' : s.type === 'technical' ? '⚙️' : '🔌';
            console.log(`${typeIcon} ${s.id}: ${s.title}`);
          });
        }
      }
    });

  // story:leaves
  story.command('leaves [prd]')
    .description('List leaf stories (no children)')
    .option('--prd <id>', 'Filter by PRD')
    .option('--path', 'Include file path (discouraged)')
    .option('--json', 'JSON output')
    .action((prdArg: string | undefined, options: StoryLeavesOptions) => {
      const prd = prdArg || options.prd;
      const stories = getAllStories(prd, options.path);
      const { children } = buildStoryTree(stories);

      const leaves = stories.filter(s => {
        const childList: (Story & { prd: string; file?: string })[] = children.get(normalizeId(s.id)) || [];
        return childList.length === 0;
      });

      if (options.json) {
        jsonOut(leaves);
      } else {
        if (leaves.length === 0) {
          console.log('No leaf stories found.');
        } else {
          leaves.forEach(s => {
            const typeIcon = s.type === 'user' ? '👤' : s.type === 'technical' ? '⚙️' : '🔌';
            console.log(`${typeIcon} ${s.id}: ${s.title}`);
          });
        }
      }
    });

  // story:children
  story.command('children <id>')
    .description('List direct children of a story')
    .option('--json', 'JSON output')
    .action((id: string, options: StoryChildrenOptions) => {
      const stories = getAllStories();
      const { children } = buildStoryTree(stories);
      const storyId = normalizeId(id);

      const childList: (Story & { prd: string; file?: string })[] = children.get(storyId) || [];

      if (options.json) {
        jsonOut(childList);
      } else {
        if (childList.length === 0) {
          console.log(`No children for ${id}`);
        } else {
          childList.forEach(s => {
            const typeIcon = s.type === 'user' ? '👤' : s.type === 'technical' ? '⚙️' : '🔌';
            console.log(`${typeIcon} ${s.id}: ${s.title}`);
          });
        }
      }
    });

  // story:ancestors
  story.command('ancestors <id>')
    .description('Show path from story to root')
    .option('--json', 'JSON output')
    .action((id: string, options: StoryAncestorsOptions) => {
      const stories = getAllStories();
      const { byId } = buildStoryTree(stories);
      const storyId = normalizeId(id);

      const ancestors: (Story & { prd: string; file?: string })[] = [];
      let current: (Story & { prd: string; file?: string }) | undefined = byId.get(storyId);

      while (current) {
        ancestors.push(current);
        if (current.parent_story) {
          current = byId.get(normalizeId(current.parent_story));
        } else {
          current = undefined;
        }
      }

      if (options.json) {
        jsonOut(ancestors);
      } else {
        if (ancestors.length === 0) {
          console.log(`Story not found: ${id}`);
        } else {
          ancestors.reverse().forEach((s, i) => {
            const indent = '  '.repeat(i);
            const typeIcon = s.type === 'user' ? '👤' : s.type === 'technical' ? '⚙️' : '🔌';
            console.log(`${indent}${typeIcon} ${s.id}: ${s.title}`);
          });
        }
      }
    });

  // story:orphans (no task reference)
  story.command('orphans [prd]')
    .description('List orphan stories (not referenced by any task)')
    .option('--prd <id>', 'Filter by PRD')
    .option('--path', 'Include file path (discouraged)')
    .option('--json', 'JSON output')
    .action((prdArg: string | undefined, options: StoryOrphansOptions) => {
      const prd = prdArg || options.prd;
      const stories = getAllStories(prd, options.path);
      const refs = getStoryReferences();

      const orphans = stories.filter(s => {
        const storyId = normalizeId(s.id);
        const taskRefs: string[] = refs.tasks[storyId] || [];
        return taskRefs.length === 0;
      });

      if (options.json) {
        jsonOut(orphans);
      } else {
        if (orphans.length === 0) {
          console.log('✓ No orphan stories');
        } else {
          console.log(`⚠️  ${orphans.length} orphan stories (not referenced by any task):\n`);
          orphans.forEach(s => {
            const typeIcon = s.type === 'user' ? '👤' : s.type === 'technical' ? '⚙️' : '🔌';
            console.log(`${typeIcon} ${s.id}: ${s.title}`);
          });
        }
      }
    });

  // story:unlinked (alias for orphans)
  story.command('unlinked [prd]')
    .description('List stories without task references (alias for orphans)')
    .option('--prd <id>', 'Filter by PRD')
    .option('--path', 'Include file path (discouraged)')
    .option('--json', 'JSON output')
    .action((prdArg: string | undefined, options: StoryOrphansOptions) => {
      // Same as orphans
      const prd = prdArg || options.prd;
      const stories = getAllStories(prd, options.path);
      const refs = getStoryReferences();

      const unlinked = stories.filter(s => {
        const storyId = normalizeId(s.id);
        return (refs.tasks[storyId] || []).length === 0;
      });

      if (options.json) {
        jsonOut(unlinked);
      } else {
        if (unlinked.length === 0) {
          console.log('✓ All stories are linked to tasks');
        } else {
          console.log(`⚠️  ${unlinked.length} unlinked stories:\n`);
          unlinked.forEach(s => {
            console.log(`  ${s.id}: ${s.title}`);
          });
        }
      }
    });

  // story:validate
  story.command('validate [prd]')
    .description('Validate stories (check for orphans)')
    .option('--prd <id>', 'Filter by PRD')
    .option('--json', 'JSON output')
    .action((prdArg: string | undefined, options: StoryValidateOptions) => {
      const prd = prdArg || options.prd;
      const stories = getAllStories(prd);
      const refs = getStoryReferences();

      const issues: Array<{ type: string; story: string; message: string }> = [];

      // Check for orphan stories
      stories.forEach(s => {
        const storyId = normalizeId(s.id);
        const taskRefs: string[] = refs.tasks[storyId] || [];
        if (taskRefs.length === 0) {
          issues.push({
            type: 'orphan',
            story: s.id,
            message: `Story ${s.id} has no task references`
          });
        }
      });

      // Check for invalid parent_story references
      const storyIds = new Set(stories.map(s => normalizeId(s.id)));
      stories.forEach(s => {
        if (s.parent_story && !storyIds.has(normalizeId(s.parent_story))) {
          issues.push({
            type: 'invalid_parent',
            story: s.id,
            message: `Story ${s.id} references non-existent parent_story: ${s.parent_story}`
          });
        }
      });

      if (options.json) {
        jsonOut({ valid: issues.length === 0, issues, storyCount: stories.length });
      } else {
        if (issues.length === 0) {
          console.log(`✓ All ${stories.length} stories are valid`);
        } else {
          console.log(`✗ ${issues.length} issue(s) found:\n`);
          issues.forEach(i => {
            const icon = i.type === 'orphan' ? '⚠️' : '❌';
            console.log(`${icon} ${i.message}`);
          });
          process.exit(1);
        }
      }
    });

  // story:book (dump stories)
  story.command('book [prd]')
    .description('Dump all stories (storybook)')
    .option('--prd <id>', 'Filter by PRD')
    .option('--epic <id>', 'Show stories referenced by epic')
    .option('--task <id>', 'Show stories referenced by task')
    .option('--json', 'JSON output')
    .action((prdArg: string | undefined, options: StoryBookOptions) => {
      let stories: Array<{ id: string; title: string; type?: string; file?: string; prd?: string }> = [];

      if (options.epic) {
        // Find epic and get its stories (artefacts.ts contract)
        const epicEntry = getEpic(options.epic);
        if (epicEntry?.data?.stories) {
          epicEntry.data.stories.forEach(sid => {
            const storyResult = findStoryFile(sid);
            if (storyResult) {
              const storyFile = loadFile(storyResult.file);
              stories.push({
                id: storyFile.data.id as string,
                title: storyFile.data.title as string,
                type: storyFile.data.type as string,
                file: storyResult.file
              });
            }
          });
        }
      } else if (options.task) {
        // Find task and get its stories (artefacts.ts contract)
        const taskEntry = getTask(options.task);
        if (taskEntry?.data?.stories) {
          taskEntry.data.stories.forEach(sid => {
            const storyResult = findStoryFile(sid);
            if (storyResult) {
              const storyFile = loadFile(storyResult.file);
              stories.push({
                id: storyFile.data.id as string,
                title: storyFile.data.title as string,
                type: storyFile.data.type as string,
                file: storyResult.file
              });
            }
          });
        }
      } else {
        // All stories for PRD
        const prd = prdArg || options.prd;
        stories = getAllStories(prd);
      }

      if (options.json) {
        jsonOut(stories);
      } else {
        if (stories.length === 0) {
          console.log('No stories found.');
        } else {
          console.log(`# Storybook (${stories.length} stories)\n`);
          stories.forEach(s => {
            const typeIcon = s.type === 'user' ? '👤' : s.type === 'technical' ? '⚙️' : '🔌';
            console.log(`${typeIcon} ${s.id}: ${s.title}`);
          });
        }
      }
    });

  // story:patch - Apply SEARCH/REPLACE blocks to story
  story.command('patch <id>')
    .description('Apply SEARCH/REPLACE blocks to story (stdin or file)')
    .option('-f, --file <path>', 'Read patch from file instead of stdin')
    .option('--dry-run', 'Show what would be changed without applying')
    .option('--json', 'JSON output')
    .action(async (id: string, options: StoryPatchOptions) => {
      const result = findStoryFile(id);

      if (!result) {
        console.error(`Story not found: ${id}`);
        process.exit(1);
      }

      const storyPath = result.file;

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
            let chunk: Buffer | string | null = process.stdin.read() as Buffer | string | null;
            while (chunk !== null) {
              data += chunk.toString();
              chunk = process.stdin.read() as Buffer | string | null;
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
        } else {
          console.log(`Would apply ${ops.length} patch(es) to ${id}`);
        }
        return;
      }

      const editResult = editArtifact(storyPath, ops);

      if (options.json) {
        jsonOut({ id, ...editResult });
      } else if (editResult.success) {
        console.log(`✓ Applied ${editResult.applied} patch(es) to ${id}`);
      } else {
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
    .action(async (id: string, options: StoryEditOptions) => {
      const result = findStoryFile(id);
      if (!result) {
        console.error(`Story not found: ${id}`);
        process.exit(1);
      }

      const storyPath = result.file;

      let content = options.content;
      if (!content) {
        content = await new Promise<string>((resolve) => {
          let data = '';
          if (process.stdin.isTTY) { resolve(''); return; }
          process.stdin.setEncoding('utf8');
          process.stdin.on('readable', () => {
            let chunk: Buffer | string | null = process.stdin.read() as Buffer | string | null;
            while (chunk !== null) {
              data += chunk.toString();
              chunk = process.stdin.read() as Buffer | string | null;
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
      if (options.append) opType = 'append';
      if (options.prepend) opType = 'prepend';

      const ops = options.section
        ? [{ op: opType, section: options.section, content }]
        : parseMultiSectionContent(content, opType);

      if (ops.length === 0) {
        console.error('No sections found. Use --section or format stdin with ## headers');
        process.exit(1);
      }

      const originalOps: Array<{ op: string; section: string }> = ops.map(o => ({ op: o.op, section: o.section }));
      const { expandedOps, errors: processErrors } = processMultiSectionOps(storyPath, ops);
      if (processErrors.length > 0) {
        processErrors.forEach(e => console.error(e));
        process.exit(1);
      }

      const editResult = editArtifact(storyPath, expandedOps);

      if (options.json) {
        jsonOut({ id: normalizeId(id), ...editResult });
      } else if (editResult.success) {
        if (originalOps.length === 1) {
          console.log(`✓ ${originalOps[0].op} on ${originalOps[0].section} in ${normalizeId(id)}`);
        } else {
          const byOp: Record<string, number> = {};
          originalOps.forEach(o => { byOp[o.op] = (byOp[o.op] || 0) + 1; });
          const summary = Object.entries(byOp).map(([op, n]) => `${op}:${n}`).join(', ');
          console.log(`✓ ${originalOps.length} sections in ${normalizeId(id)} (${summary})`);
        }
      } else {
        console.error(`✗ Failed: ${editResult.errors.join(', ')}`);
        process.exit(1);
      }
    });
}
