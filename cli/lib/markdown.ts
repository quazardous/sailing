/**
 * Markdown utilities - Pure functions for markdown/frontmatter parsing
 *
 * NO I/O, NO CONFIG, NO PATHS - pure transformations only
 */
import matter from 'gray-matter';

export interface ParsedDoc<T = Record<string, any>> {
  data: T;
  body: string;
}

/**
 * Parse markdown content with frontmatter
 * Returns { data, body } where data is the frontmatter object
 *
 * If no frontmatter, attempts to extract data from markdown headers:
 * - Title from # heading (parses "T001: Title" format)
 * - Status from ## Status section
 * - Parent from ## Parent section
 * - Assignee from ## Assignee section
 * - blocked_by from ## Blocked By section
 */
export function parseMarkdown<T = Record<string, any>>(content: string): ParsedDoc<T> {
  const { data, content: body } = matter(content);

  // Fallback: parse markdown headers if no frontmatter
  if (Object.keys(data).length === 0) {
    // Extract title from # heading
    const titleMatch = body.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      const fullTitle = titleMatch[1];
      // Parse "T001: Title" or "PRD-001: Title" format
      const idMatch = fullTitle.match(/^([A-Z]+-?\d+):\s*(.*)$/);
      if (idMatch) {
        data.id = idMatch[1];
        data.title = idMatch[2];
      } else {
        data.title = fullTitle;
      }
    }

    // Extract status from ## Status section
    const statusMatch = body.match(/^## Status\s*\n+([^\n#]+)/m);
    if (statusMatch) {
      data.status = statusMatch[1].trim().split(/\s*\|\s*/)[0].trim();
    }

    // Extract parent from ## Parent section
    const parentMatch = body.match(/^## Parent\s*\n+([^\n#]+)/m);
    if (parentMatch) {
      data.parent = parentMatch[1].trim();
    }

    // Extract assignee from ## Assignee section
    const assigneeMatch = body.match(/^## Assignee\s*\n+([^\n#]+)/m);
    if (assigneeMatch) {
      data.assignee = assigneeMatch[1].trim();
    }

    // Extract blocked_by from ## Blocked By section
    const blockedMatch = body.match(/^## Blocked By\s*\n+([\s\S]*?)(?=\n##|\n*$)/m);
    if (blockedMatch) {
      const blockedText = blockedMatch[1].trim();
      if (blockedText === '- None' || blockedText === 'None' || blockedText === '') {
        data.blocked_by = [];
      } else {
        data.blocked_by = blockedText.split('\n')
          .map(l => l.replace(/^-\s*/, '').trim())
          .filter(l => l && l !== 'None');
      }
    } else {
      data.blocked_by = [];
    }
  }

  return { data: data as T, body };
}

/**
 * Stringify data and body back to markdown with frontmatter
 */
export function stringifyMarkdown(data: any, body: string): string {
  // Ensure body starts with blank line for readability
  const cleanBody = body.startsWith('\n') ? body : '\n' + body;
  return matter.stringify(cleanBody, data);
}
