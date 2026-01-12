/**
 * Unit tests for cli/lib/memory-section.js (memory section editing)
 *
 * Run with: node --test test/memory-section.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  extractAllSections,
  findSection,
  editSection,
  parseMultiSectionInput
} from '../dist/cli/lib/memory-section.js';

// =============================================================================
// Test Fixtures
// =============================================================================

const MEMORY_TEMPLATE = `---
epic: E0037
created: '2026-01-06T08:27:35.736Z'
---

# Memory: E0037

## Agent Context
- Tip 1
- Tip 2

## Escalation
- Issue 1

## Changelog
- Change 1
- Change 2

`;

const MEMORY_WITH_EMPTY_SECTIONS = `---
epic: E001
---

# Memory: E001

## Agent Context

## Escalation

## Changelog

`;

const MEMORY_WITH_COMMENTS = `---
epic: E002
---

# Memory: E002

## Agent Context
<!-- Add tips here -->
- Actual tip

## Escalation
<!-- Add escalations here -->

## Changelog
<!-- Log changes -->
- Entry 1

`;

// =============================================================================
// extractAllSections Tests
// =============================================================================

describe('extractAllSections', () => {
  it('should extract all non-empty sections', () => {
    const sections = extractAllSections(MEMORY_TEMPLATE);
    assert.strictEqual(sections.length, 3);
    assert.strictEqual(sections[0].name, 'Agent Context');
    assert.strictEqual(sections[1].name, 'Escalation');
    assert.strictEqual(sections[2].name, 'Changelog');
  });

  it('should preserve section content', () => {
    const sections = extractAllSections(MEMORY_TEMPLATE);
    const agentContext = sections.find(s => s.name === 'Agent Context');
    assert.ok(agentContext.content.includes('- Tip 1'));
    assert.ok(agentContext.content.includes('- Tip 2'));
  });

  it('should skip empty sections', () => {
    const sections = extractAllSections(MEMORY_WITH_EMPTY_SECTIONS);
    assert.strictEqual(sections.length, 0);
  });

  it('should strip HTML comments from content', () => {
    const sections = extractAllSections(MEMORY_WITH_COMMENTS);
    const agentContext = sections.find(s => s.name === 'Agent Context');
    assert.ok(agentContext);
    assert.ok(!agentContext.content.includes('<!--'));
    assert.ok(agentContext.content.includes('- Actual tip'));
  });
});

// =============================================================================
// findSection Tests
// =============================================================================

describe('findSection', () => {
  it('should find existing section', () => {
    const result = findSection(MEMORY_TEMPLATE, 'Agent Context');
    assert.ok(result);
    assert.strictEqual(result.header, '## Agent Context\n');
    assert.ok(result.content.includes('- Tip 1'));
  });

  it('should return null for non-existent section', () => {
    const result = findSection(MEMORY_TEMPLATE, 'NonExistent');
    assert.strictEqual(result, null);
  });

  it('should find section case-sensitively', () => {
    const result = findSection(MEMORY_TEMPLATE, 'agent context');
    assert.strictEqual(result, null); // Case mismatch
  });

  it('should strip comments from section content', () => {
    const result = findSection(MEMORY_WITH_COMMENTS, 'Agent Context');
    assert.ok(result);
    assert.ok(!result.content.includes('<!--'));
  });

  it('should handle empty sections', () => {
    const result = findSection(MEMORY_WITH_EMPTY_SECTIONS, 'Agent Context');
    assert.ok(result);
    assert.strictEqual(result.content, '');
  });

  it('should handle section at end of file', () => {
    const result = findSection(MEMORY_TEMPLATE, 'Changelog');
    assert.ok(result);
    assert.ok(result.content.includes('- Change 1'));
  });
});

// =============================================================================
// editSection Tests - Replace Operation
// =============================================================================

describe('editSection - replace', () => {
  it('should replace section content', () => {
    const result = editSection(MEMORY_TEMPLATE, 'Agent Context', 'New tip content', 'replace');
    assert.ok(result.success);
    assert.ok(result.content.includes('New tip content'));
    assert.ok(!result.content.includes('- Tip 1'));
  });

  it('should preserve other sections', () => {
    const result = editSection(MEMORY_TEMPLATE, 'Agent Context', 'New content', 'replace');
    assert.ok(result.content.includes('## Escalation'));
    assert.ok(result.content.includes('- Issue 1'));
    assert.ok(result.content.includes('## Changelog'));
  });

  it('should return warning for non-existent section', () => {
    const result = editSection(MEMORY_TEMPLATE, 'NonExistent', 'content', 'replace');
    assert.ok(result.warning);
    assert.ok(result.warning.includes('NonExistent'));
    assert.strictEqual(result.success, undefined);
  });

  it('should handle empty replacement', () => {
    const result = editSection(MEMORY_TEMPLATE, 'Agent Context', '', 'replace');
    assert.ok(result.success);
    // Section header should still exist
    assert.ok(result.content.includes('## Agent Context'));
  });
});

// =============================================================================
// editSection Tests - Append Operation
// =============================================================================

describe('editSection - append', () => {
  it('should append to section with existing content', () => {
    const result = editSection(MEMORY_TEMPLATE, 'Agent Context', '- New tip', 'append');
    assert.ok(result.success);
    assert.ok(result.content.includes('- Tip 1'));
    assert.ok(result.content.includes('- New tip'));
    // New tip should come after existing
    const tipIndex = result.content.indexOf('- Tip 1');
    const newTipIndex = result.content.indexOf('- New tip');
    assert.ok(newTipIndex > tipIndex);
  });

  it('should append to empty section', () => {
    const result = editSection(MEMORY_WITH_EMPTY_SECTIONS, 'Agent Context', '- First tip', 'append');
    assert.ok(result.success);
    assert.ok(result.content.includes('- First tip'));
  });

  it('should preserve section header', () => {
    const result = editSection(MEMORY_TEMPLATE, 'Escalation', '- New issue', 'append');
    assert.ok(result.content.includes('## Escalation'));
  });
});

// =============================================================================
// editSection Tests - Prepend Operation
// =============================================================================

describe('editSection - prepend', () => {
  it('should prepend to section with existing content', () => {
    const result = editSection(MEMORY_TEMPLATE, 'Agent Context', '- Priority tip', 'prepend');
    assert.ok(result.success);
    assert.ok(result.content.includes('- Priority tip'));
    assert.ok(result.content.includes('- Tip 1'));
    // Priority tip should come before existing
    const priorityIndex = result.content.indexOf('- Priority tip');
    const tipIndex = result.content.indexOf('- Tip 1');
    assert.ok(priorityIndex < tipIndex);
  });

  it('should prepend to empty section', () => {
    const result = editSection(MEMORY_WITH_EMPTY_SECTIONS, 'Escalation', '- Critical issue', 'prepend');
    assert.ok(result.success);
    assert.ok(result.content.includes('- Critical issue'));
  });
});

// =============================================================================
// Section Content Placement Bug Tests
// =============================================================================

describe('section content placement (regression tests)', () => {
  it('should not put content in wrong section', () => {
    const result = editSection(MEMORY_TEMPLATE, 'Agent Context', '- New tip', 'append');
    assert.ok(result.success);

    // Verify content is in correct section
    const sections = extractAllSections(result.content);
    const agentContext = sections.find(s => s.name === 'Agent Context');
    const escalation = sections.find(s => s.name === 'Escalation');

    assert.ok(agentContext.content.includes('- New tip'), 'New tip should be in Agent Context');
    assert.ok(!escalation.content.includes('- New tip'), 'New tip should NOT be in Escalation');
  });

  it('should preserve section boundaries when editing', () => {
    let content = MEMORY_TEMPLATE;

    // Edit each section
    const r1 = editSection(content, 'Agent Context', '- Agent tip', 'replace');
    content = r1.content;

    const r2 = editSection(content, 'Escalation', '- Escalation item', 'replace');
    content = r2.content;

    const r3 = editSection(content, 'Changelog', '- Changelog entry', 'replace');
    content = r3.content;

    // Verify each section has correct content
    const sections = extractAllSections(content);
    assert.strictEqual(sections.length, 3);

    const agentContext = sections.find(s => s.name === 'Agent Context');
    const escalation = sections.find(s => s.name === 'Escalation');
    const changelog = sections.find(s => s.name === 'Changelog');

    assert.ok(agentContext.content.includes('- Agent tip'));
    assert.ok(!agentContext.content.includes('- Escalation item'));
    assert.ok(!agentContext.content.includes('- Changelog entry'));

    assert.ok(escalation.content.includes('- Escalation item'));
    assert.ok(!escalation.content.includes('- Agent tip'));
    assert.ok(!escalation.content.includes('- Changelog entry'));

    assert.ok(changelog.content.includes('- Changelog entry'));
    assert.ok(!changelog.content.includes('- Agent tip'));
    assert.ok(!changelog.content.includes('- Escalation item'));
  });

  it('should handle multiple sequential edits', () => {
    let content = MEMORY_TEMPLATE;

    // Append to Agent Context multiple times
    for (let i = 1; i <= 3; i++) {
      const result = editSection(content, 'Agent Context', `- Append ${i}`, 'append');
      content = result.content;
    }

    const sections = extractAllSections(content);
    const agentContext = sections.find(s => s.name === 'Agent Context');

    assert.ok(agentContext.content.includes('- Append 1'));
    assert.ok(agentContext.content.includes('- Append 2'));
    assert.ok(agentContext.content.includes('- Append 3'));

    // Escalation should be unchanged
    const escalation = sections.find(s => s.name === 'Escalation');
    assert.ok(!escalation.content.includes('Append'));
  });
});

// =============================================================================
// parseMultiSectionInput Tests
// =============================================================================

describe('parseMultiSectionInput', () => {
  it('should parse single section without operation', () => {
    const input = `## E001:Agent Context
- New tip
`;
    const sections = parseMultiSectionInput(input);
    assert.strictEqual(sections.length, 1);
    assert.strictEqual(sections[0].id, 'E001');
    assert.strictEqual(sections[0].section, 'Agent Context');
    assert.strictEqual(sections[0].operation, 'replace');
    assert.strictEqual(sections[0].content, '- New tip');
  });

  it('should parse section with append operation', () => {
    const input = `## E001:Agent Context [append]
- New tip
`;
    const sections = parseMultiSectionInput(input);
    assert.strictEqual(sections[0].operation, 'append');
  });

  it('should parse section with prepend operation', () => {
    const input = `## E001:Escalation [prepend]
- Critical issue
`;
    const sections = parseMultiSectionInput(input);
    assert.strictEqual(sections[0].operation, 'prepend');
  });

  it('should parse multiple sections', () => {
    const input = `## E001:Agent Context [append]
- Tip 1

## E001:Escalation [append]
- Issue 1

## PRD-001:Cross-Epic Patterns
- Pattern 1
`;
    const sections = parseMultiSectionInput(input);
    assert.strictEqual(sections.length, 3);
    assert.strictEqual(sections[0].id, 'E001');
    assert.strictEqual(sections[0].section, 'Agent Context');
    assert.strictEqual(sections[1].id, 'E001');
    assert.strictEqual(sections[1].section, 'Escalation');
    assert.strictEqual(sections[2].id, 'PRD-001');
    assert.strictEqual(sections[2].section, 'Cross-Epic Patterns');
  });

  it('should handle PROJECT as ID', () => {
    const input = `## PROJECT:Architecture Decisions
- Decision 1
`;
    const sections = parseMultiSectionInput(input);
    assert.strictEqual(sections[0].id, 'PROJECT');
    assert.strictEqual(sections[0].section, 'Architecture Decisions');
  });

  it('should return empty array for invalid input', () => {
    const sections = parseMultiSectionInput('no sections here');
    assert.strictEqual(sections.length, 0);
  });

  it('should preserve multiline content', () => {
    const input = `## E001:Agent Context
- Tip 1
- Tip 2
  - Sub-tip
`;
    const sections = parseMultiSectionInput(input);
    assert.ok(sections[0].content.includes('- Tip 1'));
    assert.ok(sections[0].content.includes('- Tip 2'));
    assert.ok(sections[0].content.includes('- Sub-tip'));
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('edge cases', () => {
  it('should handle section names with special characters', () => {
    const content = `---
epic: E001
---

## Agent Context (Tips)
- Tip here

## Next Section
- Content
`;
    const result = findSection(content, 'Agent Context (Tips)');
    assert.ok(result);
    assert.ok(result.content.includes('- Tip here'));
  });

  it('should handle unicode in content', () => {
    const content = `---
epic: E001
---

## Agent Context
- 🚀 Performance tip
- Café pattern

## Next
- More
`;
    const result = editSection(content, 'Agent Context', '- 新しいヒント', 'append');
    assert.ok(result.success);
    assert.ok(result.content.includes('🚀'));
    assert.ok(result.content.includes('新しいヒント'));
  });

  it('should handle very long content', () => {
    const longTip = '- ' + 'x'.repeat(10000);
    const result = editSection(MEMORY_TEMPLATE, 'Agent Context', longTip, 'replace');
    assert.ok(result.success);
    assert.ok(result.content.includes(longTip));
  });

  it('should handle content with markdown formatting', () => {
    const content = '**Bold** and *italic* and `code`\n- List item\n1. Numbered';
    const result = editSection(MEMORY_TEMPLATE, 'Agent Context', content, 'replace');
    assert.ok(result.success);
    assert.ok(result.content.includes('**Bold**'));
    assert.ok(result.content.includes('`code`'));
  });

  it('should handle section with ### subsections', () => {
    const contentWithSub = `---
epic: E001
---

## Agent Context
- Main tip

### Subsection
- Sub content

## Escalation
- Issue
`;
    const result = findSection(contentWithSub, 'Agent Context');
    assert.ok(result);
    // ### should be included in Agent Context
    assert.ok(result.content.includes('### Subsection'));
    assert.ok(result.content.includes('- Sub content'));
  });
});
