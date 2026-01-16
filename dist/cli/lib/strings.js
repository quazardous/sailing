/**
 * String utilities - Pure functions for string manipulation
 *
 * NO I/O, NO CONFIG, NO PATHS - pure transformations only
 */
/**
 * Convert string to kebab-case
 * "Hello World" → "hello-world"
 * "Some_Thing Here" → "some-thing-here"
 */
export function toKebab(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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
