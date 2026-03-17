/**
 * Agent Protocol Schema Validation (v1)
 *
 * Validates agent-mission and agent-result objects
 * according to the protocol defined in docs/agent-protocol.md
 */

const PROTOCOL_VERSION = '1';

const VALID_STATUSES = ['completed', 'failed', 'blocked'] as const;
const VALID_LOG_LEVELS = ['info', 'tip', 'warn', 'error', 'critical'] as const;
const VALID_FILE_ACTIONS = ['created', 'modified', 'deleted'] as const;
const VALID_ISSUE_TYPES = ['blocker', 'question', 'concern'] as const;

type Status = (typeof VALID_STATUSES)[number];
type FileAction = (typeof VALID_FILE_ACTIONS)[number];
type IssueType = (typeof VALID_ISSUE_TYPES)[number];

interface MissionConstraints {
  max_files?: number;
  no_git_commit?: boolean;
  no_new_deps?: boolean;
}

interface MissionContext {
  dev_md?: string | null;
  epic_file: string;
  task_file: string;
  memory?: string | null;
  toolset?: string | null;
}

interface MissionParams {
  task_id: string;
  epic_id: string;
  prd_id: string;
  instruction: string;
  dev_md?: string | null;
  epic_file: string;
  task_file: string;
  memory?: string | null;
  toolset?: string | null;
  constraints?: MissionConstraints;
  timeout?: number;
}

interface Mission {
  version: string;
  task_id: string;
  epic_id: string;
  prd_id: string;
  instruction: string;
  context: MissionContext;
  constraints: MissionConstraints;
  timeout: number;
}

interface FileModified {
  path: string;
  action: FileAction;
}

interface LogEntry {
  level: string;
  message: string;
  timestamp: string;
}

interface Issue {
  type: IssueType;
  description: string;
}

interface ResultParams {
  task_id: string;
  status: Status;
  files_modified?: FileModified[];
  log?: LogEntry[];
  issues?: Issue[];
  completed_at?: string;
}

interface Result {
  version: string;
  task_id: string;
  status: Status;
  files_modified: FileModified[];
  log: LogEntry[];
  issues: Issue[];
  completed_at: string;
}

/**
 * Validate a mission object
 * @param {object} mission - Mission object to validate
 * @returns {string[]} Array of error messages (empty if valid)
 */
// Runtime validation — input is untrusted JSON, so unknown is the correct type.
// Single cast to Record after the object check, then property access is safe via runtime checks already present.
export function validateMission(mission: unknown): string[] {
  const errors: string[] = [];

  if (!mission || typeof mission !== 'object') {
    return ['Mission must be an object'];
  }

  const m = mission as Record<string, unknown>;

  // Required fields
  if (!m.version) {
    errors.push('Missing required field: version');
  } else if (m.version !== PROTOCOL_VERSION) {
    errors.push(`Unsupported version: ${String(m.version)} (expected ${PROTOCOL_VERSION})`);
  }

  if (!m.task_id) {
    errors.push('Missing required field: task_id');
  } else if (typeof m.task_id !== 'string' || !/^T\d+$/.test(m.task_id)) {
    errors.push(`Invalid task_id format: ${String(m.task_id)} (expected TNNN)`);
  }

  if (!m.epic_id) {
    errors.push('Missing required field: epic_id');
  } else if (typeof m.epic_id !== 'string' || !/^E\d+$/.test(m.epic_id)) {
    errors.push(`Invalid epic_id format: ${String(m.epic_id)} (expected ENNN)`);
  }

  if (!m.prd_id) {
    errors.push('Missing required field: prd_id');
  } else if (typeof m.prd_id !== 'string' || !/^PRD-\d+$/.test(m.prd_id)) {
    errors.push(`Invalid prd_id format: ${String(m.prd_id)} (expected PRD-NNN)`);
  }

  if (!m.instruction) {
    errors.push('Missing required field: instruction');
  } else if (typeof m.instruction !== 'string') {
    errors.push('Field instruction must be a string');
  }

  // Context validation
  if (!m.context) {
    errors.push('Missing required field: context');
  } else if (typeof m.context !== 'object') {
    errors.push('Field context must be an object');
  } else {
    const ctx = m.context as Record<string, unknown>;
    if (!ctx.epic_file) {
      errors.push('Missing required field: context.epic_file');
    }
    if (!ctx.task_file) {
      errors.push('Missing required field: context.task_file');
    }
  }

  // Optional constraints validation
  if (m.constraints !== undefined) {
    if (typeof m.constraints !== 'object') {
      errors.push('Field constraints must be an object');
    } else {
      const c = m.constraints as Record<string, unknown>;
      if (c.max_files !== undefined && typeof c.max_files !== 'number') {
        errors.push('Field constraints.max_files must be a number');
      }
      if (c.no_git_commit !== undefined && typeof c.no_git_commit !== 'boolean') {
        errors.push('Field constraints.no_git_commit must be a boolean');
      }
      if (c.no_new_deps !== undefined && typeof c.no_new_deps !== 'boolean') {
        errors.push('Field constraints.no_new_deps must be a boolean');
      }
    }
  }

  // Optional timeout validation
  if (m.timeout !== undefined) {
    if (typeof m.timeout !== 'number' || m.timeout < 0) {
      errors.push('Field timeout must be a non-negative number');
    }
  }

  return errors;
}

