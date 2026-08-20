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
    // SP-4e: a named single-recipient selector is resolved by the CALLER (it needs live HP, which
    // this helper has no access to). Callers pass an already-resolved one-id array. Reaching here
    // with a multi-id base means a caller forgot to resolve it and is about to fan a
    // single-recipient heal out to the whole roster — clamp rather than widen.
    // This is a BACKSTOP, not the routing rule: the routing rule is that each caller resolves the
    // selector itself (see `lowestHpAllyRecipients` below and its call sites). It also bypasses
    // the footprint intersection deliberately — 'lowest-hp-ally' is never narrowed by the
    // caster's support footprint; it reaches its ally wherever they stand.
    if (args.target === 'lowest-hp-ally') return args.baseRecipients.slice(0, 1);

    const { footprintAllyIds, baseRecipients } = args;
    if (footprintAllyIds === undefined) return baseRecipients;

    const allowed = new Set(footprintAllyIds);
    return baseRecipients.filter((id) => allowed.has(id));
}

/**
 * SP-4e: resolve the `'lowest-hp-ally'` selector — the living same-side ally with the lowest
 * currentHp/maxHp, CASTER EXCLUDED, ties broken by source order.
 *
 * Returns an EMPTY array when the caster is the only living candidate: "the OTHER ally" means
 * nobody, not a self-heal. (This is why it is not simply `resolveSupportRecipients` with a
 * narrower base — the no-recipient answer is part of the selector's meaning.)
 *
 * `hpFractionOf` returns `undefined` for an id that is not a living candidate (unknown to the
 * caller's HP source, or at/below 0 HP), so each caller can supply whichever live-HP view its
 * own scope has.
 */
export function lowestHpAllyRecipients(args: {
    casterId: string;
    candidateIds: string[];
    hpFractionOf: (id: string) => number | undefined;
}): string[] {
    let best: string | undefined;
    let bestFraction = Infinity;
    for (const id of args.candidateIds) {
        if (id === args.casterId) continue;
        const fraction = args.hpFractionOf(id);
        if (fraction === undefined) continue;
        if (fraction < bestFraction) {
            bestFraction = fraction;
            best = id;
        }
    }
    return best === undefined ? [] : [best];
}
