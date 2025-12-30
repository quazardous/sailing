/**
 * State management for sailing project
 * Handles centralized ID counters and state.json
 */
import fs from 'fs';
import path from 'path';
import { getStateFile, findPrdDirs, findFiles, getSailingDir } from './core.js';

/**
 * Load state from file, auto-initializing if needed
 */
export function loadState() {
  const stateFile = getStateFile();
  // Ensure .sailing directory exists
  const sailingDir = getSailingDir();
  if (!fs.existsSync(sailingDir)) {
    fs.mkdirSync(sailingDir, { recursive: true });
  }
  if (fs.existsSync(stateFile)) {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  }
  // Auto-init: scan existing files to find max IDs
  let maxPrd = 0, maxEpic = 0, maxTask = 0, maxStory = 0;

  findPrdDirs().forEach(prdDir => {
    const prdNum = parseInt(path.basename(prdDir).match(/PRD-(\d+)/)?.[1] || '0');
    if (prdNum > maxPrd) maxPrd = prdNum;

    findFiles(path.join(prdDir, 'epics'), /^E\d+.*\.md$/).forEach(f => {
      const num = parseInt(path.basename(f).match(/E(\d+)/)?.[1] || '0');
      if (num > maxEpic) maxEpic = num;
    });

    findFiles(path.join(prdDir, 'tasks'), /^T\d+.*\.md$/).forEach(f => {
      const num = parseInt(path.basename(f).match(/T(\d+)/)?.[1] || '0');
      if (num > maxTask) maxTask = num;
    });

    findFiles(path.join(prdDir, 'stories'), /^S\d+.*\.md$/).forEach(f => {
      const num = parseInt(path.basename(f).match(/S(\d+)/)?.[1] || '0');
      if (num > maxStory) maxStory = num;
    });
  });

  const state = { counters: { prd: maxPrd, epic: maxEpic, task: maxTask, story: maxStory } };
  saveState(state);
  return state;
}

/**
 * Save state to file
 */
export function saveState(state) {
  const stateFile = getStateFile();
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
}

/**
 * Get next ID for an entity type and increment counter
 */
export function nextId(type) {
  const state = loadState();
  // Handle null/undefined counters (e.g., story counter added after initial state.json)
  if (state.counters[type] == null) {
    state.counters[type] = 0;
  }
  state.counters[type]++;
  saveState(state);
  return state.counters[type];
}

/**
 * Get next number in a directory for a given prefix (fallback method)
 */
export function getNextNumber(dir, prefix) {
  if (!fs.existsSync(dir)) return 1;
  const files = fs.readdirSync(dir).filter(f => f.startsWith(prefix));
  if (files.length === 0) return 1;
  const nums = files.map(f => parseInt(f.match(/\d+/)?.[0] || '0'));
  return Math.max(...nums) + 1;
}
