/**
 * ADR commands for rudder CLI
 *
 * Commands:
 *   adr:create <title>     Create a new ADR
 *   adr:list               List all ADRs
 *   adr:show <id>          Show ADR details
 *   adr:accept <id>        Mark ADR as accepted
 *   adr:deprecate <id>     Mark ADR as deprecated
 *   adr:wizard             Interactive ADR creation wizard
 */
import { jsonOut } from '../managers/core-manager.js';
import { getAllAdrs, getFullAdr, createAdr, updateAdrStatus, formatAdrLine, normalizeAdrId, getAdrDir } from '../managers/adr-manager.js';
import { addDynamicHelp } from '../lib/help.js';
/**
 * Register ADR commands
 */
export function registerAdrCommands(program) {
    const adr = program.command('adr').description('Architecture Decision Records');
    addDynamicHelp(adr, { entityType: 'adr' });
    // adr:list
    adr.command('list')
        .description('List all ADRs')
        .option('-s, --status <status>', 'Filter by status (Proposed|Accepted|Deprecated|Superseded)')
        .option('-d, --domain <domain>', 'Filter by domain')
        .option('-t, --tag <tag...>', 'Filter by tags')
        .option('--json', 'JSON output')
        .action((options) => {
        let entries = getAllAdrs();
        // Apply filters
        if (options.status) {
            const status = options.status;
            entries = entries.filter(e => e.data.status === status);
        }
        if (options.domain) {
            entries = entries.filter(e => e.data.domain === options.domain);
        }
        if (options.tag && options.tag.length > 0) {
            entries = entries.filter(e => {
                const adrTags = e.data.tags || [];
                return options.tag.some(t => adrTags.includes(t));
            });
        }
        if (options.json) {
            jsonOut(entries.map(e => ({
                id: e.id,
                title: e.data.title,
                status: e.data.status,
                domain: e.data.domain,
                tags: e.data.tags,
                created: e.data.created,
                file: e.file
            })));
        }
        else {
            if (entries.length === 0) {
                console.log('No ADRs found.');
                console.log(`\nADR directory: ${getAdrDir()}`);
                console.log('Use "rudder adr:create <title>" to create one.');
            }
            else {
                console.log('ADRs:\n');
                for (const entry of entries) {
                    console.log(`  ${formatAdrLine(entry)}`);
                }
                console.log(`\n${entries.length} ADR(s) found.`);
            }
        }
    });
    // adr:show <id>
    adr.command('show <id>')
        .description('Show ADR details')
        .option('--json', 'JSON output')
        .action((id, options) => {
        const normalizedId = normalizeAdrId(id);
        const fullAdr = getFullAdr(normalizedId);
        if (!fullAdr) {
            console.error(`ADR not found: ${normalizedId}`);
            process.exit(1);
        }
        if (options.json) {
            jsonOut(fullAdr);
        }
        else {
            console.log(`# ${fullAdr.id}: ${fullAdr.title}\n`);
            console.log(`Status:  ${fullAdr.status}`);
            console.log(`Created: ${fullAdr.created}`);
            if (fullAdr.author)
                console.log(`Author:  ${fullAdr.author}`);
            if (fullAdr.domain)
                console.log(`Domain:  ${fullAdr.domain}`);
            if (fullAdr.tags && fullAdr.tags.length > 0) {
                console.log(`Tags:    ${fullAdr.tags.join(', ')}`);
            }
            if (fullAdr.supersedes)
                console.log(`Supersedes: ${fullAdr.supersedes}`);
            if (fullAdr.superseded_by)
                console.log(`Superseded by: ${fullAdr.superseded_by}`);
            console.log(`File:    ${fullAdr.filePath}`);
            console.log('\n---\n');
            console.log(fullAdr.body);
        }
    });
    // adr:create <title>
    adr.command('create <title>')
        .description('Create a new ADR')
        .option('-a, --author <author>', 'Author name')
        .option('-t, --tag <tag...>', 'Tags')
        .option('-d, --domain <domain>', 'Domain (e.g., core, api, frontend)')
        .option('--json', 'JSON output')
        .action((title, options) => {
        const result = createAdr(title, {
            author: options.author,
            tags: options.tag,
            domain: options.domain
        });
        if (options.json) {
            jsonOut(result);
        }
        else {
            console.log(`Created: ${result.id}`);
            console.log(`File:    ${result.file}`);
            console.log('\nEdit the file to fill in Context, Decision, and Consequences.');
        }
    });
    // adr:accept <id>
    adr.command('accept <id>')
        .description('Mark ADR as accepted')
        .option('--json', 'JSON output')
        .action((id, options) => {
        const normalizedId = normalizeAdrId(id);
        const success = updateAdrStatus(normalizedId, 'Accepted');
        if (!success) {
            console.error(`ADR not found: ${normalizedId}`);
            process.exit(1);
        }
        if (options.json) {
            jsonOut({ id: normalizedId, status: 'Accepted' });
        }
        else {
            console.log(`${normalizedId} marked as Accepted`);
        }
    });
    // adr:deprecate <id>
    adr.command('deprecate <id>')
        .description('Mark ADR as deprecated')
        .option('--superseded-by <id>', 'ADR that supersedes this one')
        .option('--json', 'JSON output')
        .action((id, options) => {
        const normalizedId = normalizeAdrId(id);
        const newStatus = options.supersededBy ? 'Superseded' : 'Deprecated';
        const success = updateAdrStatus(normalizedId, newStatus, {
            supersededBy: options.supersededBy ? normalizeAdrId(options.supersededBy) : undefined
        });
        if (!success) {
            console.error(`ADR not found: ${normalizedId}`);
            process.exit(1);
        }
        if (options.json) {
            jsonOut({
                id: normalizedId,
                status: newStatus,
                superseded_by: options.supersededBy || undefined
            });
        }
        else {
            if (options.supersededBy) {
                console.log(`${normalizedId} marked as Superseded by ${normalizeAdrId(options.supersededBy)}`);
            }
            else {
                console.log(`${normalizedId} marked as Deprecated`);
            }
        }
    });
    // adr:wizard - Interactive ADR creation
    adr.command('wizard')
        .description('Interactive ADR creation wizard')
        .action(async () => {
        console.log('ADR Wizard\n');
        console.log('The wizard helps you create well-structured ADRs.');
        console.log('For full interactive experience, use Claude with /dev:adr-scan\n');
        console.log('To create an ADR manually:');
        console.log('  rudder adr:create "Your Decision Title"');
        console.log('\nThen edit the generated file to add:');
        console.log('  - Context: What problem led to this decision?');
        console.log('  - Decision: What was decided?');
        console.log('  - Consequences: Positive and negative impacts');
        console.log('  - Alternatives: What else was considered?');
    });
}
