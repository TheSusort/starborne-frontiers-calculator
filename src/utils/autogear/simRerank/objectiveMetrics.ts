import type { BattleResult } from '../../calculators/battleSimulator';
import type { ObjectiveMetric } from './roleObjectives';

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
                    if (ship.side !== 'enemy') playerTotal += ship.damageTaken;
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
                    if (ship.side !== 'enemy') continue;
                    // Nothing clears a dead actor's `activeDebuffs` — it freezes at whatever it
                    // held at death and decays on the normal schedule, so a corpse's rows carry
                    // no signal about the debuffer's performance and are excluded from both the
                    // numerator and the denominator.
                    if (!ship.alive) continue;
                    enemyRounds++;
                    if (ship.activeDebuffs.length > 0) debuffedEnemyRounds++;
                }
            }
            // No living enemy-rounds to sample reports no uptime rather than NaN. This also
            // catches a round-1 total wipe (every enemy dead in round 1, so zero living
            // enemy-rounds survive the gate above) — a known blind spot of the metric, not a bug.
            if (enemyRounds === 0) return 0;
            return debuffedEnemyRounds / enemyRounds;
        }
    }
}
