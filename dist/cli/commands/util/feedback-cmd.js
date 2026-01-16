/**
 * Feedback commands - Agent feedback management
 */
import fs from 'fs';
import path from 'path';
import { getSailingDir } from '../../managers/core-manager.js';
import { addDynamicHelp } from '../../lib/help.js';
/**
 * Register feedback commands
 */
export function registerFeedbackCommands(program) {
    const feedback = program.command('feedback')
        .description('Feedback management (agent systemic issues)');
    addDynamicHelp(feedback, { entityType: 'feedback' });
    // feedback:add
    feedback.command('add <message>')
        .description('Log agent feedback (systemic issues, not task-specific)')
        .option('-t, --task <id>', 'Related task')
        .action((message, options) => {
        const feedbackFile = path.join(getSailingDir(), 'feedback.log');
        const date = new Date().toISOString();
        const taskRef = options.task ? ` [${options.task}]` : '';
        const entry = `${date}${taskRef}: ${message}\n`;
        fs.appendFileSync(feedbackFile, entry);
        console.log('Feedback logged.');
    });
    // feedback:list
    feedback.command('list')
        .description('Show feedback log')
        .option('-l, --limit <n>', 'Limit entries', parseInt, 20)
        .action((options) => {
        const feedbackFile = path.join(getSailingDir(), 'feedback.log');
        if (!fs.existsSync(feedbackFile)) {
            console.log('No feedback yet.');
            return;
        }
        const content = fs.readFileSync(feedbackFile, 'utf8');
        const lines = content.trim().split('\n').filter(l => l);
        const limited = lines.slice(-options.limit);
        console.log('Recent feedback:\n');
        limited.forEach(line => console.log(`  ${line}`));
        if (lines.length > options.limit) {
            console.log(`\n... and ${lines.length - options.limit} more`);
        }
    });
    return feedback;
}
