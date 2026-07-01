import type { AbilityTarget } from '../../types/abilities';

/**
 * Narrow ally-targeted support recipients to a friendly pattern footprint.
 *
 * When `footprintAllyIds` is omitted, returns `baseRecipients` unchanged (legacy /
 * non-positional callers). When supplied, every target type is intersected with the footprint.
 */
export function resolveSupportRecipients(args: {
    target: AbilityTarget;
    casterId: string;
    baseRecipients: string[];
    footprintAllyIds?: string[];
}): string[] {
    const { footprintAllyIds, baseRecipients } = args;
    if (footprintAllyIds === undefined) return baseRecipients;

    const allowed = new Set(footprintAllyIds);
    return baseRecipients.filter((id) => allowed.has(id));
}
