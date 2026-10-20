const IGNORED_ERRORS = [/^Script error\.?$/, /^ResizeObserver loop/];

export function isIgnoredError(message: string): boolean {
    return IGNORED_ERRORS.some((pattern) => pattern.test(message));
}

/**
 * The first stack frame with origin, bundle hash and line:column removed, so a rebuild of the same
 * code keeps the same fingerprint.
 */
export function topFrame(stack: string | undefined): string {
    const frame = stack?.split('\n').find((line) => /\bat\b|@/.test(line)) ?? '';
    return frame
        .trim()
        .replace(/https?:\/\/[^/\s)]+/g, '')
        .replace(/-[A-Za-z0-9_]{8}\.js/g, '.js')
        .replace(/(:\d+)+(?=\)|$)/g, '');
}

/** FNV-1a over message + top frame, as 8 hex chars. */
export function errorFingerprint(message: string, stack: string | undefined): string {
    const input = `${message}|${topFrame(stack)}`;
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}
