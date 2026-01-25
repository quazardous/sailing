/**
 * Agent path utilities
 * Pure path operations for agent directory conventions.
 */
import path from 'path';
/**
 * Format taskNum to taskId string
 * @param taskNum - Numeric task ID
 * @param digits - Number of digits to pad (default: 3)
 * @returns formatted task ID (e.g., "T005")
 */
export function formatTaskId(taskNum, digits = 3) {
    return `T${String(taskNum).padStart(digits, '0')}`;
}
/**
 * Parse taskId string to taskNum
 * @param taskId - Task ID string (T005, T5, T0005, etc.)
 * @returns numeric part as number, or null if invalid
 */
export function parseTaskNum(taskId) {
    if (!taskId)
        return null;
    const match = taskId.match(/^T(\d+)$/i);
    if (!match)
        return null;
    return parseInt(match[1], 10);
}
/**
 * Get agent directory path from haven and taskNum
 * @param haven - Haven directory path
 * @param taskNum - Numeric task ID
 * @param digits - Number of digits for task ID (default: 3)
 * @returns agent directory path
 */
export function getAgentDirPath(haven, taskNum, digits = 3) {
    const taskId = formatTaskId(taskNum, digits);
    return path.join(haven, 'agents', taskId);
}
/**
 * Derive mission file path from agent directory
 */
export function getMissionFilePath(agentDir) {
    return path.join(agentDir, 'MISSION.md');
}
/**
 * Derive log file path from agent directory
 */
export function getLogFilePath(agentDir) {
    return path.join(agentDir, 'agent.log');
}
/**
 * Derive SRT config file path from agent directory
 */
export function getSrtConfigPath(agentDir) {
    return path.join(agentDir, 'srt-config.json');
}
/**
 * Derive MCP config file path from agent directory
 */
export function getMcpConfigPath(agentDir) {
    return path.join(agentDir, 'mcp.json');
}
/**
 * Extract taskNum from agent directory path
 * @param agentDir - Agent directory path (e.g., /home/.../.haven/agents/T005)
 * @returns taskNum or null if not parseable
 */
export function extractTaskNumFromDir(agentDir) {
    const basename = path.basename(agentDir);
    return parseTaskNum(basename);
}
