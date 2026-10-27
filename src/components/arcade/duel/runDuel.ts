import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import type { DuelOutcome } from '../../../utils/arcade/types';
import type { BattleResult } from '../../../utils/calculators/battleSimulator';
import type { CombatStatsDeps } from '../../../utils/ship/combatStats';
import type { BoardState } from '../../simulator/PlacementBoard';
import { buildTeam } from '../../../utils/simulator/buildTeam';
import { runSeededBattle } from '../../../utils/simulator/seededRuns';
import { buildDuelBeats, type DuelBeat } from './duelPlayback';

/** Every arcade challenge, fight or race, lasts at most this many rounds. */
export const CHALLENGE_ROUNDS = 5;

export interface DuelResult {
    outcome: DuelOutcome;
    /** Empty for a skipped duel. See `buildDuelBeats`. */
    beats: DuelBeat[];
}

/**
 * The simulator's winner, except in two cases where the simulator forces a winner and the arcade
 * does not:
 * - Both sides wiped in the same round (the simulator picks by kill order): a draw.
 * - The round cap reached with both sides alive (the simulator calls that an enemy win): the side
 *   with the higher summed final HP% wins; equal HP% is a draw.
 */
export function duelOutcome(result: BattleResult): DuelResult {
    const beats = buildDuelBeats(result);
    const last = result.rounds.at(-1);
    if (!last) return { outcome: result.outcome.winner === 'player' ? 'win' : 'lose', beats };
    const hpOf = (side: 'player' | 'enemy') =>
        last.ships.filter((s) => s.side === side).reduce((sum, s) => sum + s.hpPct, 0);
    const aliveOn = (side: 'player' | 'enemy') =>
        last.ships.some((s) => s.side === side && s.alive);
    const player = aliveOn('player');
    const enemy = aliveOn('enemy');
    let outcome: DuelOutcome;
    if (!player && !enemy) outcome = 'draw';
    else if (player && enemy) {
        const diff = hpOf('player') - hpOf('enemy');
        outcome = diff > 0 ? 'win' : diff < 0 ? 'lose' : 'draw';
    } else outcome = player ? 'win' : 'lose';
    return { outcome, beats };
}

/** Runs a capped fight between two boards; any error → skipped. */
function runFight(
    player: BoardState,
    enemy: BoardState,
    deps: CombatStatsDeps,
    seed: number
): DuelResult {
    try {
        const input = {
            playerTeam: buildTeam(player, deps),
            enemyTeam: buildTeam(enemy, deps),
            rounds: CHALLENGE_ROUNDS,
        };
        return duelOutcome(runSeededBattle(input, seed, deps.getGearPiece));
    } catch (error) {
        if (import.meta.env.DEV) console.warn('arcade duel skipped: the simulation threw', error);
        return { outcome: 'skipped', beats: [] };
    }
}

/** A 1v1 at M2 on both sides with each ship's full gear/engineering stats, capped at
 *  CHALLENGE_ROUNDS. Any error → skipped. */
export function runDuel(
    player: Ship,
    opponent: Ship,
    deps: CombatStatsDeps,
    seed: number
): DuelResult {
    return runFight({ M2: { ship: player } }, { M2: { ship: opponent } }, deps, seed);
}

/** A side's three cells, in board order: the first is the engine's focus on the player side. */
const TEAM_CELLS: readonly [Position, Position, Position] = ['T2', 'M2', 'B2'];

const teamBoard = (ships: readonly [Ship, Ship, Ship]): BoardState =>
    Object.fromEntries(TEAM_CELLS.map((cell, i) => [cell, { ship: ships[i] }]));

/** A 3v3: the flown ship (first in board order) and its two allies against `opponents`, capped at
 *  CHALLENGE_ROUNDS. Won as `duelOutcome` decides, on summed HP%. Any error → skipped. */
export function runTeamDuel(
    player: Ship,
    allies: readonly [Ship, Ship],
    opponents: readonly [Ship, Ship, Ship],
    deps: CombatStatsDeps,
    seed: number
): DuelResult {
    return runFight(teamBoard([player, ...allies]), teamBoard(opponents), deps, seed);
}
