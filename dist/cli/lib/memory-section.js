/**
 * Extract all sections from memory markdown content
 * @param {string} content - Markdown content
 * @returns {Array<{name: string, content: string}>}
 */
export function extractAllSections(content) {
    const sections = [];
    // Split content by section headers (## at start of line)
    const parts = content.split(/^(?=## )/m);
    for (const part of parts) {
        // Check if this part starts with a section header
        const match = part.match(/^## ([^\n]+)\n([\s\S]*)/);
        if (!match)
            continue;
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
export function findSection(content, sectionName) {
    const sectionHeader = `## ${sectionName}`;
    // Match section header followed by content until next ## or end
    // Use [ \t]* instead of \s* to avoid consuming newlines needed for lookahead
    const sectionRegex = new RegExp(`(${escapeRegex(sectionHeader)}[ \\t]*\\n)([\\s\\S]*?)(?=\\n## |$)`);
    const match = content.match(sectionRegex);
    if (!match)
        return null;
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
export function editSection(content, sectionName, newContent, operation = 'replace') {
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
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
export function parseMultiSectionInput(input) {
    const headerRegex = /^## ([A-Z0-9-]+):(.+?)(?:\s*\[(append|prepend|replace)\])?\s*$/gm;
    const matches = [];
    let match;
    // Find all section headers
    while ((match = headerRegex.exec(input)) !== null) {
        matches.push({
            fullMatch: match[0],
            id: match[1].toUpperCase(),
            section: match[2].trim(),
            operation: match[3] || 'replace',
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
/**
 * Agent-relevant section names
 * These are the only sections shown to agents by default
 */
export const AGENT_RELEVANT_SECTIONS = [
    'Agent Context',
    'Escalation',
    'Cross-Epic Patterns',
    'Architecture Decisions',
    'Patterns & Conventions'
];
/**
 * Parse log content and count log levels
 * @param content - Log file content
 * @returns Counts per log level
 */
export function parseLogLevels(content) {
    const counts = { TIP: 0, INFO: 0, WARN: 0, ERROR: 0, CRITICAL: 0 };
    const lines = content.split('\n');
    for (const line of lines) {
        if (!line.trim())
            continue;
        const match = line.match(/ \[T\d+\]\s*\[(\w+)\]|\[(\w+)\]/);
        if (match) {
            const level = (match[1] || match[2]).toUpperCase();
            if (Object.prototype.hasOwnProperty.call(counts, level)) {
                counts[level]++;
            }
        }
    }
    return counts;
}
