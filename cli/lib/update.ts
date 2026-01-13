/**
 * Update utilities for parsing flags and updating entity data
 */
import { normalizeStatus, STATUS, EFFORT, PRIORITY } from './lexicon.js';
import { formatId } from './config.js';
import { Task, Epic, Prd } from './types/entities.js';

interface UpdateOptions {
  status?: string;
  title?: string;
  assignee?: string;
  effort?: string;
  priority?: string;
  addBlocker?: string | string[];
  removeBlocker?: string | string[];
  clearBlockers?: boolean;
  story?: string | string[];
  addStory?: string | string[];
  removeStory?: string | string[];
  targetVersion?: string | string[];
  removeTargetVersion?: string | string[];
  set?: string | string[];
  [key: string]: any; // Allow other commander options
}

/**
 * Parse update flags from command options and apply to frontmatter data
 * @param {Object} options - Commander options object
 * @param {Object} data - Current frontmatter data
 * @param {string} entityType - 'task', 'epic', or 'prd'
 * @returns {{ updated: boolean, data: Object }}
 */
export function parseUpdateOptions(
  options: UpdateOptions, 
  data: Partial<Task & Epic & Prd & Record<string, any>>,
  entityType: 'task' | 'epic' | 'prd'
): { updated: boolean; data: any } {
  let updated = false;

  // Status (all entity types)
  if (options.status) {
    const normalized = normalizeStatus(options.status, entityType);
    if (!normalized) {
      console.error(`Invalid status: "${options.status}"`);
      console.error(`Valid for ${entityType}: ${STATUS[entityType].join(', ')}`);
      process.exit(1);
    }

    // Track status change timestamps
    const now = new Date().toISOString();
    const oldStatus = data.status;

    if (oldStatus !== normalized) {
      switch (normalized) {
        case 'In Progress':
          if (!data.started_at) data.started_at = now;
          break;
        case 'Blocked':
          data.blocked_at = now;
          break;
        case 'Done':
          data.done_at = now;
          if (!data.started_at) data.started_at = now;
          break;
        case 'Cancelled':
          data.cancelled_at = now;
          break;
        case 'In Review':
          data.review_at = now;
          break;
        case 'Approved':
          data.approved_at = now;
          break;
      }
    }

    data.status = normalized;
    updated = true;
  }

  // Title (all entity types)
  if (options.title) {
    data.title = options.title;
    updated = true;
  }

  // Assignee (task and epic)
  if ((entityType === 'task' || entityType === 'epic') && options.assignee) {
    data.assignee = options.assignee;
    updated = true;
  }

  // Task-specific options
  if (entityType === 'task') {
    if (options.effort) {
      const effort = options.effort.toUpperCase();
      if (EFFORT.includes(effort as any)) {
        data.effort = effort as any;
        updated = true;
      } else {
        console.error(`Invalid effort: ${effort}. Use ${EFFORT.join(', ')}.`);
      }
    }

    if (options.priority) {
      const priority = options.priority.toLowerCase();
      if (PRIORITY.includes(priority as any)) {
        data.priority = priority as any;
        updated = true;
      } else {
        console.error(`Invalid priority: ${priority}. Use ${PRIORITY.join(', ')}.`);
      }
    }
  }

  // Blocker management (task and epic)
  if (entityType === 'task' || entityType === 'epic') {
    if (options.addBlocker) {
      const blockers = Array.isArray(options.addBlocker) ? options.addBlocker : [options.addBlocker];
      if (!Array.isArray(data.blocked_by)) data.blocked_by = [];
      blockers.forEach(b => {
        if (!data.blocked_by!.includes(b)) {
          data.blocked_by!.push(b);
        }
      });
      updated = true;
    }

    if (options.removeBlocker) {
      const blockers = Array.isArray(options.removeBlocker) ? options.removeBlocker : [options.removeBlocker];
      if (Array.isArray(data.blocked_by)) {
        data.blocked_by = data.blocked_by.filter(b => !blockers.includes(b));
      }
      updated = true;
    }

    if (options.clearBlockers) {
      data.blocked_by = [];
      updated = true;
    }
  }

  // Story management (task and epic)
  if (entityType === 'task' || entityType === 'epic') {
    // Replace all stories
    if (options.story) {
      const stories = Array.isArray(options.story) ? options.story : [options.story];
      data.stories = stories.map(s => {
        const num = s.match(/\d+/)?.[0];
        return num ? formatId('S', parseInt(num, 10)) : s;
      });
      updated = true;
    }

    // Add stories
    if (options.addStory) {
      const stories = Array.isArray(options.addStory) ? options.addStory : [options.addStory];
      if (!Array.isArray(data.stories)) data.stories = [];
      stories.forEach(s => {
        const num = s.match(/\d+/)?.[0];
        const normalized = num ? formatId('S', parseInt(num, 10)) : s;
        if (!data.stories!.includes(normalized)) {
          data.stories!.push(normalized);
        }
      });
      updated = true;
    }

    // Remove stories
    if (options.removeStory) {
      const stories = Array.isArray(options.removeStory) ? options.removeStory : [options.removeStory];
      if (Array.isArray(data.stories)) {
        const toRemove = stories.map(s => {
          const num = s.match(/\d+/)?.[0];
          return num ? formatId('S', parseInt(num, 10)) : s;
        });
        data.stories = data.stories.filter(s => !toRemove.includes(s));
      }
      updated = true;
    }
  }

  // Target version (task and epic)
  if (entityType === 'task' || entityType === 'epic') {
    if (options.targetVersion) {
      const versions = Array.isArray(options.targetVersion) ? options.targetVersion : [options.targetVersion];
      if (!data.target_versions) data.target_versions = {};
      versions.forEach(tv => {
        const [component, version] = tv.split(':');
        if (component && version) {
          data.target_versions![component] = version;
          updated = true;
        } else {
          console.error(`Invalid target-version format: ${tv}. Use component:version`);
        }
      });
    }

    if (options.removeTargetVersion) {
      const components = Array.isArray(options.removeTargetVersion) ? options.removeTargetVersion : [options.removeTargetVersion];
      if (data.target_versions) {
        components.forEach(c => delete data.target_versions![c]);
        updated = true;
      }
    }
  }

  // Generic --set key=value (fallback for any frontmatter field)
  if (options.set) {
    const sets = Array.isArray(options.set) ? options.set : [options.set];
    sets.forEach(kv => {
      const eqIndex = kv.indexOf('=');
      if (eqIndex === -1) {
        console.error(`Invalid --set format: "${kv}". Use key=value`);
        return;
      }
      const key = kv.slice(0, eqIndex);
      let value: any = kv.slice(eqIndex + 1);

      // Parse value types
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (value === 'null') value = null;
      else if (/^-?\d+$/.test(value)) value = parseInt(value, 10);
      else if (/^-?\d+\.\d+$/.test(value)) value = parseFloat(value);
      else if (value.startsWith('[') && value.endsWith(']')) {
        // Try JSON first, then simple bracket syntax [a,b,c]
        try {
          value = JSON.parse(value);
        } catch (e) {
          // Parse simple array syntax: [E001,E002] -> ["E001", "E002"]
          const inner = value.slice(1, -1).trim();
          if (inner === '') {
            value = [];
          } else {
            value = inner.split(',').map((s: string) => s.trim());
          }
        }
      }

      // Support nested keys with dot notation (e.g., target_versions.admin)
      const keys = key.split('.');
      let obj: any = data;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!obj[keys[i]] || typeof obj[keys[i]] !== 'object') {
          obj[keys[i]] = {};
        }
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      updated = true;
    });
  }

  return { updated, data };
}

/**
 * Add a log entry to a task/epic body
 */
export function addLogEntry(body: string, message: string, author = 'agent'): string {
  const date = new Date().toISOString().split('T')[0];
  const entry = `- ${date}: ${message} - ${author}`;

  // Find ## Log section and append
  const logMatch = body.match(/^## Log\s*$/m);
  if (logMatch) {
    const insertPos = body.indexOf('\n', logMatch.index! + logMatch[0].length);
    return body.slice(0, insertPos + 1) + '\n' + entry + body.slice(insertPos);
  }

  // No log section, append one
  return body + '\n\n## Log\n\n' + entry + '\n';
}