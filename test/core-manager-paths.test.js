/**
 * Unit tests for Core Manager - Path Resolution
 *
 * Tests the path resolution system including:
 * - setProjectRoot behavior
 * - Path placeholder resolution (${haven}, ${project}, etc.)
 * - Cache invalidation on project root change
 * - Path overrides
 *
 * Run with: npm test (or node --test test/core-manager-paths.test.js)
 */
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

// Core manager functions under test
import {
  setProjectRoot as setCoreProjectRoot,
  findProjectRoot,
  getPath,
  getArtefactsDir,
  getAgentsDir,
  resolvePlaceholders,
  computeProjectHash,
  clearPathsCache,
  clearPlaceholderCache,
  setPathOverrides,
  resetPathOverrides,
  getPlaceholders
} from '../dist/cli/managers/core-manager.js';

// MCP manager - tests integration with core-manager
import {
  setProjectRoot as setMcpProjectRoot,
  getProjectRoot as getMcpProjectRoot
} from '../dist/cli/managers/mcp-manager.js';

// Alias for most tests
const setProjectRoot = setCoreProjectRoot;

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create minimal sailing project structure
 */
function createTestProject(baseDir, options = {}) {
  const sailingDir = path.join(baseDir, '.sailing');
  const havenDir = options.haven || path.join(sailingDir, 'haven');
  const artefactsDir = path.join(havenDir, 'artefacts');

  fs.mkdirSync(sailingDir, { recursive: true });
  fs.mkdirSync(artefactsDir, { recursive: true });
  fs.mkdirSync(path.join(artefactsDir, 'prds'), { recursive: true });
  fs.mkdirSync(path.join(artefactsDir, 'epics'), { recursive: true });
  fs.mkdirSync(path.join(artefactsDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(havenDir, 'agents'), { recursive: true });

  // Minimal config
  fs.writeFileSync(path.join(sailingDir, 'config.yaml'), 'version: 1\n');

  // State with counters
  fs.writeFileSync(
    path.join(havenDir, 'state.json'),
    JSON.stringify({ counters: { prd: 0, epic: 0, task: 0, story: 0 } })
  );

  return { sailingDir, havenDir, artefactsDir };
}

/**
 * Create paths.yaml with custom configuration
 */
function createPathsConfig(sailingDir, config) {
  fs.writeFileSync(
    path.join(sailingDir, 'paths.yaml'),
    `paths:\n${Object.entries(config.paths || {}).map(([k, v]) => `  ${k}: "${v}"`).join('\n')}\n` +
    (config.placeholders ? `placeholders:\n${Object.entries(config.placeholders).map(([k, v]) => `  ${k}: "${v}"`).join('\n')}\n` : '')
  );
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Core Manager - Path Resolution', () => {
  let testDir;
  let originalCwd;

  before(() => {
    originalCwd = process.cwd();
  });

  after(() => {
    process.chdir(originalCwd);
    resetPathOverrides();
  });

  beforeEach(() => {
    // Create fresh test directory for each test
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sailing-paths-test-'));
    clearPathsCache();
    resetPathOverrides();
  });

  afterEach(() => {
    clearPathsCache();
    resetPathOverrides();
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // setProjectRoot tests
  // --------------------------------------------------------------------------

  describe('setProjectRoot', () => {
    it('should set project root and clear caches', () => {
      const dirs = createTestProject(testDir);

      // Set project root
      setProjectRoot(testDir);

      // Verify findProjectRoot returns the set value
      const result = findProjectRoot();
      assert.strictEqual(result, testDir);
    });

    it('should override cached project root', () => {
      // Create two different projects
      const project1 = path.join(testDir, 'project1');
      const project2 = path.join(testDir, 'project2');

      createTestProject(project1);
      createTestProject(project2);

      // Set first project
      setProjectRoot(project1);
      assert.strictEqual(findProjectRoot(), project1);

      // Switch to second project
      setProjectRoot(project2);
      assert.strictEqual(findProjectRoot(), project2);
    });

    it('should invalidate path cache on project root change', () => {
      // Create two projects with different paths.yaml
      const project1 = path.join(testDir, 'project1');
      const project2 = path.join(testDir, 'project2');

      const dirs1 = createTestProject(project1);
      const dirs2 = createTestProject(project2);

      // Create paths.yaml with different artefacts paths
      createPathsConfig(dirs1.sailingDir, {
        paths: { artefacts: '.sailing/artefacts-one' }
      });
      createPathsConfig(dirs2.sailingDir, {
        paths: { artefacts: '.sailing/artefacts-two' }
      });

      // Set first project and get artefacts path
      setProjectRoot(project1);
      const artefacts1 = getArtefactsDir();
      assert.ok(artefacts1.includes('artefacts-one'), `Expected artefacts-one, got: ${artefacts1}`);

      // Switch to second project
      setProjectRoot(project2);
      const artefacts2 = getArtefactsDir();
      assert.ok(artefacts2.includes('artefacts-two'), `Expected artefacts-two, got: ${artefacts2}`);
    });
  });

  // --------------------------------------------------------------------------
  // Placeholder resolution tests
  // --------------------------------------------------------------------------

  describe('resolvePlaceholders', () => {
    it('should resolve ${project} placeholder', () => {
      createTestProject(testDir);
      setProjectRoot(testDir);
      clearPlaceholderCache();

      const result = resolvePlaceholders('${project}/foo/bar');
      assert.strictEqual(result, path.join(testDir, 'foo/bar'));
    });

    it('should resolve ${home} placeholder', () => {
      createTestProject(testDir);
      setProjectRoot(testDir);
      clearPlaceholderCache();

      const result = resolvePlaceholders('${home}/.config');
      assert.strictEqual(result, path.join(os.homedir(), '.config'));
    });

    it('should resolve ${haven} placeholder based on project hash', () => {
      createTestProject(testDir);
      setProjectRoot(testDir);
      clearPlaceholderCache();

      const hash = computeProjectHash();
      const expectedHaven = path.join(os.homedir(), '.sailing', 'havens', hash);

      const result = resolvePlaceholders('${haven}/agents');
      assert.strictEqual(result, path.join(expectedHaven, 'agents'));
    });

    it('should resolve nested placeholders', () => {
      const dirs = createTestProject(testDir);
      setProjectRoot(testDir);

      // Create paths.yaml with custom placeholder that uses ${project}
      createPathsConfig(dirs.sailingDir, {
        paths: {},
        placeholders: {
          custom_path: '${project}/custom'
        }
      });
      clearPlaceholderCache();

      const result = resolvePlaceholders('${custom_path}/sub');
      assert.strictEqual(result, path.join(testDir, 'custom/sub'));
    });

    it('should resolve ~/ shortcut', () => {
      createTestProject(testDir);
      setProjectRoot(testDir);
      clearPlaceholderCache();

      const result = resolvePlaceholders('~/foo/bar');
      assert.strictEqual(result, path.join(os.homedir(), 'foo/bar'));
    });
  });

  // --------------------------------------------------------------------------
  // getPath tests
  // --------------------------------------------------------------------------

  describe('getPath', () => {
    it('should return default path when no paths.yaml exists', () => {
      const dirs = createTestProject(testDir);
      setProjectRoot(testDir);

      // Remove paths.yaml if it exists
      const pathsYaml = path.join(dirs.sailingDir, 'paths.yaml');
      if (fs.existsSync(pathsYaml)) {
        fs.unlinkSync(pathsYaml);
      }
      clearPathsCache();

      const artefactsPath = getPath('artefacts');
      assert.strictEqual(artefactsPath, path.join(testDir, '.sailing/artefacts'));
    });

    it('should use configured path from paths.yaml', () => {
      const dirs = createTestProject(testDir);
      setProjectRoot(testDir);

      // Create paths.yaml with custom artefacts path
      createPathsConfig(dirs.sailingDir, {
        paths: { artefacts: '.custom-artefacts' }
      });
      clearPathsCache();

      const artefactsPath = getPath('artefacts');
      assert.strictEqual(artefactsPath, path.join(testDir, '.custom-artefacts'));
    });

    it('should resolve haven-based paths correctly', () => {
      createTestProject(testDir);
      setProjectRoot(testDir);
      clearPathsCache();

      const hash = computeProjectHash();
      const expectedHaven = path.join(os.homedir(), '.sailing', 'havens', hash);

      const agentsPath = getPath('agents');
      assert.strictEqual(agentsPath, path.join(expectedHaven, 'agents'));
    });
  });

  // --------------------------------------------------------------------------
  // Path overrides tests
  // --------------------------------------------------------------------------

  describe('setPathOverrides', () => {
    it('should override path from configuration', () => {
      const dirs = createTestProject(testDir);
      setProjectRoot(testDir);

      const customArtefacts = path.join(testDir, 'custom-artefacts');
      fs.mkdirSync(customArtefacts, { recursive: true });

      setPathOverrides({ artefacts: customArtefacts });

      const artefactsPath = getPath('artefacts');
      assert.strictEqual(artefactsPath, customArtefacts);
    });

    it('should take precedence over paths.yaml', () => {
      const dirs = createTestProject(testDir);
      setProjectRoot(testDir);

      // Create paths.yaml with one path
      createPathsConfig(dirs.sailingDir, {
        paths: { artefacts: '.yaml-artefacts' }
      });

      // Override with different path
      const overridePath = path.join(testDir, 'override-artefacts');
      setPathOverrides({ artefacts: overridePath });

      const artefactsPath = getPath('artefacts');
      assert.strictEqual(artefactsPath, overridePath);
    });
  });

  // --------------------------------------------------------------------------
  // Project hash tests
  // --------------------------------------------------------------------------

  describe('computeProjectHash', () => {
    it('should return consistent hash for same project', () => {
      createTestProject(testDir);
      setProjectRoot(testDir);
      clearPlaceholderCache();

      const hash1 = computeProjectHash();
      clearPlaceholderCache();
      const hash2 = computeProjectHash();

      assert.strictEqual(hash1, hash2);
      assert.strictEqual(hash1.length, 12);
    });

    it('should return different hash for different projects', () => {
      const project1 = path.join(testDir, 'project1');
      const project2 = path.join(testDir, 'project2');

      createTestProject(project1);
      createTestProject(project2);

      setProjectRoot(project1);
      clearPlaceholderCache();
      const hash1 = computeProjectHash();

      setProjectRoot(project2);
      clearPlaceholderCache();
      const hash2 = computeProjectHash();

      assert.notStrictEqual(hash1, hash2);
    });
  });

  // --------------------------------------------------------------------------
  // Cache isolation tests
  // --------------------------------------------------------------------------

  describe('Cache isolation', () => {
    it('should not leak paths between projects', () => {
      // This test reproduces the bug where MCP was reading from wrong project

      // Create two projects with different haven locations
      const project1 = path.join(testDir, 'project1');
      const project2 = path.join(testDir, 'project2');

      const haven1 = path.join(testDir, 'haven1');
      const haven2 = path.join(testDir, 'haven2');

      createTestProject(project1, { haven: haven1 });
      createTestProject(project2, { haven: haven2 });

      // Create paths.yaml pointing to specific havens
      createPathsConfig(path.join(project1, '.sailing'), {
        paths: {
          artefacts: haven1 + '/artefacts',
          agents: haven1 + '/agents'
        }
      });

      createPathsConfig(path.join(project2, '.sailing'), {
        paths: {
          artefacts: haven2 + '/artefacts',
          agents: haven2 + '/agents'
        }
      });

      // Set project 1 and read paths
      setProjectRoot(project1);
      clearPathsCache();
      const artefacts1 = getArtefactsDir();
      const agents1 = getAgentsDir();

      assert.ok(artefacts1.includes('haven1'), `Project1 artefacts should be in haven1: ${artefacts1}`);
      assert.ok(agents1.includes('haven1'), `Project1 agents should be in haven1: ${agents1}`);

      // Switch to project 2 - this is where the bug occurred
      setProjectRoot(project2);
      // Note: clearPathsCache should be called by setProjectRoot

      const artefacts2 = getArtefactsDir();
      const agents2 = getAgentsDir();

      assert.ok(artefacts2.includes('haven2'), `Project2 artefacts should be in haven2: ${artefacts2}`);
      assert.ok(agents2.includes('haven2'), `Project2 agents should be in haven2: ${agents2}`);

      // Critical: verify no cross-contamination
      assert.ok(!artefacts2.includes('haven1'), `Project2 should NOT use haven1`);
      assert.ok(!agents2.includes('haven1'), `Project2 should NOT use haven1`);
    });

    it('should clear placeholder cache when changing project root', () => {
      const project1 = path.join(testDir, 'project1');
      const project2 = path.join(testDir, 'project2');

      createTestProject(project1);
      createTestProject(project2);

      // Get placeholders for project 1
      setProjectRoot(project1);
      clearPlaceholderCache();
      const placeholders1 = getPlaceholders();

      // Get placeholders for project 2
      setProjectRoot(project2);
      clearPlaceholderCache();
      const placeholders2 = getPlaceholders();

      // Project paths should be different
      assert.notStrictEqual(placeholders1.builtin.project, placeholders2.builtin.project);
      assert.strictEqual(placeholders1.builtin.project, project1);
      assert.strictEqual(placeholders2.builtin.project, project2);
    });
  });

  // --------------------------------------------------------------------------
  // MCP scenario tests
  // --------------------------------------------------------------------------

  describe('MCP setProjectRoot scenario', () => {
    it('should correctly set paths when MCP starts with --project-root', () => {
      // Simulate MCP startup with --project-root flag
      const mcpProjectRoot = path.join(testDir, 'mcp-project');
      const mcpHaven = path.join(testDir, 'mcp-haven');

      createTestProject(mcpProjectRoot, { haven: mcpHaven });

      // Configure paths.yaml to use specific haven
      createPathsConfig(path.join(mcpProjectRoot, '.sailing'), {
        paths: {
          artefacts: mcpHaven + '/artefacts',
          agents: mcpHaven + '/agents',
          haven: mcpHaven
        }
      });

      // This is what MCP does on startup
      setProjectRoot(mcpProjectRoot);

      // Verify all paths point to correct haven
      const artefacts = getArtefactsDir();
      const agents = getAgentsDir();
      const haven = getPath('haven');

      assert.ok(artefacts.startsWith(mcpHaven), `Artefacts should be in MCP haven: ${artefacts}`);
      assert.ok(agents.startsWith(mcpHaven), `Agents should be in MCP haven: ${agents}`);
      assert.strictEqual(haven, mcpHaven);
    });
  });

  // --------------------------------------------------------------------------
  // MCP Manager integration tests
  // --------------------------------------------------------------------------

  describe('MCP Manager integration', () => {
    it('should propagate setProjectRoot to core-manager', () => {
      // This tests the fix for the bug where MCP had its own project root
      // that wasn't synchronized with core-manager
      const mcpProjectRoot = path.join(testDir, 'mcp-integration');
      const mcpHaven = path.join(testDir, 'mcp-integration-haven');

      createTestProject(mcpProjectRoot, { haven: mcpHaven });

      // Configure paths.yaml
      createPathsConfig(path.join(mcpProjectRoot, '.sailing'), {
        paths: {
          artefacts: mcpHaven + '/artefacts',
          agents: mcpHaven + '/agents'
        }
      });

      // Use MCP manager's setProjectRoot (as MCP conductor does)
      setMcpProjectRoot(mcpProjectRoot);

      // Verify MCP manager returns correct project root
      assert.strictEqual(getMcpProjectRoot(), mcpProjectRoot);

      // Verify core-manager also uses the same project root
      assert.strictEqual(findProjectRoot(), mcpProjectRoot);

      // Verify path resolution uses correct project
      const artefacts = getArtefactsDir();
      assert.ok(artefacts.startsWith(mcpHaven), `Artefacts should be in MCP haven: ${artefacts}`);
    });

    it('should clear caches when MCP changes project root', () => {
      // Create two projects
      const project1 = path.join(testDir, 'mcp-proj1');
      const project2 = path.join(testDir, 'mcp-proj2');
      const haven1 = path.join(testDir, 'haven1');
      const haven2 = path.join(testDir, 'haven2');

      createTestProject(project1, { haven: haven1 });
      createTestProject(project2, { haven: haven2 });

      createPathsConfig(path.join(project1, '.sailing'), {
        paths: { artefacts: haven1 + '/artefacts' }
      });
      createPathsConfig(path.join(project2, '.sailing'), {
        paths: { artefacts: haven2 + '/artefacts' }
      });

      // Set first project via MCP manager
      setMcpProjectRoot(project1);
      const artefacts1 = getArtefactsDir();
      assert.ok(artefacts1.includes('haven1'), `Should use haven1: ${artefacts1}`);

      // Switch project via MCP manager
      setMcpProjectRoot(project2);
      const artefacts2 = getArtefactsDir();
      assert.ok(artefacts2.includes('haven2'), `Should use haven2: ${artefacts2}`);

      // Verify no cross-contamination
      assert.ok(!artefacts2.includes('haven1'), `Should NOT use haven1 after switch`);
    });
  });
});
