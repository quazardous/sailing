/**
 * Memory section editing library
 *
 * Provides section extraction and editing for memory files.
 * Memory files have a simpler structure than artifacts (no code blocks).
 */

type Section = { name: string; content: string };
type FoundSection = { header: string; content: string; match: RegExpMatchArray };
type EditOperation = 'replace' | 'append' | 'prepend';
type EditResult =
  | { success: true; content: string }
  | { warning: string }
  | { success: false; error: string };
type ParsedSection = { id: string; section: string; operation: EditOperation; content: string };

/**
 * Extract all sections from memory markdown content
 * @param {string} content - Markdown content
 * @returns {Array<{name: string, content: string}>}
 */
export function extractAllSections(content: string): Section[] {
  const sections: Section[] = [];

  // Split content by section headers (## at start of line)
  const parts = content.split(/^(?=## )/m);

  for (const part of parts) {
    // Check if this part starts with a section header
    const match = part.match(/^## ([^\n]+)\n([\s\S]*)/);
    if (!match) continue;

    const sectionName = match[1].trim();
    let sectionContent = match[2];

    // Strip HTML comments
    sectionContent = sectionContent.replace(/<!--[\s\S]*?-->/g, '').trim();

    if (sectionContent) {
      sections.push({ name: sectionName, content: sectionContent });
    }
  }
  return sections;
}

/**
 * Find a section in memory content
 * @param {string} content - Markdown content
 * @param {string} sectionName - Section name (without ##)
 * @returns {{header: string, content: string, match: RegExpMatchArray}|null}
 */
export function findSection(content: string, sectionName: string): FoundSection | null {
  const sectionHeader = `## ${sectionName}`;
  // Match section header followed by content until next ## or end
  // Use [ \t]* instead of \s* to avoid consuming newlines needed for lookahead
  const sectionRegex = new RegExp(`(${escapeRegex(sectionHeader)}[ \\t]*\\n)([\\s\\S]*?)(?=\\n## |$)`);
  const match = content.match(sectionRegex);

  if (!match) return null;

  return {
    header: match[1],
    content: match[2].replace(/<!--[\s\S]*?-->/g, '').trim(),
    match
  };
}

/**
 * Edit a section in memory content
 * @param {string} content - Full markdown content
 * @param {string} sectionName - Section name to edit
 * @param {string} newContent - New content for the section
 * @param {'replace'|'append'|'prepend'} operation - Edit operation
 * @returns {{success: boolean, content?: string, error?: string, warning?: string}}
 */
export function editSection(
  content: string,
  sectionName: string,
  newContent: string,
  operation: EditOperation = 'replace'
): EditResult {
  const section = findSection(content, sectionName);

  if (!section) {
    return { warning: `Section "${sectionName}" not found` };
  }

  const existingContent = section.content;
  let newSectionContent;

  switch (operation) {
    case 'append':
      newSectionContent = existingContent ? `${existingContent}\n${newContent}` : newContent;
      break;
    case 'prepend':
      newSectionContent = existingContent ? `${newContent}\n${existingContent}` : newContent;
      break;
    case 'replace':
    default:
      newSectionContent = newContent;
      break;
  }

  const updatedContent = content.replace(section.match[0], `${section.header}${newSectionContent}\n\n`);

  return { success: true, content: updatedContent };
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse multi-section input format
 * Format: ## ID:Section [operation]
 * @param {string} input - Multi-section input
 * @returns {Array<{id: string, section: string, operation: string, content: string}>}
 */
export function parseMultiSectionInput(input: string): ParsedSection[] {
  const headerRegex = /^## ([A-Z0-9-]+):(.+?)(?:\s*\[(append|prepend|replace)\])?\s*$/gm;
  const matches = [];
  let match: RegExpExecArray | null;

  // Find all section headers
  while ((match = headerRegex.exec(input)) !== null) {
    matches.push({
      fullMatch: match[0],
      id: match[1].toUpperCase(),
      section: match[2].trim(),
      operation: (match[3] as EditOperation | undefined) || 'replace',
      index: match.index
    });
  }

  // Extract content for each section
  const sections = [];
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const nextIndex = matches[i + 1]?.index ?? input.length;
    const headerEnd = current.index + current.fullMatch.length;
    const content = input.slice(headerEnd, nextIndex).trim();

    sections.push({
      id: current.id,
      section: current.section,
      operation: current.operation,
      content
    });
  }

  return sections;
}
