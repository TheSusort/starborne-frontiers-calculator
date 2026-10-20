import type { Ship } from '../../../types/ship';
import type { DuelOutcome } from '../../../utils/arcade/types';
import type { BattleResult } from '../../../utils/calculators/battleSimulator';
import type { CombatStatsDeps } from '../../../utils/ship/combatStats';
import { buildTeam } from '../../../utils/simulator/buildTeam';
import { runSeededBattle } from '../../../utils/simulator/seededRuns';
import { buildDuelBeats, type DuelBeat } from './duelPlayback';

export interface DuelResult {
    outcome: DuelOutcome;
    /** Empty for a skipped duel. See `buildDuelBeats`. */
    beats: DuelBeat[];
}

/**
 * The simulator's winner, except when the fight reached the round cap with both ships alive (the
 * simulator calls that an enemy win): then the higher final HP% wins and the player wins ties.
 */
export function duelOutcome(result: BattleResult): DuelResult {
    const last = result.rounds.at(-1);
    const hpOf = (side: 'player' | 'enemy') => last?.ships.find((s) => s.side === side)?.hpPct ?? 0;
    const bothAlive =
        !!last &&
        last.ships.some((s) => s.side === 'player' && s.alive) &&
        last.ships.some((s) => s.side === 'enemy' && s.alive);
    const won = bothAlive ? hpOf('player') >= hpOf('enemy') : result.outcome.winner === 'player';
    return { outcome: won ? 'win' : 'lose', beats: buildDuelBeats(result) };
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
        return { outcome: 'skipped', beats: [] };
    }
}
