import type { BattleResult } from '../../calculators/battleSimulator';
import type { ObjectiveMetric } from './roleObjectives';

/** True for every actor on the player side, including the reserved bare id `'attacker'` that
 *  player index 0 fights under. Only enemy actors carry the `e:` prefix, so this reads as "not an
 *  enemy" rather than "starts with `p:`" — the latter silently drops index 0. */
const isPlayerActor = (actorId: string): boolean => !actorId.startsWith('e:');

/** `ShipRoundState.damageDealt` / `damageTaken` / `healingDone` / `shieldGranted` are PER-ROUND
 *  rates, not running cumulatives, so a fight total is a sum across rounds
 *  (`seededRuns.ts` documents the same rule for its own aggregation). */
const sumFocus = (
    result: BattleResult,
    focusActorId: string,
    field: 'damageDealt' | 'damageTaken' | 'healingDone' | 'shieldGranted'
): number => {
    let total = 0;
    for (const round of result.rounds) {
        for (const ship of round.ships) {
            if (ship.actorId === focusActorId) {
                total += ship[field];
            }
        }
    }
    return total;
};

/** The focus actor's status in the last round the fight recorded — the only round whose
 *  `alive` flag reflects how the fight ended. */
export function survived(result: BattleResult, focusActorId: string): boolean {
    const finalRound = result.rounds[result.rounds.length - 1];
    if (!finalRound) return false;
    return finalRound.ships.find((s) => s.actorId === focusActorId)?.alive ?? false;
}

export function objectiveSeries(
    result: BattleResult,
    focusActorId: string,
    metric: ObjectiveMetric
): number {
    switch (metric) {
        case 'focusDamageDealt':
            return sumFocus(result, focusActorId, 'damageDealt');

        case 'focusSupportOutput':
            return (
                sumFocus(result, focusActorId, 'healingDone') +
                sumFocus(result, focusActorId, 'shieldGranted')
            );

        case 'focusDamageTakenShare': {
            let playerTotal = 0;
            for (const round of result.rounds) {
                for (const ship of round.ships) {
                    if (isPlayerActor(ship.actorId)) playerTotal += ship.damageTaken;
                }
            }
            // A player side that never takes damage has no share to report, and 0/0 must not
            // surface as NaN — a NaN silently poisons every comparison downstream.
            if (playerTotal === 0) return 0;
            return sumFocus(result, focusActorId, 'damageTaken') / playerTotal;
        }

        case 'enemyDebuffUptime': {
            let debuffedEnemyRounds = 0;
            let enemyRounds = 0;
            for (const round of result.rounds) {
                for (const ship of round.ships) {
                    if (isPlayerActor(ship.actorId)) continue;
                    enemyRounds++;
                    if (ship.activeDebuffs.length > 0) debuffedEnemyRounds++;
                }
            }
            // No enemy-rounds to sample (e.g. a fight with no rounds recorded) reports no
            // uptime rather than NaN.
            if (enemyRounds === 0) return 0;
            return debuffedEnemyRounds / enemyRounds;
        }
    }
}
