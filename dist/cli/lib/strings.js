/**
 * String utilities - Pure functions for string manipulation
 *
 * NO I/O, NO CONFIG, NO PATHS - pure transformations only
 */
/**
 * Convert string to kebab-case
 * "Hello World" → "hello-world"
 * "Some_Thing Here" → "some-thing-here"
 * "Café à la crème" → "cafe-a-la-creme"
 */
export function toKebab(str) {
    return str
        // Normalize to NFD (decomposed) then remove diacritical marks
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}
/**
 * Strip HTML comments from markdown content
 * Removes <!-- ... --> (single and multi-line)
 * Also removes # comments from YAML frontmatter
 */
export function stripComments(content) {
    // Split frontmatter and body
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) {
        // No frontmatter, just strip HTML comments from body
        return content
            .replace(/<!--[\s\S]*?-->\n?/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
    const [, frontmatter, body] = match;
    // Strip # comments from frontmatter (but keep values with # in them)
    const cleanFrontmatter = frontmatter
        .split('\n')
        .filter(line => !line.trim().startsWith('#'))
        .map(line => line.replace(/\s+#\s+.*$/, ''))
        .join('\n');
    // Strip HTML comments from body and clean up extra blank lines
    const cleanBody = body
        .replace(/<!--[\s\S]*?-->\n?/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return `---\n${cleanFrontmatter}\n---\n\n${cleanBody}`;
}
/**
 * JSON output helper
 */
export function jsonOut(data) {
    console.log(JSON.stringify(data, null, 2));
}
/**
 * Validate HTML comments are properly closed
 * Returns list of unclosed comment positions
 */
export function validateHtmlComments(content) {
    const unclosedAt = [];
    let pos = 0;
    while (pos < content.length) {
        const openIdx = content.indexOf('<!--', pos);
        if (openIdx === -1)
            break;
        const closeIdx = content.indexOf('-->', openIdx + 4);
        if (closeIdx === -1) {
            unclosedAt.push(openIdx);
            break; // No more closing tags possible
        }
        pos = closeIdx + 3;
    }
    return { valid: unclosedAt.length === 0, unclosedAt };
}
/**
 * Check if content has unclosed HTML comments
 * Throws error with details if invalid
 */
export function assertValidHtmlComments(content, context) {
    const result = validateHtmlComments(content);
    if (!result.valid) {
        const positions = result.unclosedAt.map(pos => {
            const lineNum = content.slice(0, pos).split('\n').length;
            const preview = content.slice(pos, pos + 50).replace(/\n/g, '\\n');
            return `line ${lineNum}: "${preview}..."`;
        }).join(', ');
        throw new Error(`Unclosed HTML comment${context ? ` in ${context}` : ''}: ${positions}`);
    }
}
