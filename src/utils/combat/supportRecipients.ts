import type { AbilityTarget, RecipientFilter } from '../../types/abilities';
import type { FactionKey } from '../../constants/factions';
import { matchesRoleCategory, type ShipTypeName } from '../../constants/shipTypes';
import type { CombatActor } from './state';

/**
 * Narrow ally-targeted support recipients to a friendly pattern footprint, then (#363) to a
 * recipient FACTION scope.
 *
 * When `footprintAllyIds` is omitted, returns `baseRecipients` unchanged (legacy /
 * non-positional callers). When supplied, every target type is intersected with the footprint.
 */
export function resolveSupportRecipients(args: {
    target: AbilityTarget;
    casterId: string;
    baseRecipients: string[];
    footprintAllyIds?: string[];
    /** #363: intersect with recipients of these factions. Absent (or empty) → no faction
     *  narrowing, byte-identical to every pre-#363 caller. */
    factionFilter?: FactionKey[];
    /** Actor id → faction. `undefined` for an actor whose faction is unknown, which NEVER
     *  matches a filter (conservative). Absent reader + present filter → nobody matches, which
     *  is the same conservative answer. */
    factionOf?: (id: string) => FactionKey | undefined;
}): string[] {
    // A named single-recipient selector is resolved by the CALLER (it needs live HP, which
    // this helper has no access to) via `lowestHpAllyRecipients` below, and the caller USES that
    // result directly rather than routing it back through this function — this helper has no way
    // to verify a `baseRecipients` it receives was actually produced that way. This is a BACKSTOP,
    // not the routing rule: the routing rule is that each caller resolves the selector itself (see
    // `lowestHpAllyRecipients`). Reaching this branch AT ALL means a caller
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

    const { footprintAllyIds, baseRecipients, factionFilter, factionOf } = args;
    // ⚠️ `undefined` means "DO NOT NARROW", and it deliberately does NOT distinguish "this pattern
    // reaches no ally" from "no pattern was threaded here". Kept as-is by owner ruling 2026-08-21;
    // do not split it into two outcomes.
    //
    // That fallback is much wider than it looks. `recipientsFor` (playerTurn.ts) hands a plain
    // `'ally'` clause the caster's WHOLE OWN SIDE as `baseRecipients`, not a single id. So on any
    // caster with a non-support pattern — most visibly the healing calculator's TEAM actors,
    // which are threaded no pattern at all and therefore run on `DEFAULT_BASE_PATTERN` (see
    // HealingCalculatorPage's placement-warning block) — an ally-targeted support clause reaches
    // EVERY same-side actor, the caster included. It narrows on its own once real team-actor
    // patterns are threaded into the adapter.
    const afterFootprint =
        footprintAllyIds === undefined
            ? baseRecipients
            : ((allowed) => baseRecipients.filter((id) => allowed.has(id)))(
                  new Set(footprintAllyIds)
              );

    // #363: faction narrowing composes ON TOP of the footprint — the pattern says which allies
    // the cast reaches, the faction says which of those qualify.
    return narrowByFaction(afterFootprint, factionFilter, factionOf);
}

/**
 * #363: intersect `ids` with a recipient FACTION scope. Shared by every one of the four sites
 * that apply `Ability.factionFilter` (the timed cast-path loop via `resolveSupportRecipients`
 * above, the aura/accumulating registration fan-out, the passive combat-start seed, and the
 * reactive support-recipient resolver) so all four narrow identically.
 *
 * An absent-or-empty filter means no narrowing (byte-identical to every pre-#363 caller). An
 * actor whose faction is unknown (`factionOf` returns `undefined`, or `factionOf` itself is
 * absent) NEVER matches a filter — conservative: a faction-scoped grant can only under-reach,
 * never over-reach, when faction data is missing.
 */
export function narrowByFaction(
    ids: string[],
    factionFilter: FactionKey[] | undefined,
    factionOf: ((id: string) => FactionKey | undefined) | undefined
): string[] {
    if (!factionFilter || factionFilter.length === 0) return ids;
    const wanted = new Set<FactionKey>(factionFilter);
    return ids.filter((id) => {
        const f = factionOf?.(id);
        return f !== undefined && wanted.has(f);
    });
}

