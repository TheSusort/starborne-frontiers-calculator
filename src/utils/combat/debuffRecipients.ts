import type { Ability } from '../../types/abilities';
import { enemySelectorKind, type EnemySelectorKind } from '../abilities/abilityTargetSide';

/**
 * Which actors a direct enemy-debuff clause lands on, given the ability's `target` and a RESOLVED
 * anchor. Extracted verbatim from playerTurn.ts's cast-time ternary (multi-hit full-walk epic,
 * PR8 Task 1) so the cast-time path and the per-sub-attack path cannot drift — PR8 calls this
 * once per cast for sub-attack 0 and again per later sub-attack, with THAT sub-attack's live
 * anchor and footprint.
 *
 * `undefined` in the result means "resolve to the turn's own bound victim" — the non-positional
 * single-target answer, where the clause carries no victim id of its own and the caller lands it on
 * whatever `enemy` the turn is bound to. That is why the array is `(string | undefined)[]`. A
 * positional caller never receives it: with no anchor there is genuinely nobody to inflict, and
 * inventing a stand-in there would record a debuff on a target that does not exist.
 *
 * #343: this used to be called "the dummy sink", after the immortal placeholder enemy actor that
 * `undefined` resolved to before SP-4c-2d (#339) deleted it. The MECHANISM is unchanged and still
 * live — a non-positional single-target clause still routes through `undefined` — but the actor it
 * was named for is gone, so the name misled about what the thing IS while the behaviour it
 * described stayed correct. Nothing here changes; only the vocabulary. Keeping past-tense
 * references to the deleted actor searchable is deliberate (owner ruling); what had to go is the
 * PRESENT-tense use of a dead name for a live mechanism.
 *
 * @param abTarget          the matching debuff ability's `target`; `undefined` when no ability
 *                          matched the status, which behaves as single-target (the ternary's tail).
 * @param anchorId          the resolved victim id this clause hangs off — the cast's `targetId` at
 *                          cast time, or the sub-attack's own re-resolved anchor.
 * @param aoeVictimIds      the footprint to fan `all-enemies` over. Cast time passes the cast's
 *                          splash footprint; PR8's per-sub-attack path passes the victims THAT
 *                          sub-attack actually struck, which is what makes overkill retargeting
 *                          correct for free.
 * @param positionalLanding `deferAbilityPerformedToEngine` — true when the engine resolves this
 *                          cast against a real positioned roster.
 * @param selectorEnemyIdFor #403: resolves one of the three enemy SELECTOR kinds
 *                          ('most-buffs' / 'highest-attack' / 'highest-speed') to a live opposing
 *                          actor id. Supplied by engine.ts's `buildTurnArgs`; absent for every
 *                          non-positional/DPS caller, which is why an unresolved selector degrades
 *                          exactly like the tail (positional → nobody, non-positional → the bound
 *                          victim). Called at CLAUSE time so a purge earlier in the same cast is
 *                          visible to it.
 */
export function resolveDebuffRecipientIds(args: {
    abTarget: Ability['target'] | undefined;
    anchorId: string | undefined;
    aoeVictimIds: string[] | undefined;
    adjacentEnemyIdsFor: ((anchorId: string) => string[]) | undefined;
    positionalLanding: boolean;
    selectorEnemyIdFor?: (kind: EnemySelectorKind) => string | undefined;
}): (string | undefined)[] {
    const {
        abTarget,
        anchorId,
        aoeVictimIds,
        adjacentEnemyIdsFor,
        positionalLanding,
        selectorEnemyIdFor,
    } = args;
    // #403: the three enemy SELECTOR targets ('enemy-most-buffs', 'enemy-highest-attack',
    // 'enemy-highest-speed') name ONE opposing actor chosen by a global rule, not the cast's
    // anchor and not a positional footprint. They are resolved FIRST and returned directly: a
    // selector is single-victim, so it must never fall into the `all-enemies` / adjacency arms
    // below, and before #403 it fell all the way past them to the tail `[anchorId]` — the cast's
    // normal target. In-fight that meant a clause reading "applies Stasis to the highest attack
    // enemy" landed on the front-most enemy the pattern anchored on, leaving the 9,000-attack
    // ship behind it untouched.
    //
    // Resolution is the CALLER's (engine.ts `buildTurnArgs` builds the delegate over the live
    // opposing roster), and it is LIVE at clause time, not a turn-start snapshot: by the locked
    // intra-cast clause-order rule a purge clause written earlier in the SAME cast changes who
    // carries the most buffs, and the later debuff clause must see the post-purge board.
    //
    // UNRESOLVED (ruling R1): a positional caller inflicts NOTHING — 'most buffs' with no buff
    // anywhere on the opposing side has no victim, so nothing is inflicted, nothing is resisted,
    // and no landing draw is taken. A non-positional/DPS caller never supplies the delegate at
    // all (it has no roster to resolve against), so it keeps the turn's own bound victim via the
    // `undefined` sink — byte-identical DPS output for every kit. Same fork, same reason, as the
    // tail below.
    //
    // NOTE, deliberate divergence: the sibling on-cast PURGE loop (playerTurn.ts, the
    // `enemy-most-buffs` arm) falls back to the anchor when its selector does not resolve. Purge
    // is a different clause type and re-ruling it was outside #403 (spec ruling R4). If you are
    // making the two agree, change it there and say so, do not quietly align this one.
    const selectorKind = abTarget !== undefined ? enemySelectorKind(abTarget) : null;
    if (selectorKind !== null) {
        const selected = selectorEnemyIdFor?.(selectorKind);
        if (selected !== undefined) return [selected];
        return positionalLanding ? [] : [undefined];
    }
    const isAllEnemies = abTarget === 'all-enemies';
    const adjacentEnemyRecipients: string[] =
        anchorId !== undefined && adjacentEnemyIdsFor ? adjacentEnemyIdsFor(anchorId) : [];
    return abTarget === 'adjacent-enemies'
        ? adjacentEnemyRecipients
        : abTarget === 'target-and-adjacent-enemies'
          ? anchorId !== undefined
              ? [anchorId, ...adjacentEnemyRecipients]
              : positionalLanding
                ? []
                : [undefined]
          : positionalLanding && isAllEnemies
            ? (aoeVictimIds ?? [])
            : isAllEnemies && aoeVictimIds && aoeVictimIds.length > 0
              ? aoeVictimIds
              : anchorId !== undefined
                ? [anchorId]
                : positionalLanding
                  ? []
                  : [undefined];
}
