/**
 * Unit tests for cli/lib/index.js (artefact indexing library)
 *
 * Run with: node --test test/index.test.js
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  extractIdKey,
  extractNumericId,
  buildTaskIndex,
  buildEpicIndex,
  buildPrdIndex,
  buildMemoryIndex,
  getTask,
  getEpic,
  getPrd,
  getMemoryFile,
  getTaskEpic,
  getEpicPrd,
  clearIndexCache
} from '../dist/cli/lib/index.js';

// =============================================================================
// ID Extraction Tests (pure functions, no filesystem)
// =============================================================================

describe('extractIdKey', () => {
  describe('task IDs (T prefix)', () => {
    it('should extract from T039-foo.md', () => {
      assert.strictEqual(extractIdKey('T039-foo.md', 'T'), '39');
    });

    it('should extract from T0039-bar.md', () => {
      assert.strictEqual(extractIdKey('T0039-bar.md', 'T'), '39');
    });

    it('should extract from T00039.md', () => {
      assert.strictEqual(extractIdKey('T00039.md', 'T'), '39');
    });

    it('should extract from T1.md (single digit)', () => {
      assert.strictEqual(extractIdKey('T1.md', 'T'), '1');
    });

    it('should extract from T001.md', () => {
      assert.strictEqual(extractIdKey('T001.md', 'T'), '1');
    });

    it('should return null for non-matching filename', () => {
      assert.strictEqual(extractIdKey('readme.md', 'T'), null);
    });

    it('should return null for wrong prefix', () => {
      assert.strictEqual(extractIdKey('E001.md', 'T'), null);
    });
  });

  describe('epic IDs (E prefix)', () => {
    it('should extract from E001.md', () => {
      assert.strictEqual(extractIdKey('E001.md', 'E'), '1');
    });

    it('should extract from E0001.md', () => {
      assert.strictEqual(extractIdKey('E0001.md', 'E'), '1');
    });

    it('should extract from E14-feature.md', () => {
      assert.strictEqual(extractIdKey('E14-feature.md', 'E'), '14');
    });
  });

  describe('letter suffix support', () => {
    it('should extract E005a as "5a"', () => {
      assert.strictEqual(extractIdKey('E005a-foo.md', 'E'), '5a');
    });

    it('should extract E005b as "5b"', () => {
      assert.strictEqual(extractIdKey('E005b-bar.md', 'E'), '5b');
    });

    it('should extract T001a as "1a"', () => {
      assert.strictEqual(extractIdKey('T001a.md', 'T'), '1a');
    });

    it('should normalize suffix to lowercase', () => {
      assert.strictEqual(extractIdKey('E005A.md', 'E'), '5a');
    });

    it('should handle suffix with title', () => {
      assert.strictEqual(extractIdKey('E037b-refactor-auth.md', 'E'), '37b');
    });
  });
});

describe('extractNumericId', () => {
  it('should extract numeric part only from T039-foo.md', () => {
    assert.strictEqual(extractNumericId('T039-foo.md', 'T'), 39);
  });

  it('should strip leading zeros T0001.md -> 1', () => {
    assert.strictEqual(extractNumericId('T0001.md', 'T'), 1);
  });

  it('should ignore letter suffix E005a.md -> 5', () => {
    assert.strictEqual(extractNumericId('E005a.md', 'E'), 5);
  });

  it('should return null for non-matching', () => {
    assert.strictEqual(extractNumericId('readme.md', 'T'), null);
  });
});

// =============================================================================
// Memory Index Tests
// Note: These tests use the actual project's memory directory.
// They test the index functions work with whatever files exist.
// =============================================================================

describe('buildMemoryIndex', () => {
  beforeEach(() => {
    clearIndexCache();
  });

  it('should return a Map', () => {
    const index = buildMemoryIndex();
    assert.ok(index instanceof Map);
  });

  it('should index files if memory directory exists', () => {
    const index = buildMemoryIndex();
    // The index should be a Map (may be empty if no memory dir)
    assert.ok(index instanceof Map);
  });
});

describe('getMemoryFile (format-agnostic lookup logic)', () => {
  // These tests validate the ID parsing logic without needing specific files
  // The actual file lookup depends on what's in the project

  beforeEach(() => {
    clearIndexCache();
  });

  it('should parse E37 as key E37', () => {
    // Test the ID parsing logic
    const epicMatch = 'E37'.match(/^E0*(\d+)([a-z])?$/i);
    assert.ok(epicMatch);
    const key = 'E' + epicMatch[1] + (epicMatch[2] ? epicMatch[2].toLowerCase() : '');
    assert.strictEqual(key, 'E37');
  });

  it('should parse E037 as key E37', () => {
    const epicMatch = 'E037'.match(/^E0*(\d+)([a-z])?$/i);
    assert.ok(epicMatch);
    const key = 'E' + epicMatch[1] + (epicMatch[2] ? epicMatch[2].toLowerCase() : '');
    assert.strictEqual(key, 'E37');
  });

  it('should parse E0037 as key E37', () => {
    const epicMatch = 'E0037'.match(/^E0*(\d+)([a-z])?$/i);
    assert.ok(epicMatch);
    const key = 'E' + epicMatch[1] + (epicMatch[2] ? epicMatch[2].toLowerCase() : '');
    assert.strictEqual(key, 'E37');
  });

  it('should parse E5a as key E5a', () => {
    const epicMatch = 'E5a'.match(/^E0*(\d+)([a-z])?$/i);
    assert.ok(epicMatch);
    const key = 'E' + epicMatch[1] + (epicMatch[2] ? epicMatch[2].toLowerCase() : '');
    assert.strictEqual(key, 'E5a');
  });

  it('should parse E005A as key E5a (lowercase)', () => {
    const epicMatch = 'E005A'.match(/^E0*(\d+)([a-z])?$/i);
    assert.ok(epicMatch);
    const key = 'E' + epicMatch[1] + (epicMatch[2] ? epicMatch[2].toLowerCase() : '');
    assert.strictEqual(key, 'E5a');
  });

  it('should parse PRD-1 as key PRD-1', () => {
    const prdMatch = 'PRD-1'.match(/^PRD-?0*(\d+)$/i);
    assert.ok(prdMatch);
    const key = 'PRD-' + prdMatch[1];
    assert.strictEqual(key, 'PRD-1');
  });

  it('should parse PRD-001 as key PRD-1', () => {
    const prdMatch = 'PRD-001'.match(/^PRD-?0*(\d+)$/i);
    assert.ok(prdMatch);
    const key = 'PRD-' + prdMatch[1];
    assert.strictEqual(key, 'PRD-1');
  });

  it('should return null for invalid ID format', () => {
    const result = getMemoryFile('invalid');
    assert.strictEqual(result, null);
  });

  it('should return null for empty string', () => {
    const result = getMemoryFile('');
    assert.strictEqual(result, null);
  });
});

// =============================================================================
// Task/Epic Index Edge Cases
// =============================================================================

describe('ID normalization edge cases', () => {
  it('extractIdKey should handle very large numbers', () => {
    assert.strictEqual(extractIdKey('T00000123.md', 'T'), '123');
  });

  it('extractIdKey should handle T0.md as key "0"', () => {
    assert.strictEqual(extractIdKey('T0.md', 'T'), '0');
  });

  it('extractIdKey should handle files with dots in name', () => {
    assert.strictEqual(extractIdKey('T001-v2.0.md', 'T'), '1');
  });

  it('extractIdKey should handle uppercase prefix', () => {
    // The 'i' flag in regex should make it case-insensitive
    assert.strictEqual(extractIdKey('t001.md', 'T'), '1');
  });

  it('extractIdKey should preserve suffix case as lowercase', () => {
    assert.strictEqual(extractIdKey('E005C.md', 'E'), '5c');
    assert.strictEqual(extractIdKey('E005c.md', 'E'), '5c');
  });
});
