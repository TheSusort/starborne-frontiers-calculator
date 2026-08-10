import type { Ability } from '../../types/abilities';

/**
 * Which actors a direct enemy-debuff clause lands on, given the ability's `target` and a RESOLVED
 * anchor. Extracted verbatim from playerTurn.ts's cast-time ternary (multi-hit full-walk epic,
 * PR8 Task 1) so the cast-time path and the per-sub-attack path cannot drift — PR8 calls this
 * once per cast for sub-attack 0 and again per later sub-attack, with THAT sub-attack's live
 * anchor and footprint.
 *
 * `undefined` in the result is the non-positional dummy sink ("resolve to the turn's `enemy`"),
 * which is why the array is `(string | undefined)[]`. A positional caller never receives it: with
 * no anchor there is genuinely nobody to inflict, and inventing the sink there would record a
 * debuff on a target that does not exist.
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
