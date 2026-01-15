/**
 * Filesystem utilities
 * Pure fs operations - no manager imports
 */
import fs from 'fs';
import path from 'path';

/**
 * Ensure directory exists (create recursively if needed)
 * @param dirPath - Absolute path to directory
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Check if path exists
 */
export function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * Read file as string (returns null if not found)
 */
export function readFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Write file (creates parent directories if needed)
 */
export function writeFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  fs.writeFileSync(filePath, content);
}
