import type { Ability } from '../../types/abilities';

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
 */
export function resolveDebuffRecipientIds(args: {
    abTarget: Ability['target'] | undefined;
    anchorId: string | undefined;
    aoeVictimIds: string[] | undefined;
    adjacentEnemyIdsFor: ((anchorId: string) => string[]) | undefined;
    positionalLanding: boolean;
}): (string | undefined)[] {
    const { abTarget, anchorId, aoeVictimIds, adjacentEnemyIdsFor, positionalLanding } = args;
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