/**
 * Intersect `ids` with an `Ability.recipientFilter` — the recipient-STATE narrowing that composes
 * on top of the footprint (which allies the pattern reaches) and the faction scope (which of those
 * qualify by roster). This one asks about each ally's LIVE state: what it is holding, what role it
 * plays, how hurt it is.
 *
 * Deliberately shaped like {@link narrowByFaction}: an absent filter means no narrowing
 * (byte-identical for every ability that does not carry one), and a reader the caller could not
 * supply makes its axis EXCLUDE rather than admit. A grant can therefore only under-reach when
 * data is missing, never over-reach — the same conservative direction `narrowByFaction` and
 * `matchesRoleCategory` already run on.
 *
 * ⚠️ NOT applied at every site `factionFilter` is. That one runs at FOUR (the registration
 * fan-out, the cast-path timed loop, the passive-slot combat-start seed, and the reactive
 * resolver); this one has exactly ONE caller — `footprintFilteredRecipients` in triggers.ts, the
 * REACTIVE path. Both corpus clauses that carry the field (Chimei's R2) are reactive, so nothing
 * is dropped today, and `recipientFilterIsReactiveOnly.test.ts` is the standing guard that keeps
 * it that way. An ability that reached a cast-path seam carrying this field would be silently
 * UN-narrowed — it would over-reach, not vanish, which is the less-bad of the two directions but
 * still wrong. Widen the wiring, don't widen the parser, if a cast clause ever needs it.
 */
export function narrowByRecipientFilter(
    ids: string[],
    filter: RecipientFilter | undefined,
    readers: {
        /** Live per-recipient check for `hasStatus`. Absent → the axis matches nobody. */
        holdsStatus?: (id: string, buffName: string) => boolean;
        /** Live per-recipient role for `notRole`. Absent (or `undefined` for an id) → excluded. */
        roleOf?: (id: string) => ShipTypeName | undefined;
        /** Live per-recipient HP fraction (0..1) for `hpBelowPct`. Absent → the axis matches
         *  nobody; an unreadable id (dead / unknown) is likewise excluded. */
        hpFractionOf?: (id: string) => number | undefined;
    }
): string[] {
    if (filter === undefined) return ids;
    const { hasStatus, notRole, hpBelowPct } = filter;
    // A filter object carrying no axis narrows nothing — same normalization as an empty
    // factionFilter array, so a stale/authored `{}` cannot silently mute a grant.
    if (hasStatus === undefined && notRole === undefined && hpBelowPct === undefined) return ids;
    return ids.filter((id) => {
        if (hasStatus !== undefined && !(readers.holdsStatus?.(id, hasStatus) ?? false)) {
            return false;
        }
        if (notRole !== undefined && notRole.length > 0) {
            const role = readers.roleOf?.(id);
            // Unknown role → excluded (see RecipientFilter.notRole). `matchesRoleCategory` is
            // already false for undefined, so a bare `!matches` would ADMIT an unknown role —
            // the opposite of the documented rule. Hence the explicit undefined arm.
            if (role === undefined) return false;
            if (notRole.some((cat) => matchesRoleCategory(role, [cat]))) return false;
        }
        if (hpBelowPct !== undefined) {
            const frac = readers.hpFractionOf?.(id);
            if (frac === undefined) return false;
            if (frac * 100 >= hpBelowPct) return false;
        }
        return true;
    });
}

/**
 * Resolve the `'lowest-hp-ally'` selector — the living same-side ally with the lowest
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
 * Shared buff-aware live-HP-fraction reader for `lowestHpAllyRecipients.hpFractionOf`, so every
 * caller reads maxHp through the same accessor rather than each hand-rolling its own (the
 * divergence risk: a hand-rolled reader silently falling back to raw `stats.hp` and missing
 * buff-aware max HP).
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
