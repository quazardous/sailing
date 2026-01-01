/**
 * Unit tests for cli/lib/artifact.js
 *
 * Run with: node --test test/artifact.test.js
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  parseMarkdownSections,
  serializeSections,
  applyOp,
  applyOps,
  parseSearchReplace,
  applySearchReplace,
  editArtifact,
  listSections,
  getSection
} from '../cli/lib/artifact.js';

// Test fixtures
const SIMPLE_MD = `---
id: T001
title: Test
status: Draft
---

## Description

A simple description.

## Deliverables

- [ ] Item one
- [ ] Item two
- [x] Done item

## Notes

Some notes here.
`;

const WITH_CODE_BLOCK = `---
id: T002
---

## Technical Details

\`\`\`javascript
// Code with ## inside
function test() {
  console.log("## not a heading");
}
\`\`\`

After code block.

## Next Section

Content.
`;

const NESTED_HEADINGS = `---
id: T003
---

## Main Section

Content.

### Subsection

Nested content.

#### Deep nesting

Very deep.

## Another Main

Back to level 2.
`;

const EMPTY_SECTIONS = `---
id: T004
---

## Empty

## Also Empty

## Has Content

Real content here.
`;

// Helper to create temp file
function createTempFile(content) {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `artifact-test-${Date.now()}.md`);
  fs.writeFileSync(tmpFile, content);
  return tmpFile;
}

describe('parseMarkdownSections', () => {
  it('should extract frontmatter correctly', () => {
    const parsed = parseMarkdownSections(SIMPLE_MD);
    assert.ok(parsed.frontmatter.includes('id: T001'));
    assert.ok(parsed.frontmatter.startsWith('---'));
    assert.ok(parsed.frontmatter.endsWith('---'));
  });

  it('should parse all sections', () => {
    const parsed = parseMarkdownSections(SIMPLE_MD);
    assert.deepStrictEqual(parsed.order, ['Description', 'Deliverables', 'Notes']);
  });

  it('should preserve section content', () => {
    const parsed = parseMarkdownSections(SIMPLE_MD);
    assert.ok(parsed.sections.get('Description').includes('simple description'));
    assert.ok(parsed.sections.get('Deliverables').includes('- [ ] Item one'));
  });

  it('should handle code blocks with ## inside', () => {
    const parsed = parseMarkdownSections(WITH_CODE_BLOCK);
    assert.deepStrictEqual(parsed.order, ['Technical Details', 'Next Section']);
    assert.ok(parsed.sections.get('Technical Details').includes('## not a heading'));
  });

  it('should treat ### as content, not sections', () => {
    const parsed = parseMarkdownSections(NESTED_HEADINGS);
    assert.deepStrictEqual(parsed.order, ['Main Section', 'Another Main']);
    assert.ok(parsed.sections.get('Main Section').includes('### Subsection'));
  });

  it('should handle empty sections', () => {
    const parsed = parseMarkdownSections(EMPTY_SECTIONS);
    assert.deepStrictEqual(parsed.order, ['Empty', 'Also Empty', 'Has Content']);
    assert.strictEqual(parsed.sections.get('Empty'), '');
    assert.strictEqual(parsed.sections.get('Also Empty'), '');
  });
});

describe('serializeSections', () => {
  it('should roundtrip simple markdown', () => {
    const parsed = parseMarkdownSections(SIMPLE_MD);
    const serialized = serializeSections(parsed);
    const reparsed = parseMarkdownSections(serialized);

    assert.deepStrictEqual(reparsed.order, parsed.order);
    for (const name of parsed.order) {
      assert.strictEqual(
        reparsed.sections.get(name).trim(),
        parsed.sections.get(name).trim()
      );
    }
  });

  it('should preserve code blocks', () => {
    const parsed = parseMarkdownSections(WITH_CODE_BLOCK);
    const serialized = serializeSections(parsed);
    assert.ok(serialized.includes('```javascript'));
    assert.ok(serialized.includes('## not a heading'));
  });
});

describe('applyOp - replace', () => {
  it('should replace section content', () => {
    const parsed = parseMarkdownSections(SIMPLE_MD);
    const result = applyOp(parsed.sections, parsed.order, {
      op: 'replace',
      section: 'Description',
      content: 'New description.'
    });

    assert.ok(result.success);
    assert.strictEqual(parsed.sections.get('Description'), 'New description.');
  });

  it('should fail for non-existent section', () => {
    const parsed = parseMarkdownSections(SIMPLE_MD);
    const result = applyOp(parsed.sections, parsed.order, {
      op: 'replace',
      section: 'NonExistent',
      content: 'test'
    });

    assert.ok(!result.success);
    assert.ok(result.error.includes('not found'));
  });
});

describe('applyOp - append/prepend', () => {
  it('should append to section', () => {
    const parsed = parseMarkdownSections(SIMPLE_MD);
    applyOp(parsed.sections, parsed.order, {
      op: 'append',
      section: 'Notes',
      content: '\nAppended.'
    });

    assert.ok(parsed.sections.get('Notes').endsWith('Appended.'));
  });

  it('should prepend to section', () => {
    const parsed = parseMarkdownSections(SIMPLE_MD);
    applyOp(parsed.sections, parsed.order, {
      op: 'prepend',
      section: 'Notes',
      content: 'Prepended.\n'
    });

    assert.ok(parsed.sections.get('Notes').startsWith('Prepended.'));
  });
});

describe('applyOp - check/uncheck', () => {
  it('should check unchecked item', () => {
    const parsed = parseMarkdownSections(SIMPLE_MD);
    const result = applyOp(parsed.sections, parsed.order, {
      op: 'check',
      section: 'Deliverables',
      item: 'Item one'
    });

    assert.ok(result.success);
    assert.ok(parsed.sections.get('Deliverables').includes('[x] Item one'));
  });

  it('should uncheck checked item', () => {
    const parsed = parseMarkdownSections(SIMPLE_MD);
    const result = applyOp(parsed.sections, parsed.order, {
      op: 'uncheck',
      section: 'Deliverables',
      item: 'Done item'
    });

    assert.ok(result.success);
    assert.ok(parsed.sections.get('Deliverables').includes('[ ] Done item'));
  });

  it('should match partial item text', () => {
    const parsed = parseMarkdownSections(SIMPLE_MD);
    const result = applyOp(parsed.sections, parsed.order, {
      op: 'check',
      section: 'Deliverables',
      item: 'two'  // Partial match for "Item two"
    });

    assert.ok(result.success);
    assert.ok(parsed.sections.get('Deliverables').includes('[x] Item two'));
  });

  it('should fail for non-existent item', () => {
    const parsed = parseMarkdownSections(SIMPLE_MD);
    const result = applyOp(parsed.sections, parsed.order, {
      op: 'check',
      section: 'Deliverables',
      item: 'NonExistent'
    });

    assert.ok(!result.success);
    assert.ok(result.error.includes('not found'));
  });
});

describe('applyOp - create/delete', () => {
  it('should create new section', () => {
    const parsed = parseMarkdownSections(SIMPLE_MD);
    const result = applyOp(parsed.sections, parsed.order, {
      op: 'create',
      section: 'New Section',
      content: 'New content'
    });

    assert.ok(result.success);
    assert.ok(parsed.sections.has('New Section'));
    assert.ok(parsed.order.includes('New Section'));
  });

  it('should create section after specified section', () => {
    const parsed = parseMarkdownSections(SIMPLE_MD);
    applyOp(parsed.sections, parsed.order, {
      op: 'create',
      section: 'After Desc',
      content: 'test',
      after: 'Description'
    });

    const idx = parsed.order.indexOf('After Desc');
    assert.strictEqual(parsed.order[idx - 1], 'Description');
  });

  it('should delete section', () => {
    const parsed = parseMarkdownSections(SIMPLE_MD);
    const result = applyOp(parsed.sections, parsed.order, {
      op: 'delete',
      section: 'Notes'
    });

    assert.ok(result.success);
    assert.ok(!parsed.sections.has('Notes'));
    assert.ok(!parsed.order.includes('Notes'));
  });
});

describe('parseSearchReplace', () => {
  it('should parse single block', () => {
    const input = `
<<<<<<< SEARCH
old content
=======
new content
>>>>>>> REPLACE
`;
    const ops = parseSearchReplace(input);
    assert.strictEqual(ops.length, 1);
    assert.strictEqual(ops[0].op, 'search_replace');
    assert.strictEqual(ops[0].search, 'old content');
    assert.strictEqual(ops[0].replace, 'new content');
  });

  it('should parse multiple blocks', () => {
    const input = `
<<<<<<< SEARCH
first old
=======
first new
>>>>>>> REPLACE

Some text

<<<<<<< SEARCH
second old
=======
second new
>>>>>>> REPLACE
`;
    const ops = parseSearchReplace(input);
    assert.strictEqual(ops.length, 2);
  });

  it('should handle multi-line content', () => {
    const input = `
<<<<<<< SEARCH
line 1
line 2
line 3
=======
new line 1
new line 2
>>>>>>> REPLACE
`;
    const ops = parseSearchReplace(input);
    assert.strictEqual(ops[0].search.split('\n').length, 3);
    assert.strictEqual(ops[0].replace.split('\n').length, 2);
  });

  it('should return empty array for no blocks', () => {
    const ops = parseSearchReplace('no blocks here');
    assert.strictEqual(ops.length, 0);
  });
});

describe('applySearchReplace', () => {
  it('should apply exact match', () => {
    const content = 'Hello world';
    const result = applySearchReplace(content, 'world', 'universe');

    assert.ok(result.success);
    assert.strictEqual(result.content, 'Hello universe');
  });

  it('should handle multi-line search', () => {
    const content = 'line1\nline2\nline3';
    const result = applySearchReplace(content, 'line1\nline2', 'changed1\nchanged2');

    assert.ok(result.success);
    assert.ok(result.content.includes('changed1\nchanged2\nline3'));
  });

  it('should handle whitespace tolerance', () => {
    const content = '  - item 1\n  - item 2';
    const result = applySearchReplace(content, '- item 1', '- modified');

    assert.ok(result.success);
  });

  it('should fail for not found', () => {
    const content = 'Hello world';
    const result = applySearchReplace(content, 'not found', 'replacement');

    assert.ok(!result.success);
    assert.ok(result.error.includes('not found'));
  });

  it('should handle special regex chars', () => {
    const content = 'test [x] (value)';
    const result = applySearchReplace(content, '[x]', '[ ]');

    assert.ok(result.success);
    assert.strictEqual(result.content, 'test [ ] (value)');
  });
});

describe('editArtifact (integration)', () => {
  let tmpFile;

  beforeEach(() => {
    tmpFile = createTempFile(SIMPLE_MD);
  });

  afterEach(() => {
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  });

  it('should apply section ops', () => {
    const result = editArtifact(tmpFile, [
      { op: 'replace', section: 'Description', content: 'Replaced.' }
    ]);

    assert.ok(result.success);
    assert.strictEqual(result.applied, 1);

    const content = fs.readFileSync(tmpFile, 'utf8');
    assert.ok(content.includes('Replaced.'));
  });

  it('should apply search_replace ops', () => {
    const result = editArtifact(tmpFile, [
      { op: 'search_replace', search: '- [ ] Item one', replace: '- [x] Item one' }
    ]);

    assert.ok(result.success);

    const content = fs.readFileSync(tmpFile, 'utf8');
    assert.ok(content.includes('[x] Item one'));
  });

  it('should apply mixed ops', () => {
    const result = editArtifact(tmpFile, [
      { op: 'search_replace', search: '- [ ] Item one', replace: '- [x] Item one' },
      { op: 'append', section: 'Notes', content: '\nExtra.' }
    ]);

    assert.ok(result.success);
    assert.strictEqual(result.applied, 2);
  });

  it('should report errors for failed ops', () => {
    const result = editArtifact(tmpFile, [
      { op: 'replace', section: 'NonExistent', content: 'fail' }
    ]);

    assert.ok(!result.success);
    assert.strictEqual(result.errors.length, 1);
  });

  it('should fail for non-existent file', () => {
    const result = editArtifact('/non/existent/path.md', [
      { op: 'replace', section: 'Test', content: 'fail' }
    ]);

    assert.ok(!result.success);
    assert.ok(result.errors[0].includes('not found'));
  });
});

describe('helper functions', () => {
  let tmpFile;

  beforeEach(() => {
    tmpFile = createTempFile(SIMPLE_MD);
  });

  afterEach(() => {
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  });

  it('listSections should return section names', () => {
    const sections = listSections(tmpFile);
    assert.deepStrictEqual(sections, ['Description', 'Deliverables', 'Notes']);
  });

  it('getSection should return section content', () => {
    const content = getSection(tmpFile, 'Description');
    assert.ok(content.includes('simple description'));
  });

  it('getSection should return null for non-existent', () => {
    const content = getSection(tmpFile, 'NonExistent');
    assert.strictEqual(content, null);
  });
});

describe('edge cases', () => {
  it('should handle markdown without frontmatter', () => {
    const noFrontmatter = `## Section One

Content.

## Section Two

More content.
`;
    const parsed = parseMarkdownSections(noFrontmatter);
    assert.strictEqual(parsed.frontmatter, '');
    assert.deepStrictEqual(parsed.order, ['Section One', 'Section Two']);
  });

  it('should handle markdown with only frontmatter', () => {
    const onlyFrontmatter = `---
id: test
---
`;
    const parsed = parseMarkdownSections(onlyFrontmatter);
    assert.ok(parsed.frontmatter.includes('id: test'));
    assert.strictEqual(parsed.order.length, 0);
  });

  it('should handle special characters in section names', () => {
    const special = `## Section (with) [special] chars!

Content.
`;
    const parsed = parseMarkdownSections(special);
    assert.deepStrictEqual(parsed.order, ['Section (with) [special] chars!']);
  });

  it('should handle unicode in content', () => {
    const unicode = `## Description

Émojis: 🚀 🎉 ✅
Accents: café, naïve, über
`;
    const parsed = parseMarkdownSections(unicode);
    const serialized = serializeSections(parsed);
    assert.ok(serialized.includes('🚀'));
    assert.ok(serialized.includes('café'));
  });
});
