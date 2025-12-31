/**
 * Story commands for rudder CLI
 */
import fs from 'fs';
import path from 'path';
import { findPrdDirs, findFiles, loadFile, saveFile, toKebab, loadTemplate, jsonOut } from '../lib/core.js';
import { normalizeId, matchesId, matchesPrdDir } from '../lib/normalize.js';
import { nextId } from '../lib/state.js';
import { addDynamicHelp } from '../lib/help.js';
import { formatId } from '../lib/config.js';

const STORY_TYPES = ['user', 'technical', 'api'];

/**
 * Find a story file by ID
 */
function findStoryFile(storyId) {
  const normalizedId = normalizeId(storyId);
  for (const prdDir of findPrdDirs()) {
    const storiesDir = path.join(prdDir, 'stories');
    const files = findFiles(storiesDir, /^S\d+.*\.md$/);
    for (const f of files) {
      if (matchesId(f, storyId)) return { file: f, prdDir };
    }
  }
  return null;
}

/**
 * Get all stories across all PRDs
 */
function getAllStories(prdFilter = null) {
  const stories = [];
  for (const prdDir of findPrdDirs()) {
    if (prdFilter && !matchesPrdDir(prdDir, prdFilter)) continue;

    const prdName = path.basename(prdDir);
    const storiesDir = path.join(prdDir, 'stories');

    findFiles(storiesDir, /^S\d+.*\.md$/).forEach(f => {
      const file = loadFile(f);
      if (!file?.data) return;

      stories.push({
        id: file.data.id || path.basename(f, '.md').match(/^S\d+/)?.[0],
        title: file.data.title || '',
        type: file.data.type || 'user',
        parent: file.data.parent || '',
        parent_story: file.data.parent_story || null,
        prd: prdName,
        file: f
      });
    });
  }
  return stories;
}

/**
 * Get all epics and tasks with their story references
 */
function getStoryReferences() {
  const refs = { epics: {}, tasks: {} };

  for (const prdDir of findPrdDirs()) {
    // Epics
    findFiles(path.join(prdDir, 'epics'), /^E\d+.*\.md$/).forEach(f => {
      const file = loadFile(f);
      if (!file?.data) return;
      const stories = file.data.stories || [];
      stories.forEach(s => {
        const sid = normalizeId(s);
        if (!refs.epics[sid]) refs.epics[sid] = [];
        refs.epics[sid].push(file.data.id);
      });
    });

    // Tasks
    findFiles(path.join(prdDir, 'tasks'), /^T\d+.*\.md$/).forEach(f => {
      const file = loadFile(f);
      if (!file?.data) return;
      const stories = file.data.stories || [];
      stories.forEach(s => {
        const sid = normalizeId(s);
        if (!refs.tasks[sid]) refs.tasks[sid] = [];
        refs.tasks[sid].push(file.data.id);
      });
    });
  }

  return refs;
}

/**
 * Build story tree structure
 */
