/**
 * Tests for HTML comment validation
 *
 * Run: npx tsx tests/html-comments.test.ts
 *
 * This test specifically checks for the bug where HTML comment closing tags (-->)
 * get removed during artefact editing, corrupting the file.
 */

import { validateHtmlComments, assertValidHtmlComments } from '../lib/strings.js';
import { editArtifact, parseMarkdownSections, serializeSections } from '../lib/artifact.js';
import { saveFile } from '../managers/fileio-manager.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Test utilities
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}`);
    console.error(`  ${(e as Error).message}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

// =============================================================================
// validateHtmlComments tests
// =============================================================================

test('validateHtmlComments: properly closed comment is valid', () => {
  const content = `# Title\n\n<!-- This is a comment -->\n\nContent`;
  const result = validateHtmlComments(content);
  assert(result.valid === true, 'Should be valid');
  assertEqual(result.unclosedAt.length, 0);
});

test('validateHtmlComments: multiple closed comments are valid', () => {
  const content = `<!-- Comment 1 -->\n\n## Section\n\n<!-- Comment 2 -->\n`;
  const result = validateHtmlComments(content);
  assert(result.valid === true, 'Should be valid');
});

test('validateHtmlComments: unclosed comment is invalid', () => {
  const content = `# Title\n\n<!-- This comment is not closed\n\nContent`;
  const result = validateHtmlComments(content);
  assert(result.valid === false, 'Should be invalid');
  assertEqual(result.unclosedAt.length, 1);
});

test('validateHtmlComments: detects position of unclosed comment', () => {
  const content = `Line 1\nLine 2\n<!-- unclosed`;
  const result = validateHtmlComments(content);
  assert(result.valid === false, 'Should be invalid');
  // Position should be at the start of <!--
  assert(result.unclosedAt[0] > 0, 'Position should be after first two lines');
});

test('validateHtmlComments: no comments is valid', () => {
  const content = `# Title\n\nNo comments here`;
  const result = validateHtmlComments(content);
  assert(result.valid === true, 'Should be valid');
});

test('validateHtmlComments: multiline closed comment is valid', () => {
  const content = `<!--\nMCP instruction\nartefact_edit { ... }\n-->\n\n## Section`;
  const result = validateHtmlComments(content);
  assert(result.valid === true, 'Should be valid');
});

// =============================================================================
// assertValidHtmlComments tests
// =============================================================================

test('assertValidHtmlComments: throws on unclosed comment', () => {
  const content = `<!-- unclosed comment`;
  let threw = false;
  try {
    assertValidHtmlComments(content, 'test');
  } catch (e) {
    threw = true;
    assert((e as Error).message.includes('Unclosed HTML comment'), 'Error should mention unclosed comment');
    assert((e as Error).message.includes('test'), 'Error should include context');
  }
  assert(threw, 'Should have thrown');
});

test('assertValidHtmlComments: does not throw on valid content', () => {
  const content = `<!-- valid --> content`;
  assertValidHtmlComments(content, 'test'); // Should not throw
});

// =============================================================================
// parseMarkdownSections + serializeSections preserves comments
// =============================================================================

test('parseMarkdownSections preserves preamble with comment', () => {
  const content = `---
id: PRD-001
---

<!--
MCP instruction here
-->

## Section 1

Content
`;
  const parsed = parseMarkdownSections(content);
  assert(parsed.preamble.includes('<!--'), 'Preamble should contain opening tag');
  assert(parsed.preamble.includes('-->'), 'Preamble should contain closing tag');
});

test('serializeSections preserves comment in preamble', () => {
  const content = `---
id: PRD-001
---

<!--
MCP instruction
-->

## Section 1

Content
`;
  const parsed = parseMarkdownSections(content);
  const serialized = serializeSections(parsed);

  const validation = validateHtmlComments(serialized);
  assert(validation.valid === true, `Serialized content should have valid comments, got unclosed at: ${validation.unclosedAt}`);
});

// =============================================================================
// editArtifact refuses to write unclosed comments
// =============================================================================

test('editArtifact detects unclosed comment in result', () => {
  // Create temp file
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sailing-test-'));
  const tmpFile = path.join(tmpDir, 'test.md');

  fs.writeFileSync(tmpFile, `---
id: T001
---

## Section

Content
`);

  // Edit that would result in unclosed comment
  const result = editArtifact(tmpFile, [{
    op: 'replace',
    section: 'Section',
    content: '<!-- This comment is not closed\n\nNew content'
  }]);

  assert(result.success === false, 'Should detect the issue');
  assert(result.errors.length > 0, 'Should have errors');
  assert(result.errors[0].includes('Unclosed HTML comment'), `Error should mention unclosed comment: ${result.errors[0]}`);

  // Verify artefact was NOT modified
  const fileContent = fs.readFileSync(tmpFile, 'utf8');
  assert(!fileContent.includes('New content'), 'Artefact should not have been modified');

  // Cleanup
  fs.unlinkSync(tmpFile);
  fs.rmdirSync(tmpDir);
});

test('editArtifact allows valid content with closed comments', () => {
  // Create temp file
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sailing-test-'));
  const tmpFile = path.join(tmpDir, 'test.md');

  fs.writeFileSync(tmpFile, `---
id: T001
---

## Section

Content
`);

  // Edit with valid comment
  const result = editArtifact(tmpFile, [{
    op: 'replace',
    section: 'Section',
    content: '<!-- Valid comment -->\n\nNew content'
  }]);

  assert(result.success === true, `Should succeed: ${result.errors.join(', ')}`);

  // Verify file was modified
  const fileContent = fs.readFileSync(tmpFile, 'utf8');
  assert(fileContent.includes('New content'), 'File should have been modified');
  assert(fileContent.includes('<!-- Valid comment -->'), 'Comment should be preserved');

  // Cleanup
  fs.unlinkSync(tmpFile);
  fs.rmdirSync(tmpDir);
});

// =============================================================================
// saveFile (fileio-manager) validates comments
// =============================================================================

test('saveFile throws on unclosed comment in body', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sailing-test-'));
  const tmpFile = path.join(tmpDir, 'test.md');

  let threw = false;
  try {
    saveFile(tmpFile, { id: 'T001' }, '<!-- unclosed comment\n\nContent');
  } catch (e) {
    threw = true;
    assert((e as Error).message.includes('Unclosed HTML comment'), 'Should mention unclosed comment');
  }
  assert(threw, 'Should have thrown');

  // File should not exist
  assert(!fs.existsSync(tmpFile), 'File should not have been created');

  // Cleanup
  fs.rmdirSync(tmpDir);
});

test('saveFile allows valid comments', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sailing-test-'));
  const tmpFile = path.join(tmpDir, 'test.md');

  saveFile(tmpFile, { id: 'T001' }, '<!-- valid comment -->\n\nContent');

  assert(fs.existsSync(tmpFile), 'File should exist');
  const content = fs.readFileSync(tmpFile, 'utf8');
  assert(content.includes('<!-- valid comment -->'), 'Comment should be preserved');

  // Cleanup
  fs.unlinkSync(tmpFile);
  fs.rmdirSync(tmpDir);
});

// =============================================================================
// Summary
// =============================================================================

console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
