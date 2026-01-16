/**
 * Artifact Editing Library
 *
 * Provides section-based editing for sailing markdown artifacts (PRD, Epic, Task).
 * Supports CLI commands and Aider-style SEARCH/REPLACE blocks for agents.
 */

import fs from 'fs';

interface ArtifactOp {
  op: string;
  section: string;
  content?: string;
  sedCommands?: Array<{search: string, replace: string, global: boolean}>;
  after?: string;
  search?: string;
  replace?: string;
  item?: string;
}

export interface ParsedMarkdown {
  frontmatter: string;
  preamble: string;
  sections: Map<string, string>;
  order: string[];
}

/**
 * Parse markdown content into frontmatter and sections
 * @param {string} content - Raw markdown content
 * @returns {{ frontmatter: string, sections: Map<string, string>, order: string[] }}
 */
export function parseMarkdownSections(content: string): ParsedMarkdown {
  const lines: string[] = content.split('\n');
  let frontmatter = '';
  let frontmatterEnd = 0;

  // Extract frontmatter
  if (lines[0] === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === '---') {
        frontmatterEnd = i + 1;
        frontmatter = lines.slice(0, frontmatterEnd).join('\n');
        break;
      }
    }
  }

  // Parse sections (## headings)
  const sections: Map<string, string> = new Map();
  const order: string[] = [];
  let currentSection: string | null = null;
  let currentContent: string[] = [];
  let preamble: string[] = []; // Content before first section

  for (let i = frontmatterEnd; i < lines.length; i++) {
    const line: string = lines[i];
    const headingMatch: RegExpMatchArray | null = line.match(/^## (.+)$/);

    if (headingMatch) {
      // Save previous section
      if (currentSection) {
        sections.set(currentSection, currentContent.join('\n').trim());
      } else if (currentContent.length > 0) {
        preamble = currentContent;
      }

      // Start new section
      currentSection = headingMatch[1].trim();
      order.push(currentSection);
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  // Save last section
  if (currentSection) {
    sections.set(currentSection, currentContent.join('\n').trim());
  }

  return {
    frontmatter,
    preamble: preamble.join('\n').trim(),
    sections,
    order
  };
}

/**
 * Serialize sections back to markdown
 * @param {{ frontmatter: string, preamble?: string, sections: Map<string, string>, order: string[] }} parsed
 * @returns {string}
 */
export function serializeSections(parsed: ParsedMarkdown): string {
  const { frontmatter, preamble, sections, order } = parsed;
  const parts: string[] = [];

  if (frontmatter) {
    parts.push(frontmatter);
    parts.push(''); // Empty line after frontmatter
  }

  if (preamble) {
    parts.push(preamble);
    parts.push('');
  }

  for (const name of order) {
    if (sections.has(name)) {
      parts.push(`## ${name}`);
      const content: string | undefined = sections.get(name);
      if (content) {
        parts.push('');
        parts.push(content);
      }
      parts.push('');
    }
  }

  return parts.join('\n').trimEnd() + '\n';
}

export interface OpResult {
  success: boolean;
  error?: string;
}

/**
 * Apply a single operation to sections
 * @param {Map<string, string>} sections - Sections map
 * @param {string[]} order - Section order
 * @param {object} op - Operation to apply
 * @returns {{ success: boolean, error?: string }}
 */
export function applyOp(sections: Map<string, string>, order: string[], op: ArtifactOp): OpResult {
  switch (op.op) {
    case 'replace': {
      // Auto-create section if it doesn't exist
      if (!sections.has(op.section)) {
        order.push(op.section);
      }
      sections.set(op.section, op.content ?? '');
      return { success: true };
    }

    case 'append': {
      // Auto-create section if it doesn't exist
      if (!sections.has(op.section)) {
        order.push(op.section);
        sections.set(op.section, op.content ?? '');
        return { success: true };
      }
      const current: string | undefined = sections.get(op.section);
      const separator: string = current && !current.endsWith('\n') ? '\n' : '';
      sections.set(op.section, (current ?? '') + separator + (op.content ?? ''));
      return { success: true };
    }

    case 'prepend': {
      // Auto-create section if it doesn't exist
      if (!sections.has(op.section)) {
        order.push(op.section);
        sections.set(op.section, op.content ?? '');
        return { success: true };
      }
      const current: string | undefined = sections.get(op.section);
      sections.set(op.section, (op.content ?? '') + (current ? '\n' + current : ''));
      return { success: true };
    }

    case 'check': {
      return toggleCheckbox(sections, op.section, op.item ?? '', true);
    }

    case 'uncheck': {
      return toggleCheckbox(sections, op.section, op.item ?? '', false);
    }

    case 'toggle': {
      return toggleCheckbox(sections, op.section, op.item ?? '', 'toggle');
    }

    case 'delete': {
      if (!sections.has(op.section)) {
        return { success: false, error: `Section not found: ${op.section}` };
      }
      sections.delete(op.section);
      const idx: number = order.indexOf(op.section);
      if (idx !== -1) order.splice(idx, 1);
      return { success: true };
    }

    case 'create': {
      if (sections.has(op.section)) {
        return { success: false, error: `Section already exists: ${op.section}` };
      }
      sections.set(op.section, op.content ?? '');
      if (op.after && order.includes(op.after)) {
        const idx: number = order.indexOf(op.after);
        order.splice(idx + 1, 0, op.section);
      } else {
        order.push(op.section);
      }
      return { success: true };
    }

    default:
      return { success: false, error: `Unknown operation: ${op.op}` };
  }
}

/**
 * Toggle checkbox in a section
 * @param {Map<string, string>} sections
 * @param {string} sectionName
 * @param {string} itemText
 * @param {boolean|'toggle'} checked - true=check, false=uncheck, 'toggle'=flip
 * @returns {{ success: boolean, error?: string }}
 */
function toggleCheckbox(sections: Map<string, string>, sectionName: string, itemText: string, checked: boolean | 'toggle'): OpResult {
  if (!sections.has(sectionName)) {
    return { success: false, error: `Section not found: ${sectionName}` };
  }

  const content: string | undefined = sections.get(sectionName);
  const lines: string[] = (content ?? '').split('\n');
  let found = false;

  const updatedLines: string[] = lines.map((line: string): string => {
    // Match checkbox pattern: - [ ] or - [x] or - [X]
    const checkboxMatch: RegExpMatchArray | null = line.match(/^(\s*-\s*)\[([ xX])\](\s*.*)$/);
    if (checkboxMatch) {
      const [, prefix, currentState, rest] = checkboxMatch as [string, string, string, string];
      const lineText: string = rest.trim();

      // Match by item text (partial match, case-insensitive)
      if (lineText.toLowerCase().includes(itemText.toLowerCase())) {
        found = true;
        let newState: string;
        if (checked === 'toggle') {
          newState = currentState === ' ' ? 'x' : ' ';
        } else {
          newState = checked ? 'x' : ' ';
        }
        return `${prefix}[${newState}]${rest}`;
      }
    }
    return line;
  });

  if (!found) {
    return { success: false, error: `Checkbox item not found: ${itemText}` };
  }

  sections.set(sectionName, updatedLines.join('\n'));
  return { success: true };
}

export interface ApplyOpsResult {
  success: boolean;
  applied: number;
  errors: string[];
}

/**
 * Apply multiple operations
 * @param {Map<string, string>} sections
 * @param {string[]} order
 * @param {object[]} ops
 * @returns {{ success: boolean, applied: number, errors: string[] }}
 */
export function applyOps(sections: Map<string, string>, order: string[], ops: ArtifactOp[]): ApplyOpsResult {
  const errors: string[] = [];
  let applied = 0;

  for (const op of ops) {
    const result: OpResult = applyOp(sections, order, op);
    if (result.success) {
      applied++;
    } else if (result.error) {
      errors.push(result.error);
    }
  }

  return {
    success: errors.length === 0,
    applied,
    errors
  };
}

export interface SearchReplaceOp {
  op: 'search_replace';
  search: string;
  replace: string;
}

/**
 * Parse Aider-style SEARCH/REPLACE blocks into ops
 * @param {string} input - Input containing SEARCH/REPLACE blocks
 * @returns {object[]} Array of ops
 */
export function parseSearchReplace(input: string): SearchReplaceOp[] {
  const ops: SearchReplaceOp[] = [];
  // Allow optional indentation around markers to be forgiving with indented heredocs
  const blockRegex = /^\s*<<<<<<< SEARCH\s*\n(.*?)\n^\s*=======\s*\n(.*?)\n^\s*>>>>>>> REPLACE\s*$/gms;

  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(input)) !== null) {
    const [, searchBlock, replaceBlock] = match as unknown as [string, string, string];
    ops.push({
      op: 'search_replace',
      search: searchBlock,
      replace: replaceBlock
    });
  }

  return ops;
}

