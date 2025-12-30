/**
 * Dynamic help generator for rudder CLI
 * Generates detailed options summary from registered commands
 */
import { STATUS } from './lexicon.js';

/**
 * Format option flags (short + long)
 * @param {Object} opt - Commander option object
 * @returns {string} Formatted flags
 */
function formatOptionFlags(opt) {
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
function generateCommandHelp(cmd) {
  const lines = [];
  const indent = '    ';

  // Arguments
  cmd._args.forEach(arg => {
    const name = arg.required ? `<${arg.name()}>` : `[${arg.name()}]`;
    const desc = arg.description || '';
    lines.push({ flags: name, desc });
  });

  // Options (skip -h/--help)
  cmd.options.forEach(opt => {
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
export function generateGroupHelp(group, entityType) {
  const output = [''];
  const statusValues = entityType && STATUS[entityType] ? STATUS[entityType].join(', ') : null;

  group.commands.forEach(cmd => {
    if (cmd.name() === 'help') return;

    // Build command line with arguments
    const args = cmd._args.map(arg =>
      arg.required ? `<${arg.name()}>` : `[${arg.name()}]`
    ).join(' ');

    const cmdLine = args ? `${cmd.name()} ${args}` : cmd.name();
    output.push(`• ${cmdLine}`);

    // Get options only (skip arguments)
    const options = [];
    cmd.options.forEach(opt => {
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
export function addDynamicHelp(group, extras = {}) {
  group.addHelpText('after', () => {
    return generateGroupHelp(group, extras.entityType);
  });
}
