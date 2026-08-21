import type { AbilityTarget } from '../../types/abilities';
import type { CombatActor } from './state';

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
    // this helper has no access to) via `lowestHpAllyRecipients` below, and the caller USES that
    // result directly rather than routing it back through this function — this helper has no way
    // to verify a `baseRecipients` it receives was actually produced that way. This is a BACKSTOP,
    // not the routing rule: the routing rule is that each caller resolves the selector itself (see
    // `lowestHpAllyRecipients` and its call sites). Reaching this branch AT ALL means a caller
    // forgot that and handed this function an unresolved base — fail loudly rather than guess.
    //
    // A silent clamp (`slice(0, 1)`) would fail exactly the way this variant must never fail: on a
    // real roster the caster sits in `baseRecipients`, usually first, so clamping to the first id
    // would extend the CASTER's own buff — the one answer "the OTHER ally" forbids. And a length
    // check alone cannot rescue that clamp: an unresolved lone-caster roster is ALSO length 1 (just
    // `[casterId]`), so "pass a length-1 base through unchanged" reproduces the identical bug this
    // fix exists to kill. There is no length of `baseRecipients` this function can treat as
    // self-evidently pre-resolved, so it always throws rather than sometimes guessing right.
    if (args.target === 'lowest-hp-ally') {
        throw new Error(
            `resolveSupportRecipients: 'lowest-hp-ally' must be resolved by the caller via ` +
                `lowestHpAllyRecipients and used directly — it must never be routed through ` +
                `resolveSupportRecipients (got ${args.baseRecipients.length} baseRecipients)`
        );
    }

    const { footprintAllyIds, baseRecipients } = args;
    // ⚠️ `undefined` means "DO NOT NARROW", and it deliberately does NOT distinguish "this pattern
    // reaches no ally" from "no pattern was threaded here". Kept as-is by owner ruling 2026-08-21;
    // do not split it into two outcomes.
    //
    // Since SP-4e Task 4 that fallback is much wider than it looks. `recipientsFor` (playerTurn.ts)
    // now hands a plain `'ally'` clause the caster's whole own side as `baseRecipients`, where it
    // used to hand a single id (the heal anchor / the lowest-HP ally). So on any caster with a
    // non-support pattern — most visibly the healing calculator's TEAM actors, which are threaded
    // no pattern at all and therefore run on `DEFAULT_BASE_PATTERN` (see HealingCalculatorPage's
    // placement-warning block) — an ally-targeted support clause reaches EVERY same-side actor,
    // the caster included. Intended for now; it narrows on its own once real team-actor patterns
    // are threaded into the adapter.
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
 * own scope has. Two requirements on that supplied reader, both load-bearing for callers:
 *  (a) the documented source-order tie-break only means anything if `candidateIds` ALSO arrives
 *      in a stable source order — this function does not sort; a caller feeding it an
 *      unordered/reshuffled id list gets a tie-break that looks deterministic but is not the
 *      documented one.
 *  (b) `hpFractionOf` must read BUFF-AWARE max HP where the caller has one available (the
 *      healing-mode `recipientMaxHp` accessor), not raw `stats.hp` — a caster with access to both
 *      must prefer the buff-aware one. `allyHpFraction` (below) is the shared reader that gets
 *      both (a) and (b) right; prefer it over a hand-rolled `hpFractionOf`.
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

/**
 * SP-4e: shared buff-aware live-HP-fraction reader for `lowestHpAllyRecipients.hpFractionOf` —
 * lifted out of `runPlayerTurn` (originally a local closure there) so every caller reads maxHp
 * through the same accessor rather than each hand-rolling its own (the divergence risk: a
 * hand-rolled reader silently falling back to raw `stats.hp` and missing buff-aware max HP).
 *
 * Reads `healing.recipientActor`/`recipientMaxHp` (buff-aware, authoritative) when a healing
 * runtime ctx is supplied; falls back to the live `sameSideLiving` roster (raw `stats.hp`)
 * otherwise. Returns `undefined` when `id` is unknown to whichever source is in play, or the
 * resolved actor is at/below 0 HP.
 */
export function allyHpFraction(args: {
    id: string;
    healing?: {
        recipientActor: (id: string) => CombatActor | undefined;
        recipientMaxHp: (id: string) => number;
    };
    sameSideLiving?: CombatActor[];
}): number | undefined {
    const a = args.healing
        ? args.healing.recipientActor(args.id)
        : args.sameSideLiving?.find((candidate) => candidate.id === args.id);
    if (!a || a.currentHp <= 0) return undefined;
    const maxHp = args.healing ? args.healing.recipientMaxHp(args.id) : a.stats.hp;
    return maxHp > 0 ? a.currentHp / maxHp : 0;
}
