/**
 * E2E Test: agent:spawn → agent:reap (worktree mode)
 *
 * Verifies the full agent lifecycle using a mock Claude that consumes zero tokens.
 * Creates an isolated project in /tmp with its own git repo and haven directory.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAILING_ROOT = path.resolve(__dirname, '../..');
const RUDDER = path.join(SAILING_ROOT, 'dist/cli/rudder.js');
const MOCK_CLAUDE = path.join(__dirname, 'mock-claude.sh');
const FIXTURES = path.join(__dirname, 'fixtures');

/** Run rudder with test environment */
function rudder(args, projectDir, havenDir, extraEnv = {}) {
  const cmd = [
    'node', RUDDER,
    '--root', projectDir,
    '--with-path', `haven=${havenDir}`,
    '--with-config', 'agent.sandbox=true',
    '--with-config', 'agent.use_worktrees=true',
    '--with-config', 'agent.risky_mode=true',
    '--with-config', 'agent.auto_merge=false',
    '--with-config', 'agent.auto_pr=false',
    '--with-config', 'agent.auto_diagnose=false',
    '--with-config', 'agent.watchdog_timeout=0',
    '--with-config', 'agent.timeout=30',
    '--with-config', 'git.sync_before_spawn=false',
    ...args
  ].join(' ');

  const mockBinDir = path.dirname(MOCK_CLAUDE);

  return execSync(cmd, {
    cwd: projectDir,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      // Prepend mock-claude dir to PATH so 'claude' resolves to our mock
      PATH: `${mockBinDir}:${process.env.PATH}`,
      // Override HOME to avoid polluting real config
      SAILING_PROJECT: projectDir,
      ...extraEnv
    }
  });
}

/** Copy directory recursively */
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

describe('E2E: agent:spawn → agent:reap (worktree mode)', () => {
  let tmpDir;
  let projectDir;
  let havenDir;
  let computedHaven;

  before(() => {
    // Create isolated temp directory
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sailing-e2e-'));
    projectDir = path.join(tmpDir, 'project');
    havenDir = path.join(tmpDir, 'haven');

    // Copy fixtures to project
    copyDir(FIXTURES, projectDir);

    // Create haven directory (subdirs are auto-created by rudder)
    fs.mkdirSync(havenDir, { recursive: true });

    // Create fake mcp-state.json so spawn doesn't block on "MCP server not running"
    // spawn uses resolvePlaceholders('${haven}') which computes haven from project hash,
    // NOT from --with-path override. So we must put it in the computed haven too.
    const projectHash = createHash('sha256')
      .update(fs.realpathSync(projectDir))
      .digest('hex')
      .substring(0, 12);
    computedHaven = path.join(os.homedir(), '.sailing', 'havens', projectHash);

    const mcpState = {
      agent: {
        pid: process.pid,
        socket: path.join(havenDir, 'fake-mcp.sock'),
        mode: 'socket'
      }
    };

    // Write to both computed haven and override haven
    for (const dir of [havenDir, computedHaven]) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'mcp-state.json'), JSON.stringify(mcpState));
    }

    // Make mock-claude available as 'claude' and 'srt' in PATH
    // (sandbox mode uses 'srt' instead of 'claude')
    const mockBinDir = path.dirname(MOCK_CLAUDE);
    for (const name of ['claude', 'srt']) {
      const link = path.join(mockBinDir, name);
      if (!fs.existsSync(link)) {
        fs.symlinkSync(MOCK_CLAUDE, link);
      }
    }

    // Initialize git repo in project (use 'main' branch to match config)
    execSync('git init -b main && git add -A && git commit -m "Initial commit" --no-verify', {
      cwd: projectDir,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@test.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@test.com',
      }
    });
  });

  after(() => {
    // Cleanup symlinks
    for (const name of ['claude', 'srt']) {
      const link = path.join(path.dirname(MOCK_CLAUDE), name);
      if (fs.existsSync(link)) {
        fs.unlinkSync(link);
      }
    }

    // Cleanup temp directory
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    // Cleanup computed haven (created outside tmpDir)
    if (computedHaven && fs.existsSync(computedHaven)) {
      fs.rmSync(computedHaven, { recursive: true, force: true });
    }
  });

  it('should spawn an agent in worktree mode', () => {
    let output;
    try {
      output = rudder(['agent:spawn', 'T001'], projectDir, havenDir);
    } catch (e) {
      // agent:spawn may exit non-zero if reap fails, check stdout
      output = e.stdout || '';
      // Re-throw if no output at all
      if (!output) throw e;
    }

    // Agent dir may be in the override haven or the computed haven
    // (spawn uses getPath('agents') which resolves via --with-path haven → ${haven}/agents,
    //  but the actual resolution may use computed haven for some operations)
    // All agent data goes to the computed haven (--with-path haven doesn't override placeholder resolution)
    const agentDir = path.join(computedHaven, 'agents', 'T001');
    assert.ok(fs.existsSync(agentDir), 'Agent directory should exist');

    // Verify mission.yaml was written
    const missionPath = path.join(agentDir, 'mission.yaml');
    assert.ok(fs.existsSync(missionPath), 'mission.yaml should exist');
    const mission = fs.readFileSync(missionPath, 'utf8');
    assert.ok(mission.includes('task_id') && mission.includes('T001'), 'Mission should reference T001');

    // Check agent DB in computed haven
    const dbPath = path.join(computedHaven, 'db', 'agents.json');
    if (fs.existsSync(dbPath)) {
      const dbContent = fs.readFileSync(dbPath, 'utf8');
      assert.ok(dbContent.includes('T001') || dbContent.includes('"taskNum":1'),
        'Agent should be registered in DB');
    }

    // Verify result.yaml was written by mock claude
    const resultPath = path.join(agentDir, 'result.yaml');
    assert.ok(fs.existsSync(resultPath), 'result.yaml should exist');
    const result = fs.readFileSync(resultPath, 'utf8');
    assert.ok(result.includes('status: completed'), 'Result should show completed');
  });

  it('should reap the agent and merge worktree changes', () => {
    let output;
    try {
      output = rudder(['agent:reap', 'T001'], projectDir, havenDir);
    } catch (e) {
      output = e.stdout || '';
      if (!output) throw e;
    }

    // Verify mock-output.txt was merged into main branch
    const mockFile = path.join(projectDir, 'mock-output.txt');
    assert.ok(fs.existsSync(mockFile), 'mock-output.txt should be merged into project');

    // Verify the file content
    const content = fs.readFileSync(mockFile, 'utf8');
    assert.ok(content.includes('mock-claude'), 'File should contain mock-claude content');

    // Verify task status was updated to Done
    const taskPath = path.join(projectDir, '.sailing/artefacts/prds/PRD-001/tasks/T001.md');
    const taskContent = fs.readFileSync(taskPath, 'utf8');
    assert.ok(taskContent.includes('status: Done') || taskContent.includes("status: 'Done'"),
      `Task should be marked Done, got: ${taskContent.slice(0, 200)}`);

    // Verify agent DB was updated
    const reapDbPath = path.join(computedHaven, 'db', 'agents.json');
    if (fs.existsSync(reapDbPath)) {
      const dbContent = fs.readFileSync(reapDbPath, 'utf8');
      assert.ok(dbContent.includes('reaped'), 'Agent status should be reaped in DB');
    }
  });
});
