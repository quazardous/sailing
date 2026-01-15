/**
 * Agent Context Detection
 *
 * Detects whether CLI is running in main mode or agent mode
 * Agent mode: running in a git worktree with a mission.yaml present
 */
import fs from 'fs';
import path from 'path';
import { execaSync } from 'execa';
import { findProjectRoot } from '../managers/core-manager.js';
import { resolvePlaceholders } from '../managers/core-manager.js';

type MissionInfo = {
  taskId: string;
  missionPath: string;
  agentDir: string;
};

type ModeInfo =
  | { mode: 'agent'; taskId: string; missionPath: string; agentDir: string; projectRoot: string }
  | { mode: 'main'; projectRoot: string };

/**
 * Check if current directory is a git worktree
 * @returns {{ isWorktree: boolean, mainPath?: string }}
 */
function checkGitWorktree(): { isWorktree: boolean; mainPath?: string } {
  try {
    const commonDirResult = execaSync('git', ['rev-parse', '--git-common-dir'], { reject: false });
    if (commonDirResult.exitCode !== 0) return { isWorktree: false };
    const commonDir = String(commonDirResult.stdout).trim();

    const gitDirResult = execaSync('git', ['rev-parse', '--git-dir'], { reject: false });
    if (gitDirResult.exitCode !== 0) return { isWorktree: false };
    const gitDir = String(gitDirResult.stdout).trim();

    // If git-common-dir != git-dir, we're in a worktree
    const isWorktree = commonDir !== gitDir && commonDir !== '.git';

    if (isWorktree) {
      // Main repo is parent of git-common-dir
      const mainPath = path.dirname(commonDir);
      return { isWorktree: true, mainPath };
    }

    return { isWorktree: false };
  } catch {
    return { isWorktree: false };
  }
}

/**
 * Find mission file for current context
 * Checks: haven agents folder, current directory, worktree parent
 */
function findMissionFile(): MissionInfo | null {
  const projectRoot = findProjectRoot();

  // Check for mission.yaml in agent folder pattern
  // If we're in a worktree at ${haven}/agents/TNNN/worktree
  // mission.yaml would be at ${haven}/agents/TNNN/mission.yaml
  const cwd = process.cwd();
  const cwdParts = cwd.split(path.sep);

  // Look for agents/<TNNN> pattern in path
  for (let i = 0; i < cwdParts.length - 1; i++) {
    if (cwdParts[i] === 'agents' && /^T\d+$/.test(cwdParts[i + 1])) {
      const agentDir = cwdParts.slice(0, i + 2).join(path.sep);
      const missionPath = path.join(agentDir, 'mission.yaml');
      if (fs.existsSync(missionPath)) {
        return {
          taskId: cwdParts[i + 1],
          missionPath,
          agentDir
        };
      }
    }
  }

  // Check if we're in a worktree and the parent has mission.yaml
  const worktreeInfo = checkGitWorktree();
  if (worktreeInfo.isWorktree) {
    // Worktree might be at ${haven}/agents/TNNN/worktree
    // Mission would be at ${haven}/agents/TNNN/mission.yaml
    const worktreeParent = path.dirname(projectRoot);
    const missionPath = path.join(worktreeParent, 'mission.yaml');
    if (fs.existsSync(missionPath)) {
      const taskId = path.basename(worktreeParent);
      if (/^T\d+$/.test(taskId)) {
        return {
          taskId,
          missionPath,
          agentDir: worktreeParent
        };
      }
    }
  }

  return null;
}

/**
 * Detect execution mode
 * @returns {{ mode: 'main'|'agent', taskId?: string, missionPath?: string, agentDir?: string, projectRoot: string }}
 */
export function detectMode(): ModeInfo {
  const projectRoot = findProjectRoot();
  const missionInfo = findMissionFile();

  if (missionInfo) {
    return {
      mode: 'agent',
      taskId: missionInfo.taskId,
      missionPath: missionInfo.missionPath,
      agentDir: missionInfo.agentDir,
      projectRoot
    };
  }

  return {
    mode: 'main',
    projectRoot
  };
}

/**
 * Check if running in agent mode
 * @returns {boolean}
 */
export function isAgentMode(): boolean {
  return detectMode().mode === 'agent';
}

/**
 * Get agent info if in agent mode
 * @returns {{ taskId: string, missionPath: string, agentDir: string } | null}
 */
export function getAgentInfo(): MissionInfo | null {
  const mode = detectMode();
  if (mode.mode === 'agent') {
    return {
      taskId: mode.taskId,
      missionPath: mode.missionPath,
      agentDir: mode.agentDir
    };
  }
  return null;
}
