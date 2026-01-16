/**
 * Discovery Manager - File and directory discovery operations
 *
 * MANAGER: Orchestrates file discovery with config/path access.
 */
import fs from 'fs';
import path from 'path';
import { findProjectRoot, getPrdsDir } from './core-manager.js';
/**
 * Find DEV.md file (check project root and common locations)
 * @param projectRoot - Project root path (defaults to findProjectRoot())
 * @returns Path to DEV.md or null
 */
export function findDevMd(projectRoot) {
    projectRoot = projectRoot || findProjectRoot();
    const candidates = [
        path.join(projectRoot, 'DEV.md'),
        path.join(projectRoot, 'DEVELOPMENT.md'),
        path.join(projectRoot, 'docs', 'DEV.md'),
        path.join(projectRoot, 'docs', 'DEVELOPMENT.md')
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}
/**
 * Find TOOLSET.md file
 * @param projectRoot - Project root path (defaults to findProjectRoot())
 * @returns Path to TOOLSET.md or null
 */
export function findToolset(projectRoot) {
    projectRoot = projectRoot || findProjectRoot();
    const candidates = [
        path.join(projectRoot, '.claude', 'TOOLSET.md'),
        path.join(projectRoot, 'TOOLSET.md')
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}
/**
 * Find all PRD directories
 */
export function findPrdDirs() {
    const prdsDir = getPrdsDir();
    if (!fs.existsSync(prdsDir))
        return [];
    return fs.readdirSync(prdsDir)
        .filter(d => d.startsWith('PRD-'))
        .map(d => path.join(prdsDir, d))
        .filter(d => fs.statSync(d).isDirectory());
}
/**
 * Find files matching a pattern in a directory
 */
export function findFiles(dir, pattern) {
    if (!fs.existsSync(dir))
        return [];
    return fs.readdirSync(dir)
        .filter(f => f.match(pattern))
        .map(f => path.join(dir, f));
}
