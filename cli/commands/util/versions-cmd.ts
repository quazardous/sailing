/**
 * Versions commands - Version management
 */
import fs from 'fs';
import {
  jsonOut,
  getComponentsFile
} from '../../managers/core-manager.js';
import { addDynamicHelp } from '../../lib/help.js';
import { getAllVersions, bumpComponentVersion, findComponent, loadComponents } from '../../managers/version-manager.js';

/**
 * Register versions commands
 */
export function registerVersionsCommands(program) {
  // versions
  program.command('versions')
    .description('Show component versions (from components.yaml)')
    .option('--json', 'JSON output')
    .option('--components', 'Show components definition with file path')
    .action((options) => {
      if (options.components) {
        const componentsFile = getComponentsFile();
        const exists = fs.existsSync(componentsFile);
        if (options.json) {
          const config = exists ? loadComponents() : null;
          jsonOut({ file: componentsFile, exists, components: config?.components || [] });
        } else {
          console.log(`## Components: ${componentsFile}`);
          console.log(`## Edit this file to manage component versions.\n`);
          if (!exists) {
            console.log(`File not found. Create it to track component versions.`);
            console.log(`See: docs/version_tracking.md`);
          } else {
            const content = fs.readFileSync(componentsFile, 'utf8');
            console.log(content);
          }
        }
        return;
      }

      const versions = getAllVersions();

      if (options.json) {
        jsonOut(versions);
      } else {
        const nameWidth = Math.max(10, ...versions.map(v => v.name.length));
        const versionWidth = Math.max(7, ...versions.map(v => v.version.length));
        const sourceWidth = Math.max(6, ...versions.map(v => v.source.length));

        const header = `${'Component'.padEnd(nameWidth)}  ${'Version'.padEnd(versionWidth)}  ${'Source'.padEnd(sourceWidth)}  Changelog`;
        console.log(header);
        console.log('-'.repeat(header.length + 10));

        versions.forEach(v => {
          const name = v.main ? `${v.name} *` : v.name;
          const changelog = v.changelog || '-';
          console.log(`${name.padEnd(nameWidth)}  ${v.version.padEnd(versionWidth)}  ${v.source.padEnd(sourceWidth)}  ${changelog}`);
        });
      }
    });

  // version group
  const version = program.command('version')
    .description('Version management (bump)');

  addDynamicHelp(version, { entityType: 'version' });

  // version:bump
  version.command('bump <component> <type>')
    .description('Bump component version (type: major, minor, patch)')
    .option('--dry-run', 'Check if bump is possible without making changes')
    .option('--json', 'JSON output')
    .action((componentKey, bumpType, options) => {
      if (!['major', 'minor', 'patch'].includes(bumpType)) {
        console.error(`Invalid bump type: ${bumpType}`);
        console.error('Use: major, minor, or patch');
        process.exit(1);
      }

      const component = findComponent(componentKey);
      if (!component) {
        const config = loadComponents();
        const available = config.components?.map(c => c.key).join(', ') || '(none)';
        console.error(`Component not found: ${componentKey}`);
        console.error(`Available: ${available}`);
        process.exit(1);
      }

      const result = bumpComponentVersion(componentKey, bumpType, { dryRun: options.dryRun });

      if (options.json) {
        jsonOut(result);
        return;
      }

      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      if (options.dryRun) {
        console.log('Dry run - no changes made\n');
        console.log(`Component:   ${result.component}`);
        console.log(`Source:      ${result.source}`);
        console.log(`Current:     ${result.oldVersion}`);
        console.log(`Would bump:  ${result.oldVersion} → ${result.newVersion} (${bumpType})`);
      } else {
        console.log(`Bumped ${result.component}: ${result.oldVersion} → ${result.newVersion}`);
        console.log(`Source: ${result.source}`);
      }
    });

  return version;
}
