/**
 * Permissions commands for rudder CLI
 * Manages Claude Code settings for sailing skill
 */
import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { findProjectRoot, loadPathsConfig, jsonOut } from '../managers/core-manager.js';
import { addDynamicHelp } from '../lib/help.js';

interface ClaudeSettings {
  includeCoAuthoredBy: boolean;
  permissions: {
    allow: string[];
  };
}

interface PathsConfig {
  paths: Record<string, string | null>;
}

// Base sailing permissions (path-independent)
const BASE_PERMISSIONS = [
  'Bash(bin/rudder:*)',      // bin/rudder <args>
  'Bash(bin/rudder *:*)',    // bin/rudder <subcommand> <args>
  'Bash(./bin/rudder:*)',    // ./bin/rudder <args>
  'Bash(./bin/rudder *:*)',  // ./bin/rudder <subcommand> <args>
  'Bash(npm install:*)',
  'Bash(npm test:*)',
  'Bash(npm run:*)',
  'Bash(make:*)',
  'Bash(chmod:*)',
  'Bash(mkdir:*)',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git branch:*)',
  'Read(.claude/**)'
];

/**
 * Get sailing permissions based on paths.yaml configuration
 */
function getSailingPermissions() {
  const config = loadPathsConfig() as PathsConfig;
  const perms: string[] = [...BASE_PERMISSIONS];

  // Add Read permission for the sailing directory
  // Use artefacts path as base (e.g., 'sailing' or '.sailing/artefacts')
  const artefactsPath = (config.paths.artefacts || '.sailing/artefacts');
  const sailingBase = artefactsPath.split('/')[0]; // Get first segment

  perms.push(`Read(${sailingBase}/**)`);

  return perms;
}

/**
 * Get path to Claude settings file
 */
function getSettingsPath() {
  const projectRoot = findProjectRoot();
  return path.join(projectRoot, '.claude', 'settings.local.json');
}

/**
 * Load existing settings or create default
 */
function loadSettings(): ClaudeSettings {
  const settingsPath = getSettingsPath();
  if (fs.existsSync(settingsPath)) {
    try {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as ClaudeSettings;
    } catch {
      console.error(`Warning: Could not parse ${settingsPath}, creating new`);
    }
  }
  return {
    includeCoAuthoredBy: false,
    permissions: { allow: [] }
  };
}

/**
 * Save settings
 */
function saveSettings(settings: ClaudeSettings) {
  const settingsPath = getSettingsPath();
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
}

/**
 * Register permissions commands
 */
