/**
 * Dynamic help generator for rudder CLI
 * Generates detailed options summary from registered commands
 * TODO[P1]: Replace reliance on Commander internals (_args/options) with a typed wrapper when moving to strict.
 * TODO[P2]: Align status injection with typed STATUS map to avoid string lookups.
 * TODO[P3]: Consider generating help from declarative metadata to reduce coupling before TS migration.
 */
import { STATUS } from './lexicon.js';
import type { Command as CommanderCommand, Option as CommanderOption } from 'commander';

type CommandArg = { name(): string; required: boolean; variadic?: boolean; description?: string };

type OptionWithMeta = CommanderOption & {
  short?: string;
  long?: string;
  description?: string;
  negate?: boolean;
  required?: boolean;
  optional?: boolean;
  variadic?: boolean;
  argChoices?: string[];
};

type CommandWithInternals = CommanderCommand & {
  _args: CommandArg[];
  options: OptionWithMeta[];
  commands: CommanderCommand[];
};

/**
 * Format option flags (short + long)
 * @param {Object} opt - Commander option object
 * @returns {string} Formatted flags
 */
function formatOptionFlags(opt: OptionWithMeta) {
  const short = opt.short || '';
  const long = opt.long || '';

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
  const command = cmd as CommandWithInternals;

  // Arguments
  command._args.forEach((arg) => {
    const name = arg.required ? `<${arg.name()}>` : `[${arg.name()}]`;
    const desc = arg.description || '';
    lines.push({ flags: name, desc });
  });

  // Options (skip -h/--help)
  command.options.forEach((opt: OptionWithMeta) => {
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
  const statusValues = entityType && (STATUS as Record<string, string[]>)[entityType]
    ? (STATUS as Record<string, string[]>)[entityType].join(', ')
    : null;

  (group as CommandWithInternals).commands.forEach((cmd: CommandWithInternals) => {
    if (cmd.name() === 'help') return;

    // Build command line with arguments
    const args = cmd._args.map((arg: CommandArg) =>
      arg.required ? `<${arg.name()}>` : `[${arg.name()}]`
    ).join(' ');

    const cmdLine = args ? `${cmd.name()} ${args}` : cmd.name();
    output.push(`• ${cmdLine}`);

    // Get options only (skip arguments)
    const options: { flags: string; desc: string }[] = [];
    cmd.options.forEach((opt: OptionWithMeta) => {
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
