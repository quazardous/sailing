/**
 * Memory file operations
 */
import fs from 'fs';
import path from 'path';
import { getMemoryDir } from '../core-manager.js';
import { _memoryIndex, setMemoryIndex } from './common.js';

// ============================================================================
// INDEX
// ============================================================================

/**
 * Build memory file index
 */
export function buildMemoryIndex(): Map<string, { key: string; type: 'epic' | 'prd'; file: string }> {
  if (_memoryIndex) return _memoryIndex;

  const index = new Map<string, { key: string; type: 'epic' | 'prd'; file: string }>();
  const memDir = getMemoryDir();

  if (!fs.existsSync(memDir)) {
    setMemoryIndex(index);
    return index;
  }

  const files = fs.readdirSync(memDir).filter(f => f.endsWith('.md'));

  for (const file of files) {
    const filePath = path.join(memDir, file);

    const epicMatch = file.match(/^E0*(\d+)([a-z])?\.md$/i);
    if (epicMatch) {
      const key = 'E' + epicMatch[1] + (epicMatch[2] ? epicMatch[2].toLowerCase() : '');
      index.set(key, { key, type: 'epic', file: filePath });
      continue;
    }

    const prdMatch = file.match(/^PRD-0*(\d+)\.md$/i);
    if (prdMatch) {
      const key = 'PRD-' + prdMatch[1];
      index.set(key, { key, type: 'prd', file: filePath });
    }
  }

  setMemoryIndex(index);
  return index;
}

// ============================================================================
// GETTERS
// ============================================================================

/**
 * Get memory file by ID
 */
export function getMemoryFile(id: string | number) {
  const index = buildMemoryIndex();

  const epicMatch = String(id).match(/^E0*(\d+)([a-z])?$/i);
  if (epicMatch) {
    const key = 'E' + epicMatch[1] + (epicMatch[2] ? epicMatch[2].toLowerCase() : '');
    return index.get(key) || null;
  }

  const prdMatch = String(id).match(/^PRD-?0*(\d+)$/i);
  if (prdMatch) {
    const key = 'PRD-' + prdMatch[1];
    return index.get(key) || null;
  }

  return null;
}