function buildStoryTree(stories) {
  const byId = new Map();
  const roots = [];
  const children = new Map();

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
export function registerStoryCommands(program) {
  const story = program.command('story').description('Story operations (narrative context for features)');

  addDynamicHelp(story, { entityType: 'story' });

  // story:list
  story.command('list [prd]')
    .description('List stories (filter by PRD, type)')
    .option('-t, --type <type>', `Filter by type (${STORY_TYPES.join(', ')})`)
    .option('-l, --limit <n>', 'Limit results', parseInt)
    .option('--prd <id>', 'Filter by PRD (alias for positional arg)')
    .option('--json', 'JSON output')
    .action((prdArg, options) => {
      const prd = prdArg || options.prd;
      let stories = getAllStories(prd);

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
    .option('--raw', 'Dump raw markdown file')
    .option('--json', 'JSON output')
    .action((id, options) => {
      const result = findStoryFile(id);
      if (!result) {
        console.error(`Story not found: ${id}`);
        process.exit(1);
      }

      // Raw mode: dump file content with path header
      if (options.raw) {
        console.log(`# File: ${result.file}\n`);
        console.log(fs.readFileSync(result.file, 'utf8'));
        return;
      }

      const file = loadFile(result.file);
      const storyId = normalizeId(id);
      const refs = getStoryReferences();
      const stories = getAllStories();
      const { children } = buildStoryTree(stories);

      const childrenList = children.get(storyId) || [];
      const epicRefs = refs.epics[storyId] || [];
      const taskRefs = refs.tasks[storyId] || [];

      const output = {
        ...file.data,
        file: result.file,
        prd: path.basename(result.prdDir),
        children: childrenList.map(c => c.id),
        referencedByEpics: epicRefs,
        referencedByTasks: taskRefs,
        hasTaskReference: taskRefs.length > 0
      };

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

        console.log(`\nFile: ${result.file}`);
      }
    });

  // story:create
  story.command('create <prd> <title>')
    .description('Create story in PRD')
    .option('-t, --type <type>', `Story type (${STORY_TYPES.join('|')})`, 'user')
    .option('--parent-story <id>', 'Parent story ID')
    .option('--json', 'JSON output')
    .action((prd, title, options) => {
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

      const data = {
        id,
        title,
        parent: path.basename(prdDir).split('-').slice(0, 2).join('-'),
        parent_story: options.parentStory ? normalizeId(options.parentStory) : null,
        type: options.type
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
        jsonOut({ id, title, parent: data.parent, type: data.type, file: storyPath });
      } else {
        console.log(`Created: ${id} - ${title}`);
        console.log(`Type: ${data.type}`);
        console.log(`File: ${storyPath}`);
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
    .action((id, options) => {
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
        file.data.type = options.type;
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
          let value = valueParts.join('=');

          // Parse value types
          if (value === 'null') value = null;
          else if (value === 'true') value = true;
          else if (value === 'false') value = false;
          else if (/^\d+$/.test(value)) value = parseInt(value);

          file.data[key] = value;
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
    .action((prdArg, options) => {
      const prd = prdArg || options.prd;
      const stories = getAllStories(prd);
      const { roots, children } = buildStoryTree(stories);

      if (roots.length === 0) {
        console.log('No stories found.');
        return;
      }

      function printTree(story, indent = '') {
        const typeIcon = story.type === 'user' ? '👤' : story.type === 'technical' ? '⚙️' : '🔌';
        console.log(`${indent}${typeIcon} ${story.id}: ${story.title}`);
        const childList = children.get(normalizeId(story.id)) || [];
        childList.forEach((child, i) => {
          const isLast = i === childList.length - 1;
          const prefix = isLast ? '└── ' : '├── ';
          const nextIndent = indent + (isLast ? '    ' : '│   ');
          printTree(child, indent + prefix.slice(0, -4));
        });
      }

      roots.forEach(r => printTree(r));
    });

  // story:roots
  story.command('roots [prd]')
    .description('List root stories (no parent)')
    .option('--prd <id>', 'Filter by PRD')
    .option('--json', 'JSON output')
    .action((prdArg, options) => {
      const prd = prdArg || options.prd;
      const stories = getAllStories(prd);
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
    .option('--json', 'JSON output')
    .action((prdArg, options) => {
      const prd = prdArg || options.prd;
      const stories = getAllStories(prd);
      const { children } = buildStoryTree(stories);

      const leaves = stories.filter(s => {
        const childList = children.get(normalizeId(s.id)) || [];
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
    .action((id, options) => {
      const stories = getAllStories();
      const { children } = buildStoryTree(stories);
      const storyId = normalizeId(id);

      const childList = children.get(storyId) || [];

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
    .action((id, options) => {
      const stories = getAllStories();
      const { byId } = buildStoryTree(stories);
      const storyId = normalizeId(id);

      const ancestors = [];
      let current = byId.get(storyId);

      while (current) {
        ancestors.push(current);
        if (current.parent_story) {
          current = byId.get(normalizeId(current.parent_story));
        } else {
          current = null;
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
    .option('--json', 'JSON output')
    .action((prdArg, options) => {
      const prd = prdArg || options.prd;
      const stories = getAllStories(prd);
      const refs = getStoryReferences();

      const orphans = stories.filter(s => {
        const storyId = normalizeId(s.id);
        const taskRefs = refs.tasks[storyId] || [];
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
    .option('--json', 'JSON output')
    .action((prdArg, options) => {
      // Same as orphans
      const prd = prdArg || options.prd;
      const stories = getAllStories(prd);
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
    .action((prdArg, options) => {
      const prd = prdArg || options.prd;
      const stories = getAllStories(prd);
      const refs = getStoryReferences();

      const issues = [];

      // Check for orphan stories
      stories.forEach(s => {
        const storyId = normalizeId(s.id);
        const taskRefs = refs.tasks[storyId] || [];
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
    .action((prdArg, options) => {
      let stories = [];

      if (options.epic) {
        // Find epic and get its stories
        for (const prdDir of findPrdDirs()) {
          findFiles(path.join(prdDir, 'epics'), /^E\d+.*\.md$/).forEach(f => {
            const file = loadFile(f);
            if (matchesId(f, options.epic) && file?.data?.stories) {
              file.data.stories.forEach(sid => {
                const storyResult = findStoryFile(sid);
                if (storyResult) {
                  const storyFile = loadFile(storyResult.file);
                  stories.push({
                    id: storyFile.data.id,
                    title: storyFile.data.title,
                    type: storyFile.data.type,
                    file: storyResult.file
                  });
                }
              });
            }
          });
        }
      } else if (options.task) {
        // Find task and get its stories
        for (const prdDir of findPrdDirs()) {
          findFiles(path.join(prdDir, 'tasks'), /^T\d+.*\.md$/).forEach(f => {
            const file = loadFile(f);
            if (matchesId(f, options.task) && file?.data?.stories) {
              file.data.stories.forEach(sid => {
                const storyResult = findStoryFile(sid);
                if (storyResult) {
                  const storyFile = loadFile(storyResult.file);
                  stories.push({
                    id: storyFile.data.id,
                    title: storyFile.data.title,
                    type: storyFile.data.type,
                    file: storyResult.file
                  });
                }
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
}
