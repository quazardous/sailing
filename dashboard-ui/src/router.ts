/**
 * URL Router - pushState-based navigation
 *
 * Lightweight router using history.pushState() for:
 * - Sharing/bookmarking artefact or agent selection
 * - Browser back/forward support
 * - Deep linking (direct access to artefacts)
 *
 * URL Structure:
 * /                      -> Welcome (default)
 * /artefacts             -> Artefacts, no selection
 * /artefacts/PRD-001     -> PRD-001 selected
 * /artefacts/E001        -> Epic E001 selected
 * /artefacts/T042        -> Task T042 selected
 * /agents                -> Agents list
 * /agents/T001           -> Agent T001 selected
 * /settings              -> Settings
 */

export type ActivityType = 'welcome' | 'artefacts' | 'agents' | 'settings';

export interface RouteState {
  activity: ActivityType;
  selectedId?: string;
}

const VALID_ACTIVITIES: ActivityType[] = ['welcome', 'artefacts', 'agents', 'settings'];

/**
 * Parse URL pathname into route state
 */
export function parseUrl(url: string = window.location.pathname): RouteState {
  const parts = url.split('/').filter(Boolean);

  // Empty path -> welcome
  if (parts.length === 0) {
    return { activity: 'welcome' };
  }

  const activity = parts[0] as ActivityType;

  // Invalid activity -> welcome
  if (!VALID_ACTIVITIES.includes(activity)) {
    return { activity: 'welcome' };
  }

  // Welcome doesn't have selections
  if (activity === 'welcome') {
    return { activity: 'welcome' };
  }

  return {
    activity,
    selectedId: parts[1] || undefined,
  };
}

/**
 * Build URL from route state
 */
export function buildUrl(state: RouteState): string {
  if (state.activity === 'welcome') {
    return '/';
  }

  if (!state.selectedId) {
    return `/${state.activity}`;
  }

  return `/${state.activity}/${state.selectedId}`;
}

/**
 * Push new URL to history (adds entry, enables back button)
 */
export function pushUrl(state: RouteState): void {
  const url = buildUrl(state);
  if (url !== window.location.pathname) {
    history.pushState(state, '', url);
  }
}

/**
 * Replace current URL (no history entry)
 */
export function replaceUrl(state: RouteState): void {
  const url = buildUrl(state);
  history.replaceState(state, '', url);
}

/**
 * Get current route state from URL
 */
export function getCurrentRoute(): RouteState {
  return parseUrl(window.location.pathname);
}

/**
 * Check if current URL matches a route state
 */
export function matchesRoute(state: RouteState): boolean {
  return buildUrl(state) === window.location.pathname;
}
