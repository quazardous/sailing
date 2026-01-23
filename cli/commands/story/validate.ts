/**
 * Story validation commands (orphans, unlinked, validate)
 */
import { Command } from 'commander';
import { jsonOut } from '../../managers/core-manager.js';
import { normalizeId } from '../../lib/normalize.js';
import {
  getAllStories,
  getStoryReferences
} from './helpers.js';
import type { StoryOrphansOptions, StoryValidateOptions } from './helpers.js';

/**
 * Register story validation commands
 */
export function registerValidateCommands(story: Command): void {
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
}
