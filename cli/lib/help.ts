/**
 * Dynamic help generator for rudder CLI
 * Generates detailed options summary from registered commands
 */
import { STATUS } from './lexicon.js';
import type { Command as CommanderCommand, Option as CommanderOption } from 'commander';

/**
 * Format option flags (short + long)
 * @param {Object} opt - Commander option object
 * @returns {string} Formatted flags
 */
function formatOptionFlags(opt: CommanderOption) {
  const short = (opt as any).short || '';
  const long = (opt as any).long || '';

  let flags = '';
  if (short && long) {
    flags = `${short}, ${long}`;
  } else {
    flags = short || long;
  }

  // Add value placeholder
  if (opt.required) {
    const val = opt.argChoices ? opt.argChoices.join('|') : 'val';
    flags += ` <${val}>`;
  } else if (opt.optional) {
    flags += ' [val]';
  } else if (opt.variadic) {
    flags += ' <...>';
  }

  return flags;
}

/**
 * Generate detailed help for a single command
 * @param {Object} cmd - Commander command object
 * @returns {string[]} Lines of help text
 */
function generateCommandHelp(cmd: CommanderCommand) {
  const lines: { flags: string; desc: string }[] = [];

  // Arguments
  (cmd as any)._args.forEach((arg: any) => {
    const name = arg.required ? `<${arg.name()}>` : `[${arg.name()}]`;
    const desc = arg.description || '';
    lines.push({ flags: name, desc });
  });

  // Options (skip -h/--help)
  cmd.options.forEach((opt: CommanderOption & { description?: string; negate?: boolean }) => {
    if (opt.short === '-h' || opt.long === '--help') return;
    if (opt.negate) return;

    const flags = formatOptionFlags(opt);
    const desc = opt.description || '';
    lines.push({ flags, desc });
  });

  return lines;
}

/**
 * Generate help text for a command group
 * @param {Object} group - Commander command group
 * @param {string} entityType - Entity type for status values (task, epic, prd)
 * @returns {string} Formatted help text
 */
export function generateGroupHelp(group: CommanderCommand, entityType?: string) {
  const output: string[] = [''];
  const statusValues = entityType && (STATUS as any)[entityType] ? (STATUS as any)[entityType].join(', ') : null;

  (group as any).commands.forEach((cmd: CommanderCommand & { _args: any[]; options: any[] }) => {
    if (cmd.name() === 'help') return;

    // Build command line with arguments
    const args = cmd._args.map((arg: any) =>
      arg.required ? `<${arg.name()}>` : `[${arg.name()}]`
    ).join(' ');

    const cmdLine = args ? `${cmd.name()} ${args}` : cmd.name();
    output.push(`• ${cmdLine}`);

    // Get options only (skip arguments)
    const options: { flags: string; desc: string }[] = [];
    cmd.options.forEach((opt: CommanderOption & { description?: string; negate?: boolean }) => {
      if (opt.short === '-h' || opt.long === '--help') return;
      if (opt.negate) return;

      let desc = opt.description || '';
      // Inject canonical status values into status option description
      if (statusValues && opt.long === '--status') {
        desc = `Set status (${statusValues})`;
      }

      options.push({ flags: formatOptionFlags(opt), desc });
    });

    if (options.length > 0) {
      // Find max flags length for alignment
      const maxFlags = Math.max(...options.map(o => o.flags.length), 20);

      options.forEach(({ flags, desc }) => {
        const padded = flags.padEnd(maxFlags + 2);
        output.push(`    ${padded}${desc}`);
      });
    }

    output.push('');
  });

  return output.join('\n');
}

/**
 * Add dynamic help to a command group
 * Uses canonical status values from lexicon
 * @param {Object} group - Commander command group
 * @param {Object} extras - Additional help text { entityType: 'task'|'epic'|'prd' }
 */
export function addDynamicHelp(group: CommanderCommand, extras: { entityType?: string } = {}) {
  group.addHelpText('after', () => {
    return generateGroupHelp(group, extras.entityType);
  });
}
