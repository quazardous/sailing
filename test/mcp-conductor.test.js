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
      assert.ok(dirName.includes('cave-a-vin'), 'Directory should be kebab-case');
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

    it('should add new section when it does not exist', async () => {
      // First create a PRD (template has: Problem Statement, Goals, Non-Goals, Solution Overview)
      const createTool = getTool('artefact_create');
      const createResult = await createTool.handler({
        type: 'prd',
        title: 'New Section Test PRD'
      });
      const created = parseResult(createResult);
      assert.strictEqual(created.success, true);

      // Edit with a section that doesn't exist in template
      const editTool = getTool('artefact_edit');
      const editResult = await editTool.handler({
        id: created.data.id,
        content: '## Technical Approach\n\nThis is the technical approach.\n\n### Key Decisions\n\n- Decision 1'
      });

      const edited = parseResult(editResult);
      assert.strictEqual(edited.success, true);

      // Verify new section was added
      const content = fs.readFileSync(created.data.file, 'utf8');
      assert.ok(content.includes('## Technical Approach'), 'New section should be added');
      assert.ok(content.includes('This is the technical approach'), 'Section content should be present');
      assert.ok(content.includes('- Decision 1'), 'Subsection content should be present');
    });

    it('should find PRD by ID regardless of directory name', async () => {
      // Create a PRD, then manually rename its directory to simulate corrupted title
      const createTool = getTool('artefact_create');
      const createResult = await createTool.handler({
        type: 'prd',
        title: 'Original Title for Rename Test'
      });
      const created = parseResult(createResult);
      assert.strictEqual(created.success, true);

      const originalDir = path.dirname(created.data.file);
      const prdNum = created.data.id.match(/PRD-(\d+)/)[1];
      const newDir = path.join(path.dirname(originalDir), `PRD-${prdNum.padStart(3, '0')}-corrupted-name`);

      // Rename directory to simulate corrupted state
      fs.renameSync(originalDir, newDir);
      clearCache(); // Clear cache so index is rebuilt

      // Now edit by ID - should still find it
      const editTool = getTool('artefact_edit');
      const editResult = await editTool.handler({
        id: created.data.id,
        content: '## Summary\n\nEdited after rename.'
      });

      const edited = parseResult(editResult);
      assert.strictEqual(edited.success, true, 'Edit should succeed even with renamed directory');

      // Verify content was updated
      const content = fs.readFileSync(path.join(newDir, 'prd.md'), 'utf8');
      assert.ok(content.includes('Edited after rename'), 'Content should be updated');
    });
  });

  // --------------------------------------------------------------------------
  // artefact_edit - patch mode tests
  // --------------------------------------------------------------------------

  describe('artefact_edit - patch mode', () => {
    let patchPrdId;
    let patchPrdFile;

    before(async () => {
      // Create a PRD with known content for patch tests
      const createTool = getTool('artefact_create');
      const createResult = await createTool.handler({
        type: 'prd',
        title: 'Patch Mode Test PRD'
      });
      const created = parseResult(createResult);
      patchPrdId = created.data.id;
      patchPrdFile = created.data.file;

      // Add sections with known content
      const editTool = getTool('artefact_edit');
      await editTool.handler({
        id: patchPrdId,
        content: '## Summary\n\nThis is the original summary text.\n\n## Open Questions\n\n- [ ] Question obsolète\n- [ ] Another question\n- Item alpha beta gamma'
      });
      clearCache();
    });

    it('should patch a word in a section (old_string/new_string + section)', async () => {
      const editTool = getTool('artefact_edit');
      const result = await editTool.handler({
        id: patchPrdId,
        old_string: 'original summary',
        new_string: 'updated summary',
        section: 'Summary'
      });

      const parsed = parseResult(result);
      assert.strictEqual(parsed.success, true);

      const content = fs.readFileSync(patchPrdFile, 'utf8');
      assert.ok(content.includes('updated summary text'), 'Should have patched the word');
      assert.ok(!content.includes('original summary'), 'Should no longer contain old text');
    });

    it('should patch without section (search in full body)', async () => {
      const editTool = getTool('artefact_edit');
      const result = await editTool.handler({
        id: patchPrdId,
        old_string: 'Another question',
        new_string: 'A different question'
      });

      const parsed = parseResult(result);
      assert.strictEqual(parsed.success, true);

      const content = fs.readFileSync(patchPrdFile, 'utf8');
      assert.ok(content.includes('A different question'), 'Should have patched in full body');
      assert.ok(!content.includes('Another question'), 'Should no longer contain old text');
    });

    it('should error when old_string not found', async () => {
      const editTool = getTool('artefact_edit');
      const result = await editTool.handler({
        id: patchPrdId,
        old_string: 'text that does not exist anywhere',
        new_string: 'replacement'
      });

      const parsed = parseResult(result);
      assert.strictEqual(parsed.success, false);
      assert.ok(parsed.error.includes('not found'), 'Should report not found error');
    });

    it('should error when old_string === new_string', async () => {
      const editTool = getTool('artefact_edit');
      const result = await editTool.handler({
        id: patchPrdId,
        old_string: 'same text',
        new_string: 'same text'
      });

      const parsed = parseResult(result);
      assert.strictEqual(parsed.success, false);
      assert.ok(parsed.error.includes('identical'), 'Should report identical strings error');
    });

    it('should patch with multiline old_string/new_string', async () => {
      const editTool = getTool('artefact_edit');
      const result = await editTool.handler({
        id: patchPrdId,
        old_string: '- [ ] Question obsolète',
        new_string: '- [x] Question résolue',
        section: 'Open Questions'
      });

      const parsed = parseResult(result);
      assert.strictEqual(parsed.success, true);

      const content = fs.readFileSync(patchPrdFile, 'utf8');
      assert.ok(content.includes('- [x] Question résolue'), 'Should have patched checkbox');
      assert.ok(!content.includes('Question obsolète'), 'Should no longer contain old checkbox');
    });

    it('should patch using regexp mode', async () => {
      const editTool = getTool('artefact_edit');
      const result = await editTool.handler({
        id: patchPrdId,
        old_string: 'alpha \\w+ gamma',
        new_string: 'alpha delta gamma',
        regexp: true
      });

      const parsed = parseResult(result);
      assert.strictEqual(parsed.success, true);

      const content = fs.readFileSync(patchPrdFile, 'utf8');
      assert.ok(content.includes('alpha delta gamma'), 'Should have applied regex patch');
    });

    it('should error when regexp pattern not found', async () => {
      const editTool = getTool('artefact_edit');
      const result = await editTool.handler({
        id: patchPrdId,
        old_string: 'zzz\\d{5}zzz',
        new_string: 'replacement',
        regexp: true,
        section: 'Summary'
      });

      const parsed = parseResult(result);
      assert.strictEqual(parsed.success, false);
      assert.ok(parsed.error.includes('not found'), 'Should report not found for regexp');
    });

    it('should return context lines around the patch', async () => {
      const editTool = getTool('artefact_edit');
      const result = await editTool.handler({
        id: patchPrdId,
        old_string: 'updated summary',
        new_string: 'refined summary'
      });

      const parsed = parseResult(result);
      assert.strictEqual(parsed.success, true);
      assert.ok(parsed.data.context, 'Should include context');
      assert.ok(parsed.data.context.includes('refined summary'), 'Context should contain the new text');
    });

    it('should error when content is missing and not in patch mode', async () => {
      const editTool = getTool('artefact_edit');
      const result = await editTool.handler({
        id: patchPrdId
        // no content, no old_string/new_string
      });

      const parsed = parseResult(result);
      assert.strictEqual(parsed.success, false);
      assert.ok(parsed.error.includes('content'), 'Should require content or patch params');
    });
  });

  // --------------------------------------------------------------------------
  // artefact_show tests
  // --------------------------------------------------------------------------

  describe('artefact_show', () => {
    let showPrdId;

    before(async () => {
      // Create a PRD with sections for show tests
      const createTool = getTool('artefact_create');
      const createResult = await createTool.handler({
        type: 'prd',
        title: 'Show Test PRD'
      });
      const created = parseResult(createResult);
      showPrdId = created.data.id;

      // Add known sections
      const editTool = getTool('artefact_edit');
      await editTool.handler({
        id: showPrdId,
        content: '## Summary\n\nShort summary here.\n\n## Open Questions\n\n- Question A\n- Question B'
      });
      clearCache();
    });

    it('should show PRD details with raw body', async () => {
      const showTool = getTool('artefact_show');
      const showResult = await showTool.handler({
        id: showPrdId,
        raw: true
      });

      const shown = parseResult(showResult);
      assert.strictEqual(shown.success, true);
      assert.strictEqual(shown.data.title, 'Show Test PRD');
      assert.ok(shown.data.body, 'Should include body when raw=true');
    });

    it('should return only requested section', async () => {
      const showTool = getTool('artefact_show');
      const showResult = await showTool.handler({
        id: showPrdId,
        section: 'Open Questions'
      });

      const shown = parseResult(showResult);
      assert.strictEqual(shown.success, true);
      assert.strictEqual(shown.data.section, 'Open Questions');
      assert.ok(shown.data.body.includes('Question A'), 'Should contain section content');
      assert.ok(!shown.data.body.includes('Short summary'), 'Should NOT contain other sections');
    });

    it('should error when section not found in show', async () => {
      const showTool = getTool('artefact_show');
      const showResult = await showTool.handler({
        id: showPrdId,
        section: 'Nonexistent Section'
      });

      const shown = parseResult(showResult);
      assert.strictEqual(shown.success, false);
      assert.ok(shown.error.includes('not found'), 'Should report section not found');
    });
  });
});
