/**
 * Unit tests for MCP Conductor Artefact Tools
 *
 * Tests MCP tool handlers in isolation with temporary project directory.
 * Run with: npm test (or node --test test/mcp-conductor.test.js)
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Core manager - path overrides
import {
  setProjectRoot,
  setPathOverrides,
  resetPathOverrides,
  clearPathsCache
} from '../dist/cli/managers/core-manager.js';

// Artefacts manager - cache clearing
import { clearCache } from '../dist/cli/managers/artefacts-manager.js';

// MCP tools under test
import { ARTEFACT_TOOLS } from '../dist/cli/managers/mcp-tools-manager/conductor/artefact.js';

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Find tool by name
 */
function getTool(name) {
  return ARTEFACT_TOOLS.find(t => t.tool.name === name);
}

/**
 * Extract result from MCP response
 */
function parseResult(result) {
  const text = result.content[0].text;
  return JSON.parse(text);
}

/**
 * Create minimal sailing project structure
 */
function createTestProject(baseDir) {
  const sailingDir = path.join(baseDir, '.sailing');
  const havenDir = path.join(sailingDir, 'haven');
  const prdsDir = path.join(havenDir, 'artefacts', 'prds');

  fs.mkdirSync(prdsDir, { recursive: true });
  fs.mkdirSync(path.join(havenDir, 'artefacts', 'epics'), { recursive: true });
  fs.mkdirSync(path.join(havenDir, 'artefacts', 'tasks'), { recursive: true });

  // Minimal config
  fs.writeFileSync(path.join(sailingDir, 'config.yaml'), 'version: 1\n');

  // State with counters
  fs.writeFileSync(
    path.join(havenDir, 'state.json'),
    JSON.stringify({ counters: { prd: 0, epic: 0, task: 0, story: 0 } })
  );

  return { sailingDir, havenDir, prdsDir };
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('MCP Conductor - Artefact Tools', () => {
  let testDir;
  let havenDir;
  let prdsDir;

  before(() => {
    // Create isolated test project
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sailing-mcp-test-'));
    const dirs = createTestProject(testDir);
    havenDir = dirs.havenDir;
    prdsDir = dirs.prdsDir;

    // Override paths to use test directory
    setProjectRoot(testDir);
    setPathOverrides({
      haven: havenDir,
      artefacts: path.join(havenDir, 'artefacts'),
      state: path.join(havenDir, 'state.json')
    });
    clearCache();
  });

  after(() => {
    // Cleanup
    resetPathOverrides();
    clearCache();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Clear artefacts cache between tests
    clearCache();
  });

  // --------------------------------------------------------------------------
  // artefact_create tests
  // --------------------------------------------------------------------------

  describe('artefact_create', () => {
    it('should create PRD with simple title', async () => {
      const tool = getTool('artefact_create');
      const result = await tool.handler({
        type: 'prd',
        title: 'Test PRD'
      });

      const parsed = parseResult(result);
      assert.strictEqual(parsed.success, true);
      assert.strictEqual(parsed.data.id, 'PRD-001');
      assert.strictEqual(parsed.data.title, 'Test PRD');

      // Verify file was created
      const prdFile = parsed.data.file;
      assert.ok(fs.existsSync(prdFile), 'PRD file should exist');

      const content = fs.readFileSync(prdFile, 'utf8');
      assert.ok(content.includes('title: Test PRD'), 'Title should be in frontmatter');
    });

    it('should create PRD with accented characters', async () => {
      const tool = getTool('artefact_create');
      const title = 'Cave à Vin - Application de gestion';

      const result = await tool.handler({
        type: 'prd',
        title
      });

      const parsed = parseResult(result);
      assert.strictEqual(parsed.success, true);
      assert.strictEqual(parsed.data.title, title);

      // Verify file content
      const content = fs.readFileSync(parsed.data.file, 'utf8');
      assert.ok(content.includes(`title: ${title}`), 'Accented title should be preserved');

      // Verify directory name (kebab-case, accents stripped)
      const dirName = path.basename(path.dirname(parsed.data.file));
      assert.ok(dirName.includes('cave-vin'), 'Directory should be kebab-case');
    });

    it('should create PRD with special characters in title', async () => {
      const tool = getTool('artefact_create');
      const title = 'Test: "Quotes" & Symbols <>';

      const result = await tool.handler({
        type: 'prd',
        title
      });

      const parsed = parseResult(result);
      assert.strictEqual(parsed.success, true);
      assert.strictEqual(parsed.data.title, title);

      // Verify YAML serialization handles special chars
      const content = fs.readFileSync(parsed.data.file, 'utf8');
      // YAML should quote or escape the title
      assert.ok(
        content.includes(title) || content.includes("'Test:"),
        'Special characters should be properly serialized'
      );
    });

    it('should create PRD with very long title', async () => {
      const tool = getTool('artefact_create');
      const title = 'A'.repeat(200) + ' - Very Long Title Test';

      const result = await tool.handler({
        type: 'prd',
        title
      });

      const parsed = parseResult(result);
      assert.strictEqual(parsed.success, true);
      assert.strictEqual(parsed.data.title, title);
    });

    it('should reject PRD creation without title', async () => {
      const tool = getTool('artefact_create');

      const result = await tool.handler({
        type: 'prd'
        // missing title
      });

      const parsed = parseResult(result);
      // Should fail or have error
      assert.ok(!parsed.success || parsed.error, 'Should fail without title');
    });
  });

  // --------------------------------------------------------------------------
  // artefact_edit tests
  // --------------------------------------------------------------------------

  describe('artefact_edit', () => {
    it('should edit PRD with multi-section content', async () => {
      // First create a PRD
      const createTool = getTool('artefact_create');
      const createResult = await createTool.handler({
        type: 'prd',
        title: 'Edit Test PRD'
      });
      const created = parseResult(createResult);
      assert.strictEqual(created.success, true);

      // Now edit it
      const editTool = getTool('artefact_edit');
      const editResult = await editTool.handler({
        id: created.data.id,
        content: '## Summary\n\nThis is the summary.\n\n## Goals\n\n- Goal 1\n- Goal 2'
      });

      const edited = parseResult(editResult);
      assert.strictEqual(edited.success, true);

      // Verify content was updated
      const content = fs.readFileSync(created.data.file, 'utf8');
      assert.ok(content.includes('This is the summary'), 'Summary should be updated');
      assert.ok(content.includes('- Goal 1'), 'Goals should be updated');
    });
  });

  // --------------------------------------------------------------------------
  // artefact_show tests
  // --------------------------------------------------------------------------

  describe('artefact_show', () => {
    it('should show PRD details', async () => {
      // Create a PRD first
      const createTool = getTool('artefact_create');
      const createResult = await createTool.handler({
        type: 'prd',
        title: 'Show Test PRD'
      });
      const created = parseResult(createResult);

      // Show it
      const showTool = getTool('artefact_show');
      const showResult = await showTool.handler({
        id: created.data.id,
        raw: true
      });

      const shown = parseResult(showResult);
      assert.strictEqual(shown.success, true);
      assert.strictEqual(shown.data.title, 'Show Test PRD');
      assert.ok(shown.data.body, 'Should include body when raw=true');
    });
  });
});
