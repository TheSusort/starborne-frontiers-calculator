/** The `family` / `unremovable` fields a DOT_TIER_MAP entry contributes to a DoT entry or config;
 *  empty for a plain DoT. */
export function dotFlagsOf(info: { family?: string; unremovable?: boolean }): {
    family?: string;
    unremovable?: boolean;
} {
    return {
        ...(info.family !== undefined ? { family: info.family } : {}),
        ...(info.unremovable ? { unremovable: true } : {}),
    };
}
