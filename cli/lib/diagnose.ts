/**
 * Diagnose library - Filter and analyze agent run logs
 *
 * PURE LIB: No config access, no manager imports.
 * DiagnoseOps class encapsulates operations needing baseDiagnosticsDir.
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export interface NoiseFilter {
  id: string;
  description: string;
  match: {
    type?: string;
    contains?: string;
    pattern?: string;
  };
  auto_learned?: boolean;
  learned_at?: string;
}

export interface ToolUseResult {
  stderr?: string;
  stdout?: string;
  [key: string]: unknown;
}

export interface MessageContent {
  is_error?: boolean;
  content?: string | unknown;
  [key: string]: unknown;
}

export interface LogEventMessage {
  content?: MessageContent[] | unknown;
  [key: string]: unknown;
}

export interface LogEvent {
  type: string;
  message?: LogEventMessage;
  tool_use_result?: ToolUseResult;
  [key: string]: unknown;
}

export interface DiagnoseResult {
  task_id: string;
  epic_id: string | null;
  total_events: number;
  filtered_noise: number;
  errors: string[];
}

// ============================================================================
// Pure Functions (no context needed)
// ============================================================================

/**
 * Check if an event matches a noise filter
 */
export function matchesNoiseFilter(line: string, event: LogEvent, filter: NoiseFilter): boolean {
  const match = filter.match;

  if (match.type && event.type !== match.type) {
    return false;
  }

  if (match.contains && !line.includes(match.contains)) {
    return false;
  }

  if (match.pattern) {
    try {
      const regex = new RegExp(match.pattern, 'i');
      if (!regex.test(line)) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * Parse JSON log file
 */
export function parseJsonLog(logFile: string): { events: LogEvent[]; lines: string[] } {
  const content = fs.readFileSync(logFile, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());
  const events: LogEvent[] = [];

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as LogEvent;
      events.push(event);
    } catch {
      // Skip invalid JSON lines
    }
  }

  return { events, lines };
}

/**
 * Truncate error message intelligently
 */
export function truncateError(msg: string, maxLen = 500): string {
  const clean = msg.replace(/\r\n/g, '\n').replace(/\n+/g, ' | ');

  if (clean.length <= maxLen) {
    return clean;
  }

  const firstPart = clean.substring(0, maxLen - 50);
  const lastPart = clean.substring(clean.length - 40);
  return `${firstPart} [...] ${lastPart}`;
}

/**
 * Print diagnose result to console
 */
export function printDiagnoseResult(taskId: string, result: DiagnoseResult, maxErrors = 10): void {
  if (result.errors.length === 0) {
    console.log(`${taskId}: ${result.total_events} events, ${result.filtered_noise} filtered, no errors detected`);
  } else {
    console.log(`${taskId}: ${result.total_events} events, ${result.filtered_noise} filtered, ${result.errors.length} potential errors:`);
    for (const err of result.errors.slice(0, maxErrors)) {
      console.log(`  ${err}`);
    }
    if (result.errors.length > maxErrors) {
      console.log(`  ... and ${result.errors.length - maxErrors} more`);
    }
  }
}

// ============================================================================
// DiagnoseOps Class - POO Encapsulation
// ============================================================================

/**
 * Diagnose operations class with injected baseDiagnosticsDir.
 * Manages noise filters and log analysis.
 */
export class DiagnoseOps {
  constructor(private baseDiagnosticsDir: string) {}

  /**
   * Get diagnostics directory for an epic
   */
  getDiagnosticsDir(epicId: string | null): string {
    if (epicId) {
      return path.join(this.baseDiagnosticsDir, epicId);
    }
    return path.join(this.baseDiagnosticsDir, 'global');
  }

  /**
   * Load noise filters for an epic
   */
  loadNoiseFilters(epicId: string | null): NoiseFilter[] {
    const dir = this.getDiagnosticsDir(epicId);
    const filtersFile = path.join(dir, 'noise-filters.yaml');

    if (!fs.existsSync(filtersFile)) {
      return [];
    }

    try {
      const content = fs.readFileSync(filtersFile, 'utf8');
      const data = yaml.load(content) as { filters?: NoiseFilter[] };
      return data?.filters || [];
    } catch {
      return [];
    }
  }

  /**
   * Save noise filters for an epic
   */
  saveNoiseFilters(epicId: string | null, filters: NoiseFilter[]): void {
    const dir = this.getDiagnosticsDir(epicId);
    fs.mkdirSync(dir, { recursive: true });
    const filtersFile = path.join(dir, 'noise-filters.yaml');
    fs.writeFileSync(filtersFile, yaml.dump({ filters }));
  }

  /**
   * Analyze log file and return errors (main function for post-run analysis)
   */
  analyzeLog(logFile: string, epicId: string | null, maxLineLen = 500): DiagnoseResult {
    if (!fs.existsSync(logFile)) {
      return {
        task_id: '',
        epic_id: epicId,
        total_events: 0,
        filtered_noise: 0,
        errors: []
      };
    }

    const noiseFilters = this.loadNoiseFilters(epicId);
    const { events, lines } = parseJsonLog(logFile);

    const errors: string[] = [];
    let filtered = 0;

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const line = lines[i];

      // Check noise filters
      let isNoise = false;
      for (const filter of noiseFilters) {
        if (matchesNoiseFilter(line, event, filter)) {
          isNoise = true;
          filtered++;
          break;
        }
      }

      if (isNoise) continue;

      // Detect potential errors in tool results
      if (event.tool_use_result) {
        const result = event.tool_use_result;
        const stderr = result.stderr || '';
        const stdout = result.stdout || '';

        if (stderr && stderr.length > 10) {
          errors.push(`L${i + 1}: ${truncateError(stderr, maxLineLen)}`);
        } else if (stdout.includes('Exception') || stdout.includes('Error:') || stdout.includes('error:')) {
          errors.push(`L${i + 1}: ${truncateError(stdout, maxLineLen)}`);
        }
      }

      // Check is_error in tool results
      if (event.type === 'user' && event.message?.content) {
        const content = event.message.content;
        if (Array.isArray(content)) {
          for (const c of content) {
            if (c.is_error === true) {
              const msg = typeof c.content === 'string' ? c.content as string : JSON.stringify(c.content);
              errors.push(`L${i + 1}: ${truncateError(msg, maxLineLen)}`);
            }
          }
        }
      }
    }

    return {
      task_id: '',
      epic_id: epicId,
      total_events: events.length,
      filtered_noise: filtered,
      errors
    };
  }
}
