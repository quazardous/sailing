/**
 * Story CRUD commands (list, show, create, update)
 */
import fs from 'fs';
import path from 'path';
import { findPrdDirs, loadFile, saveFile, toKebab, loadTemplate, jsonOut, stripComments, formatId } from '../../managers/core-manager.js';
import { normalizeId, matchesPrdDir } from '../../lib/normalize.js';
import { nextId } from '../../managers/state-manager.js';
import { prdIdFromDir } from '../../managers/artefacts-manager.js';
import { STORY_TYPES, findStoryFile, getAllStories, getStoryReferences, buildStoryTree } from './helpers.js';
/**
 * Register story CRUD commands
 */
export function registerCrudCommands(story) {
    // story:list
    story.command('list [prd]')
        .description('List stories (filter by PRD, type)')
        .option('-t, --type <type>', `Filter by type (${STORY_TYPES.join(', ')})`)
        .option('-l, --limit <n>', 'Limit results', parseInt)
        .option('--prd <id>', 'Filter by PRD (alias for positional arg)')
        .option('--path', 'Include file path (discouraged)')
        .option('--json', 'JSON output')
        .action((prdArg, options) => {
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
        }
        else {
            if (limited.length === 0) {
                console.log('No stories found.');
            }
            else {
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
        .action((id, options) => {
        const result = findStoryFile(id);
        if (!result) {
            console.error(`Story not found: ${id}`);
            process.exit(1);
        }
        // Raw mode: dump file content
        if (options.raw) {
            if (options.path)
                console.log(`# File: ${result.file}\n`);
            const content = fs.readFileSync(result.file, 'utf8');
            console.log(options.stripComments ? stripComments(content) : content);
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
            prd: result.prdId,
            children: childrenList.map(c => c.id),
            referencedByEpics: epicRefs,
            referencedByTasks: taskRefs,
            hasTaskReference: taskRefs.length > 0
        };
        if (options.path)
            output.file = result.file;
        if (options.json) {
            jsonOut(output);
        }
        else {
            const typeIcon = file.data.type === 'user' ? '👤' : file.data.type === 'technical' ? '⚙️' : '🔌';
            console.log(`# ${typeIcon} ${file.data.id}: ${file.data.title}\n`);
            console.log(`Type: ${file.data.type || 'user'}`);
            console.log(`PRD: ${result.prdId}`);
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
            }
            else {
                console.log(`\n⚠️  No task references (orphan story)`);
            }
            if (options.path)
                console.log(`\nFile: ${result.file}`);
        }
    });
    // story:create
    story.command('create <prd> <title>')
        .description('Create story in PRD')
        .option('-t, --type <type>', `Story type (${STORY_TYPES.join('|')})`, 'user')
        .option('--parent-story <id>', 'Parent story ID')
        .option('--path', 'Show file path')
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
        const storyId = formatId('S', num);
        const filename = `${storyId}-${toKebab(title)}.md`;
        const storyPath = path.join(storiesDir, filename);
        const data = {
            id: storyId,
            title,
            status: 'Draft',
            parent: prdIdFromDir(prdDir),
            parent_story: options.parentStory ? normalizeId(options.parentStory) : null,
            type: options.type
        };
        // Load template or use minimal body
        let body = loadTemplate('story');
        if (body) {
            body = body.replace(/^---[\s\S]*?---\s*/, '');
            body = body.replace(/# S0000: Story Title/g, `# ${storyId}: ${title}`);
        }
        else {
            body = `\n# ${storyId}: ${title}\n\n## Story\n\n[Define the story]\n\n## Acceptance Criteria\n\n- [ ] Given X, when Y, then Z\n\n## Context\n\n**Where**: \n**Why**: \n**Constraints**: \n`;
        }
        saveFile(storyPath, data, body);
        if (options.json) {
            const output = { id: storyId, title, parent: data.parent, type: data.type };
            if (options.path)
                output.file = storyPath;
            jsonOut(output);
        }
        else {
            console.log(`Created: ${storyId} - ${title} (${data.type})`);
            if (options.path)
                console.log(`File: ${storyPath}`);
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
                if (value === 'null')
                    value = null;
                else if (value === 'true')
                    value = true;
                else if (value === 'false')
                    value = false;
                else if (/^\d+$/.test(value))
                    value = parseInt(value);
                file.data[key] = value;
                updated = true;
            });
        }
        if (updated) {
            saveFile(result.file, file.data, file.body);
            if (options.json) {
                jsonOut(file.data);
            }
            else {
                console.log(`Updated: ${file.data.id}`);
            }
        }
        else {
            console.log('No changes made.');
        }
    });
}