export interface SearchReplaceResult {
  success: boolean;
  content?: string;
  error?: string;
}

/**
 * Apply SEARCH/REPLACE operation to raw content
 * @param {string} content - Full file content
 * @param {string} search - Text to search for
 * @param {string} replace - Replacement text
 * @returns {{ success: boolean, content?: string, error?: string }}
 */
export function applySearchReplace(content: string, search: string, replace: string): SearchReplaceResult {
  // Normalize line endings
  const normalizedContent: string = content.replace(/\r\n/g, '\n');
  const normalizedSearch: string = search.replace(/\r\n/g, '\n').trim();
  const normalizedReplace: string = replace.replace(/\r\n/g, '\n').trim();

  if (!normalizedContent.includes(normalizedSearch)) {
    // Try fuzzy match (ignore leading/trailing whitespace per line)
    const searchLines: string[] = normalizedSearch.split('\n').map((l: string) => l.trim());
    const contentLines: string[] = normalizedContent.split('\n');

    let startIdx = -1;
    for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
      let match = true;
      for (let j = 0; j < searchLines.length; j++) {
        if (contentLines[i + j].trim() !== searchLines[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        startIdx = i;
        break;
      }
    }

    if (startIdx === -1) {
      return { success: false, error: 'SEARCH block not found in content' };
    }

    // Replace with proper indentation preserved from first line
    const indentMatch: RegExpMatchArray | null = contentLines[startIdx].match(/^(\s*)/);
    const indent: string = indentMatch ? indentMatch[1] : '';
    const replaceLines: string[] = normalizedReplace.split('\n').map((line: string, idx: number): string => {
      if (idx === 0) return indent + line.trim();
      // Preserve relative indentation
      return indent + line;
    });

    contentLines.splice(startIdx, searchLines.length, ...replaceLines);
    return { success: true, content: contentLines.join('\n') };
  }

  // Exact match
  const newContent: string = normalizedContent.replace(normalizedSearch, normalizedReplace);
  return { success: true, content: newContent };
}

export type EditOp = ArtifactOp | SearchReplaceOp;

/**
 * Read artifact file, apply ops, write back
 * @param {string} filePath - Path to markdown file
 * @param {object[]} ops - Operations to apply
 * @returns {{ success: boolean, applied: number, errors: string[] }}
 */
export function editArtifact(filePath: string, ops: EditOp[]): ApplyOpsResult {
  if (!fs.existsSync(filePath)) {
    return { success: false, applied: 0, errors: [`File not found: ${filePath}`] };
  }

  let content: string = fs.readFileSync(filePath, 'utf8');
  const errors: string[] = [];
  let applied = 0;

  // Handle search_replace ops on raw content first
  const searchReplaceOps: SearchReplaceOp[] = ops.filter((op): op is SearchReplaceOp => op.op === 'search_replace');
  const sectionOps: ArtifactOp[] = ops.filter((op): op is ArtifactOp => op.op !== 'search_replace');

  for (const op of searchReplaceOps) {
    const result: SearchReplaceResult = applySearchReplace(content, op.search, op.replace);
    if (result.success && result.content) {
      content = result.content;
      applied++;
    } else if (result.error) {
      errors.push(result.error);
    }
  }

  // Handle section-based ops
  if (sectionOps.length > 0) {
    const parsed: ParsedMarkdown = parseMarkdownSections(content);
    const result: ApplyOpsResult = applyOps(parsed.sections, parsed.order, sectionOps);
    applied += result.applied;
    errors.push(...result.errors);

    if (result.applied > 0) {
      content = serializeSections(parsed);
    }
  }

  // Write back if any ops applied
  if (applied > 0) {
    fs.writeFileSync(filePath, content);
  }

  return {
    success: errors.length === 0,
    applied,
    errors
  };
}

/**
 * List sections in an artifact
 * @param {string} filePath - Path to markdown file
 * @returns {string[]} Section names
 */
export function listSections(filePath: string): string[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const content: string = fs.readFileSync(filePath, 'utf8');
  const parsed: ParsedMarkdown = parseMarkdownSections(content);
  return parsed.order;
}

/**
 * Get content of a specific section
 * @param {string} filePath - Path to markdown file
 * @param {string} sectionName - Section name
 * @returns {string|null} Section content or null if not found
 */
export function getSection(filePath: string, sectionName: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content: string = fs.readFileSync(filePath, 'utf8');
  const parsed: ParsedMarkdown = parseMarkdownSections(content);
  return parsed.sections.get(sectionName) ?? null;
}

// =============================================================================
// Multi-Section Edit Mini-Language
// =============================================================================

/**
 * Supported operations for multi-section editing
 */
export const SECTION_OPS = ['replace', 'append', 'prepend', 'delete', 'create', 'sed', 'check', 'uncheck', 'toggle', 'patch'];

export interface SedCommand {
  search: string;
  replace: string;
  global: boolean;
}

/**
 * Parse sed-like commands from content
 * Format: s/search/replace/ or s/search/replace/g
 * Supports regex patterns in search
 * @param {string} content - Lines of sed commands
 * @returns {Array<{search: string, replace: string, global: boolean}>}
 */
export function parseSedCommands(content: string): SedCommand[] {
  const commands: SedCommand[] = [];
  const lines: string[] = content.split('\n').filter((l: string) => l.trim());

  for (const line of lines) {
    // Match s/search/replace/ or s/search/replace/g
    // Support different delimiters: s|search|replace| or s#search#replace#
    const match: RegExpMatchArray | null = line.match(/^s([\/|#@])(.+?)\1(.*?)\1(g)?$/);
    if (match) {
      commands.push({
        search: match[2],
        replace: match[3],
        global: !!match[4]
      });
    }
  }

  return commands;
}

/**
 * Apply sed commands to content (supports regex)
 * @param {string} content - Content to modify
 * @param {Array<{search: string, replace: string, global: boolean}>} commands
 * @returns {string} Modified content
 */
export function applySedCommands(content: string, commands: SedCommand[]): string {
  let result: string = content;
  for (const cmd of commands) {
    try {
      const regex = new RegExp(cmd.search, cmd.global ? 'g' : '');
      result = result.replace(regex, cmd.replace);
    } catch {
      // If regex is invalid, fall back to literal string replacement
      if (cmd.global) {
        result = result.split(cmd.search).join(cmd.replace);
      } else {
        result = result.replace(cmd.search, cmd.replace);
      }
    }
  }
  return result;
}

/**
 * Parse multi-section content from stdin/string
 * Format: ## Section Name [op]\nContent...
 * @param {string} content - Raw content with ## headers
 * @param {string} defaultOp - Default operation if not specified (default: 'replace')
 * @returns {Array<{op: string, section: string, content: string, sedCommands?: Array}>}
 */
export function parseMultiSectionContent(content: string, defaultOp = 'replace'): ArtifactOp[] {
  const ops: ArtifactOp[] = [];
  const lines: string[] = content.split('\n');
  let currentSection: string | null = null;
  let currentOp: string = defaultOp;
  let currentContent: string[] = [];

  const opPattern: string = SECTION_OPS.join('|');
  const headerRegex = new RegExp(`^##\\s+(.+?)(?:\\s+\\[(${opPattern})\\])?\\s*$`);

  for (const line of lines) {
    const match: RegExpMatchArray | null = line.match(headerRegex);
    if (match) {
      // Save previous section
      if (currentSection) {
        const op: ArtifactOp = {
          op: currentOp,
          section: currentSection,
          content: currentContent.join('\n').trim()
        };
        if (currentOp === 'sed') {
          op.sedCommands = parseSedCommands(op.content ?? '');
        }
        ops.push(op);
      }
      currentSection = match[1].trim();
      currentOp = match[2] ?? defaultOp;
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(line);
    }
  }

  // Save last section
  if (currentSection) {
    const op: ArtifactOp = {
      op: currentOp,
      section: currentSection,
      content: currentContent.join('\n').trim()
    };
    if (currentOp === 'sed') {
      op.sedCommands = parseSedCommands(op.content ?? '');
    }
    ops.push(op);
  }

  return ops;
}

/**
 * Parse checkbox items from content
 * Strips leading - [ ] or - [x] markers
 * @param {string} content - Lines of checkbox items
 * @returns {string[]} Item texts
 */
export function parseCheckboxItems(content: string): string[] {
  return content.split('\n')
    .map((l: string) => l.replace(/^-\s*\[[ xX]\]\s*/, '').trim())
    .filter((l: string) => l.length > 0);
}

export interface ProcessMultiSectionOpsResult {
  expandedOps: ArtifactOp[];
  errors: string[];
}

/**
 * Process multi-section ops (expand sed, patch, check operations)
 * @param {string} filePath - Path to the artifact file
 * @param {Array} ops - Parsed operations from parseMultiSectionContent
 * @returns {{ expandedOps: Array, errors: string[] }}
 */
export function processMultiSectionOps(filePath: string, ops: ArtifactOp[]): ProcessMultiSectionOpsResult {
  const expandedOps: ArtifactOp[] = [];
  const errors: string[] = [];

  for (const op of ops) {
    if (op.op === 'sed' && op.sedCommands && op.sedCommands.length > 0) {
      const sectionContent: string | null = getSection(filePath, op.section);
      if (sectionContent === null) {
        errors.push(`Section not found for sed: ${op.section}`);
        continue;
      }
      expandedOps.push({
        op: 'replace',
        section: op.section,
        content: applySedCommands(sectionContent, op.sedCommands)
      });
    } else if (op.op === 'patch') {
      const patches: SearchReplaceOp[] = parseSearchReplace(op.content ?? '');
      if (patches.length === 0) {
        errors.push(`No SEARCH/REPLACE blocks found for patch: ${op.section}`);
        continue;
      }
      let sectionContent: string | null = getSection(filePath, op.section);
      if (sectionContent === null) {
        errors.push(`Section not found for patch: ${op.section}`);
        continue;
      }
      let patchError: string | null = null;
      for (const patch of patches) {
        const result: SearchReplaceResult = applySearchReplace(sectionContent, patch.search, patch.replace);
        if (!result.success) {
          patchError = `Patch failed on ${op.section}: ${result.error ?? 'unknown error'}`;
          break;
        }
        sectionContent = result.content ?? '';
      }
      if (patchError) {
        errors.push(patchError);
        continue;
      }
      expandedOps.push({
        op: 'replace',
        section: op.section,
        content: sectionContent
      });
    } else if (['check', 'uncheck', 'toggle'].includes(op.op)) {
      for (const item of parseCheckboxItems(op.content ?? '')) {
        expandedOps.push({
          op: op.op,
          section: op.section,
          item
        });
      }
    } else {
      expandedOps.push(op);
    }
  }

  return { expandedOps, errors };
}
