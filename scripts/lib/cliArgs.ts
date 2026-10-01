/**
 * Flag-operand parsing shared by the catalogue-sync and restore CLIs. Looking up `argv[i + 1] ??
 * null` for a flag's operand silently accepts a flag with no operand (the next token missing, or
 * itself another flag) and reads that as `undefined`/absent instead of failing — a `--ids` with
 * no value then means "no id filter" rather than "stop".
 */

/** Returns the operand following `flag` in `argv`. Null when the flag is absent; throws when the
 *  flag is present but has no operand (end of argv, or the next token looks like another flag). */
export const flagValue = (argv: string[], flag: string): string | null => {
    const i = argv.indexOf(flag);
    if (i < 0) return null;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('-')) {
        throw new Error(`${flag} needs a value`);
    }
    return value;
};

/** Parses a comma-separated id list (e.g. `--ids A, B`), trimming whitespace and dropping empty
 *  entries. Throws rather than returning an empty list, since an empty id filter would widen a
 *  restore's scope from "these ids" to "every row". */
export const parseIds = (raw: string): string[] => {
    const ids = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    if (ids.length === 0) throw new Error('--ids needs at least one non-empty id');
    return ids;
};
