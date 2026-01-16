/**
 * State commands - State management
 */
import { jsonOut, getStateFile } from '../../managers/core-manager.js';
import { addDynamicHelp } from '../../lib/help.js';
import { loadState, saveState } from '../../managers/state-manager.js';
/**
 * Register state commands
 */
export function registerStateCommands(program) {
    const state = program.command('state')
        .description('State management (ID counters)');
    addDynamicHelp(state, { entityType: 'state' });
    // state:show
    state.command('show')
        .description('Show ID counters (PRD, Epic, Task)')
        .option('--json', 'JSON output')
        .action((options) => {
        const stateData = loadState();
        if (options.json) {
            jsonOut(stateData);
        }
        else {
            console.log('State counters:');
            console.log(`  PRD:  ${stateData.counters.prd}`);
            console.log(`  Epic: ${stateData.counters.epic}`);
            console.log(`  Task: ${stateData.counters.task}`);
            console.log(`\nFile: ${getStateFile()}`);
        }
    });
    // state:set
    state.command('set <type> <value>')
        .description('Set a state counter (type: prd, epic, task)')
        .action((type, value) => {
        const num = parseInt(value, 10);
        if (isNaN(num)) {
            console.error('Value must be a number');
            process.exit(1);
        }
        if (!['prd', 'epic', 'task'].includes(type)) {
            console.error('Type must be prd, epic, or task');
            process.exit(1);
        }
        const stateData = loadState();
        stateData.counters[type] = num;
        saveState(stateData);
        console.log(`Set ${type} counter to ${num}`);
    });
    return state;
}
