/**
 * Memory types
 */

export interface MemoryEntry {
  id: string;
  path: string;
  content: string;
  sections?: MemorySection[];
}

export interface MemorySection {
  level: string; // PROJECT, PRD, EPIC
  name: string;
  content: string;
}

export interface LogFileEntry {
  id: string;
  type: 'task' | 'epic' | 'other';
  path: string;
}

export interface LogLevelCounts {
  TIP: number;
  INFO: number;
  WARN: number;
  ERROR: number;
  CRITICAL: number;
  [key: string]: number;
}
