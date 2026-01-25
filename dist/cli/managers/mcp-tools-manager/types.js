export function detectType(id) {
    if (/^T\d+$/i.test(id))
        return 'task';
    if (/^E\d+$/i.test(id))
        return 'epic';
    if (/^PRD-?\d+$/i.test(id))
        return 'prd';
    if (/^S\d+$/i.test(id))
        return 'story';
    return 'unknown';
}
export function normalizeId(id) {
    return id.toUpperCase().replace(/^PRD(\d)/, 'PRD-$1');
}
// =============================================================================
// Response Helpers
// =============================================================================
export function ok(result) {
    return {
        content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2)
            }]
    };
}
export function err(message, nextActions) {
    const result = {
        success: false,
        error: message,
        next_actions: nextActions
    };
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: true
    };
}
export function fromRunResult(result, nextActions) {
    if (result.success) {
        // Try to parse JSON output
        let data = result.output || '';
        try {
            data = JSON.parse(result.output || '');
        }
        catch { /* keep as string */ }
        return ok({
            success: true,
            data,
            next_actions: nextActions
        });
    }
    return err(`${result.error}\n${result.stderr || ''}`, nextActions);
}
