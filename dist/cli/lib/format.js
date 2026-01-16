/**
 * Formatting utilities - locale detection
 *
 * PURE LIB: No config access, no manager imports.
 * Accepts env parameter for testability.
 */
/**
 * Get the system locale (from environment)
 * Returns undefined if no locale detected (uses system default)
 * @param env - Environment variables (defaults to process.env)
 */
export function getSystemLocale(env = process.env) {
    // Check common environment variables for locale
    const envLocale = env.LC_ALL || env.LC_TIME || env.LANG || env.LANGUAGE;
    if (envLocale) {
        // Extract locale code (e.g., "fr_FR.UTF-8" -> "fr-FR")
        const match = envLocale.match(/^([a-z]{2})[-_]([A-Z]{2})/i);
        if (match) {
            return `${match[1]}-${match[2].toUpperCase()}`;
        }
        // Simple locale (e.g., "fr" or "en")
        const simple = envLocale.match(/^([a-z]{2})/i);
        if (simple) {
            return simple[1];
        }
    }
    // Return undefined to use system default
    return undefined;
}
