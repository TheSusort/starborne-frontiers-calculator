import type { Ship } from '../../../types/ship';
import type { DuelOutcome } from '../../../utils/arcade/types';
import type { BattleResult } from '../../../utils/calculators/battleSimulator';
import type { CombatStatsDeps } from '../../../utils/ship/combatStats';
import { buildTeam } from '../../../utils/simulator/buildTeam';
import { runSeededBattle } from '../../../utils/simulator/seededRuns';

export interface DuelTimelinePoint {
    round: number;
    playerHpPct: number;
    enemyHpPct: number;
}

export interface DuelResult {
    outcome: DuelOutcome;
    timeline: DuelTimelinePoint[];
}

/**
 * The simulator's winner, except when the fight reached the round cap with both ships alive (the
 * simulator calls that an enemy win): then the higher final HP% wins and the player wins ties.
 */
export function duelOutcome(result: BattleResult): DuelResult {
    const timeline: DuelTimelinePoint[] = [{ round: 0, playerHpPct: 100, enemyHpPct: 100 }];
    for (const round of result.rounds) {
        const player = round.ships.find((s) => s.side === 'player');
        const enemy = round.ships.find((s) => s.side === 'enemy');
        timeline.push({
            round: round.round,
            playerHpPct: player?.hpPct ?? 0,
            enemyHpPct: enemy?.hpPct ?? 0,
        });
    }
    const last = result.rounds.at(-1);
    const bothAlive =
        !!last &&
        last.ships.some((s) => s.side === 'player' && s.alive) &&
        last.ships.some((s) => s.side === 'enemy' && s.alive);
    const end = timeline[timeline.length - 1];
    const won = bothAlive ? end.playerHpPct >= end.enemyHpPct : result.outcome.winner === 'player';
    return { outcome: won ? 'win' : 'lose', timeline };
}

/** A 1v1 at M2 on both sides with each ship's full gear/engineering stats. Any error → skipped. */
export function runDuel(
    player: Ship,
    opponent: Ship,
    deps: CombatStatsDeps,
    seed: number
): DuelResult {
    try {
        const input = {
            playerTeam: buildTeam({ M2: { ship: player } }, deps),
            enemyTeam: buildTeam({ M2: { ship: opponent } }, deps),
        };
        return duelOutcome(runSeededBattle(input, seed, deps.getGearPiece));
    } catch (error) {
        if (import.meta.env.DEV) console.warn('arcade duel skipped: the simulation threw', error);
        return { outcome: 'skipped', timeline: [] };
    }
}
