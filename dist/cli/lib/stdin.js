/**
 * Stdin Utilities
 *
 * PURE LIB: No config access, no manager imports.
 */
/**
 * Read all content from stdin.
 * Returns empty string if stdin is a TTY (interactive terminal).
 *
 * @example
 * const content = await readStdin();
 * if (!content) {
 *   console.error('No input provided');
 *   process.exit(1);
 * }
 */
export async function readStdin() {
    return new Promise((resolve) => {
        let data = '';
        // If stdin is a TTY, there's no piped input
        if (process.stdin.isTTY) {
            resolve('');
            return;
        }
        process.stdin.setEncoding('utf8');
        process.stdin.on('readable', () => {
            let chunk;
            while ((chunk = process.stdin.read()) !== null) {
                data += chunk;
            }
        });
        process.stdin.on('end', () => resolve(data));
    });
}
