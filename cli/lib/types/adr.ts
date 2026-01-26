/**
 * ADR (Architecture Decision Records) types
 */

export type AdrStatus = 'Proposed' | 'Accepted' | 'Deprecated' | 'Superseded';

/**
 * ADR frontmatter data
 */
export interface Adr {
  id: string;           // ADR-001
  title: string;
  status: AdrStatus;
  created: string;      // ISO date string
  author?: string;
  tags?: string[];
  domain?: string;      // For filtering in prompts (e.g., 'core', 'api', 'frontend')
  supersedes?: string;  // ADR-XXX if this replaces an older ADR
  superseded_by?: string; // ADR-XXX if this was replaced
  introduced_in?: string; // component/version when decision was introduced (e.g., 'core/1.18.0')
}

/**
 * ADR index entry (for listing/searching)
 */
export interface AdrIndexEntry {
  id: string;
  file: string;
  data: Partial<Adr>;
  createdAt: string;   // ISO date string
  modifiedAt: string;  // ISO date string
}

/**
 * ADR with full content
 */
export interface FullAdr extends Adr {
  filePath: string;
  body: string;         // Markdown content
  context?: string;     // Extracted from ## Contexte/Context section
  decision?: string;    // Extracted from ## Decision/Décision section
}
