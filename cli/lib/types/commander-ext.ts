import { Command, Option } from 'commander';

export interface CommandArg {
  name(): string;
  required: boolean;
  variadic?: boolean;
  description?: string;
}

export interface OptionWithMeta extends Option {
  short?: string;
  long?: string;
  description: string;
  negate: boolean;
  required: boolean;
  optional: boolean;
  variadic: boolean;
  argChoices?: string[];
}

export type ModificationType = 'prd' | 'epic' | 'task' | 'story' | 'memory' | 'git' | 'state' | 'db' | 'config';

export interface CommandWithInternals extends Command {
  _args: CommandArg[];
  options: OptionWithMeta[];
  commands: Command[];
  _modifies?: ModificationType[];
  // Chainable method added via prototype extension
  modifies?(types: ModificationType[]): Command;
}