export function registerPermissionsCommands(program: Command) {
  const perms = program.command('permissions').description('Claude Code permissions management');

  // permissions:check
  perms.command('check')
    .description('Check if sailing permissions are configured')
    .option('--json', 'JSON output')
    .action((options: { json?: boolean }) => {
      const settings = loadSettings();
      const existing: string[] = settings.permissions?.allow || [];
      const requiredPerms = getSailingPermissions();

      const missing: string[] = requiredPerms.filter(p => !existing.includes(p));
      const extra: string[] = existing.filter(p => !requiredPerms.includes(p));
      const present: string[] = requiredPerms.filter(p => existing.includes(p));

      const result = {
        settingsPath: getSettingsPath(),
        settingsExists: fs.existsSync(getSettingsPath()),
        required: requiredPerms.length,
        present: present.length,
        missing: missing.length,
        extra: extra.length,
        missingList: missing,
        ok: missing.length === 0
      };

      if (options.json) {
        jsonOut(result);
      } else {
        console.log('Claude Code Permissions Check\n');
        console.log(`Settings: ${result.settingsPath}`);
        console.log(`Exists: ${result.settingsExists ? 'Yes' : 'No'}`);
        console.log(`\nSailing permissions: ${result.present}/${result.required}`);

        if (missing.length > 0) {
          console.log(`\nMissing (${missing.length}):`);
          missing.forEach(p => console.log(`  - ${p}`));
        }

        if (extra.length > 0) {
          console.log(`\nExtra (${extra.length}):`);
          extra.forEach(p => console.log(`  + ${p}`));
        }

        console.log(`\nStatus: ${result.ok ? '✓ OK' : '✗ Missing permissions'}`);
        if (!result.ok) {
          console.log('\nRun `bin/rudder permissions:fix` to add missing permissions.');
        }
      }
    });

  // permissions:fix
  perms.command('fix')
    .description('Add missing sailing permissions and clean up redundant ones')
    .option('--dry-run', 'Show what would be done')
    .option('--json', 'JSON output')
    .action((options: { dryRun?: boolean; json?: boolean }) => {
      const settings = loadSettings();
      if (!settings.permissions) settings.permissions = { allow: [] };
      if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];

      const existing: string[] = settings.permissions.allow;
      const added: string[] = [];
      const removed: string[] = [];
      const requiredPerms = getSailingPermissions();

      // Ensure includeCoAuthoredBy is set to false
      let coAuthorFixed = false;
      if (settings.includeCoAuthoredBy !== false) {
        if (!options.dryRun) {
          settings.includeCoAuthoredBy = false;
        }
        coAuthorFixed = true;
      }

      // Add missing required permissions
      for (const perm of requiredPerms) {
        if (!existing.includes(perm)) {
          added.push(perm);
          if (!options.dryRun) {
            existing.push(perm);
          }
        }
      }

      // Remove redundant bin/rudder permissions (specific ones without wildcards)
      // Keep only the broad patterns: bin/rudder:*, bin/rudder *:*, ./bin/rudder:*, ./bin/rudder *:*
      const broadRudderPatterns = [
        'Bash(bin/rudder:*)',
        'Bash(bin/rudder *:*)',
        'Bash(./bin/rudder:*)',
        'Bash(./bin/rudder *:*)'
      ];

      const toRemove: number[] = [];
      for (let i = 0; i < existing.length; i++) {
        const perm = existing[i];
        // Check if it's a bin/rudder permission but not a broad pattern
        if (perm.startsWith('Bash(bin/rudder') || perm.startsWith('Bash(./bin/rudder')) {
          if (!broadRudderPatterns.includes(perm)) {
            toRemove.push(i);
            removed.push(perm);
          }
        }
      }

      // Remove from end to start to preserve indices
      if (!options.dryRun) {
        for (let i = toRemove.length - 1; i >= 0; i--) {
          existing.splice(toRemove[i], 1);
        }
      }

      const hasChanges = added.length > 0 || removed.length > 0 || coAuthorFixed;
      if (!options.dryRun && hasChanges) {
        saveSettings(settings);
      }

      const result = {
        settingsPath: getSettingsPath(),
        added: added.length,
        addedList: added,
        removed: removed.length,
        removedList: removed,
        coAuthorFixed,
        dryRun: options.dryRun || false
      };

      if (options.json) {
        jsonOut(result);
      } else {
        if (!hasChanges) {
          console.log('All sailing settings already configured.');
        } else {
          if (coAuthorFixed) {
            if (options.dryRun) {
              console.log('Would set: includeCoAuthoredBy = false');
            } else {
              console.log('Set: includeCoAuthoredBy = false');
            }
          }
          if (added.length > 0) {
            if (options.dryRun) {
              console.log(`Would add ${added.length} permissions:`);
            } else {
              console.log(`Added ${added.length} permissions:`);
            }
            added.forEach(p => console.log(`  + ${p}`));
          }
          if (removed.length > 0) {
            if (options.dryRun) {
              console.log(`\nWould remove ${removed.length} redundant bin/rudder permissions`);
            } else {
              console.log(`\nRemoved ${removed.length} redundant bin/rudder permissions`);
            }
          }
          if (!options.dryRun) {
            console.log(`\nUpdated: ${result.settingsPath}`);
          }
        }
      }
    });

  // permissions:list
  perms.command('list')
    .description('List required sailing permissions')
    .option('--json', 'JSON output')
    .action((options: { json?: boolean }) => {
      const requiredPerms = getSailingPermissions();
      if (options.json) {
        jsonOut(requiredPerms);
      } else {
        console.log('Required sailing permissions:\n');
        requiredPerms.forEach(p => console.log(`  ${p}`));
      }
    });

  // permissions:show
  perms.command('show')
    .description('Show current Claude settings')
    .option('--json', 'JSON output')
    .action((options: { json?: boolean }) => {
      const settingsPath = getSettingsPath();

      if (!fs.existsSync(settingsPath)) {
        if (options.json) {
          jsonOut({ exists: false, path: settingsPath });
        } else {
          console.log(`Settings not found: ${settingsPath}`);
        }
        return;
      }

      const settings = loadSettings();

      if (options.json) {
        jsonOut({ exists: true, path: settingsPath, settings });
      } else {
        console.log(`File: ${settingsPath}\n`);
        console.log(JSON.stringify(settings, null, 2));
      }
    });

  // Add dynamic help for permissions group
  addDynamicHelp(perms);
}