/**
 * Validate a result object
 * @param {object} result - Result object to validate
 * @returns {string[]} Array of error messages (empty if valid)
 */
// Runtime validation — input is untrusted YAML, so unknown is the correct type.
export function validateResult(result: unknown): string[] {
  const errors: string[] = [];

  if (!result || typeof result !== 'object') {
    return ['Result must be an object'];
  }

  const r = result as Record<string, unknown>;

  // Required fields
  if (!r.version) {
    errors.push('Missing required field: version');
  } else if (r.version !== PROTOCOL_VERSION) {
    errors.push(`Unsupported version: ${String(r.version)} (expected ${PROTOCOL_VERSION})`);
  }

  if (!r.task_id) {
    errors.push('Missing required field: task_id');
  } else if (typeof r.task_id !== 'string' || !/^T\d+$/.test(r.task_id)) {
    errors.push(`Invalid task_id format: ${String(r.task_id)} (expected TNNN)`);
  }

  if (!r.status) {
    errors.push('Missing required field: status');
  } else if (!VALID_STATUSES.includes(r.status as Status)) {
    errors.push(`Invalid status: ${String(r.status)} (expected: ${VALID_STATUSES.join(', ')})`);
  }

  // files_modified validation
  if (!r.files_modified) {
    errors.push('Missing required field: files_modified');
  } else if (!Array.isArray(r.files_modified)) {
    errors.push('Field files_modified must be an array');
  } else {
    (r.files_modified as Record<string, unknown>[]).forEach((file, i: number) => {
      if (!file.path) {
        errors.push(`files_modified[${i}]: missing path`);
      }
      if (!file.action) {
        errors.push(`files_modified[${i}]: missing action`);
      } else if (!(VALID_FILE_ACTIONS as readonly string[]).includes(file.action as string)) {
        errors.push(`files_modified[${i}]: invalid action '${String(file.action)}'`);
      }
    });
  }

  // log validation
  if (!r.log) {
    errors.push('Missing required field: log');
  } else if (!Array.isArray(r.log)) {
    errors.push('Field log must be an array');
  } else {
    if (r.log.length < 2) {
      errors.push('Log must contain at least 2 entries');
    }
    (r.log as Record<string, unknown>[]).forEach((entry, i: number) => {
      if (!entry.level) {
        errors.push(`log[${i}]: missing level`);
      } else if (!VALID_LOG_LEVELS.includes(entry.level as typeof VALID_LOG_LEVELS[number])) {
        errors.push(`log[${i}]: invalid level '${String(entry.level)}'`);
      }
      if (!entry.message) {
        errors.push(`log[${i}]: missing message`);
      }
      if (!entry.timestamp) {
        errors.push(`log[${i}]: missing timestamp`);
      }
    });
  }

  // Optional issues validation
  if (r.issues !== undefined) {
    if (!Array.isArray(r.issues)) {
      errors.push('Field issues must be an array');
    } else {
      (r.issues as Record<string, unknown>[]).forEach((issue, i: number) => {
        if (!issue.type) {
          errors.push(`issues[${i}]: missing type`);
        } else if (!(VALID_ISSUE_TYPES as readonly string[]).includes(issue.type as string)) {
          errors.push(`issues[${i}]: invalid type '${String(issue.type)}'`);
        }
        if (!issue.description) {
          errors.push(`issues[${i}]: missing description`);
        }
      });
    }
  }

  // completed_at validation
  if (!r.completed_at) {
    errors.push('Missing required field: completed_at');
  }

  return errors;
}

/**
 * Create a mission object with defaults
 * @param {object} params - Mission parameters
 * @returns {object} Complete mission object
 */
export function createMission(params: MissionParams): Mission {
  return {
    version: PROTOCOL_VERSION,
    task_id: params.task_id,
    epic_id: params.epic_id,
    prd_id: params.prd_id,
    instruction: params.instruction,
    context: {
      dev_md: params.dev_md,
      epic_file: params.epic_file,
      task_file: params.task_file,
      memory: params.memory ?? null,
      toolset: params.toolset ?? null
    },
    constraints: params.constraints ?? {},
    timeout: params.timeout ?? 0
  };
}

/**
 * Create a result object with defaults
 * @param {object} params - Result parameters
 * @returns {object} Complete result object
 */
export function createResult(params: ResultParams): Result {
  return {
    version: PROTOCOL_VERSION,
    task_id: params.task_id,
    status: params.status,
    files_modified: params.files_modified ?? [],
    log: params.log ?? [],
    issues: params.issues ?? [],
    completed_at: params.completed_at ?? new Date().toISOString()
  };
}

/**
 * Get the current protocol version
 */
export function getProtocolVersion() {
  return PROTOCOL_VERSION;
}
