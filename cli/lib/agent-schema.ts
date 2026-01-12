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

/**
 * Validate a mission object
 * @param {object} mission - Mission object to validate
 * @returns {string[]} Array of error messages (empty if valid)
 */
export function validateMission(mission: any): string[] {
  const errors: string[] = [];

  if (!mission || typeof mission !== 'object') {
    return ['Mission must be an object'];
  }

  // Required fields
  if (!mission.version) {
    errors.push('Missing required field: version');
  } else if (mission.version !== PROTOCOL_VERSION) {
    errors.push(`Unsupported version: ${mission.version} (expected ${PROTOCOL_VERSION})`);
  }

  if (!mission.task_id) {
    errors.push('Missing required field: task_id');
  } else if (!/^T\d+$/.test(mission.task_id)) {
    errors.push(`Invalid task_id format: ${mission.task_id} (expected TNNN)`);
  }

  if (!mission.epic_id) {
    errors.push('Missing required field: epic_id');
  } else if (!/^E\d+$/.test(mission.epic_id)) {
    errors.push(`Invalid epic_id format: ${mission.epic_id} (expected ENNN)`);
  }

  if (!mission.prd_id) {
    errors.push('Missing required field: prd_id');
  } else if (!/^PRD-\d+$/.test(mission.prd_id)) {
    errors.push(`Invalid prd_id format: ${mission.prd_id} (expected PRD-NNN)`);
  }

  if (!mission.instruction) {
    errors.push('Missing required field: instruction');
  } else if (typeof mission.instruction !== 'string') {
    errors.push('Field instruction must be a string');
  }

  // Context validation
  if (!mission.context) {
    errors.push('Missing required field: context');
  } else if (typeof mission.context !== 'object') {
    errors.push('Field context must be an object');
  } else {
    // dev_md is optional (project may not have DEV.md)
    if (!mission.context.epic_file) {
      errors.push('Missing required field: context.epic_file');
    }
    if (!mission.context.task_file) {
      errors.push('Missing required field: context.task_file');
    }
  }

  // Optional constraints validation
  if (mission.constraints !== undefined) {
    if (typeof mission.constraints !== 'object') {
      errors.push('Field constraints must be an object');
    } else {
      if (mission.constraints.max_files !== undefined &&
          typeof mission.constraints.max_files !== 'number') {
        errors.push('Field constraints.max_files must be a number');
      }
      if (mission.constraints.no_git_commit !== undefined &&
          typeof mission.constraints.no_git_commit !== 'boolean') {
        errors.push('Field constraints.no_git_commit must be a boolean');
      }
      if (mission.constraints.no_new_deps !== undefined &&
          typeof mission.constraints.no_new_deps !== 'boolean') {
        errors.push('Field constraints.no_new_deps must be a boolean');
      }
    }
  }

  // Optional timeout validation
  if (mission.timeout !== undefined) {
    if (typeof mission.timeout !== 'number' || mission.timeout < 0) {
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
export function validateResult(result: any): string[] {
  const errors: string[] = [];

  if (!result || typeof result !== 'object') {
    return ['Result must be an object'];
  }

  // Required fields
  if (!result.version) {
    errors.push('Missing required field: version');
  } else if (result.version !== PROTOCOL_VERSION) {
    errors.push(`Unsupported version: ${result.version} (expected ${PROTOCOL_VERSION})`);
  }

  if (!result.task_id) {
    errors.push('Missing required field: task_id');
  } else if (!/^T\d+$/.test(result.task_id)) {
    errors.push(`Invalid task_id format: ${result.task_id} (expected TNNN)`);
  }

  if (!result.status) {
    errors.push('Missing required field: status');
  } else if (!VALID_STATUSES.includes(result.status)) {
    errors.push(`Invalid status: ${result.status} (expected: ${VALID_STATUSES.join(', ')})`);
  }

  // files_modified validation
  if (!result.files_modified) {
    errors.push('Missing required field: files_modified');
  } else if (!Array.isArray(result.files_modified)) {
    errors.push('Field files_modified must be an array');
  } else {
    result.files_modified.forEach((file: any, i: number) => {
      if (!file.path) {
        errors.push(`files_modified[${i}]: missing path`);
      }
      if (!file.action) {
        errors.push(`files_modified[${i}]: missing action`);
      } else if (!(VALID_FILE_ACTIONS as readonly string[]).includes(file.action)) {
        errors.push(`files_modified[${i}]: invalid action '${file.action}'`);
      }
    });
  }

  // log validation
  if (!result.log) {
    errors.push('Missing required field: log');
  } else if (!Array.isArray(result.log)) {
    errors.push('Field log must be an array');
  } else {
    if (result.log.length < 2) {
      errors.push('Log must contain at least 2 entries');
    }
    result.log.forEach((entry: any, i: number) => {
      if (!entry.level) {
        errors.push(`log[${i}]: missing level`);
      } else if (!VALID_LOG_LEVELS.includes(entry.level)) {
        errors.push(`log[${i}]: invalid level '${entry.level}'`);
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
  if (result.issues !== undefined) {
    if (!Array.isArray(result.issues)) {
      errors.push('Field issues must be an array');
    } else {
      result.issues.forEach((issue: any, i: number) => {
        if (!issue.type) {
          errors.push(`issues[${i}]: missing type`);
        } else if (!(VALID_ISSUE_TYPES as readonly string[]).includes(issue.type)) {
          errors.push(`issues[${i}]: invalid type '${issue.type}'`);
        }
        if (!issue.description) {
          errors.push(`issues[${i}]: missing description`);
        }
      });
    }
  }

  // completed_at validation
  if (!result.completed_at) {
    errors.push('Missing required field: completed_at');
  }

  return errors;
}

/**
 * Create a mission object with defaults
 * @param {object} params - Mission parameters
 * @returns {object} Complete mission object
 */
export function createMission(params: any) {
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
      memory: params.memory || null,
      toolset: params.toolset || null
    },
    constraints: params.constraints || {},
    timeout: params.timeout || 0
  };
}

/**
 * Create a result object with defaults
 * @param {object} params - Result parameters
 * @returns {object} Complete result object
 */
export function createResult(params: any) {
  return {
    version: PROTOCOL_VERSION,
    task_id: params.task_id,
    status: params.status,
    files_modified: params.files_modified || [],
    log: params.log || [],
    issues: params.issues || [],
    completed_at: params.completed_at || new Date().toISOString()
  };
}

/**
 * Get the current protocol version
 */
export function getProtocolVersion() {
  return PROTOCOL_VERSION;
}
