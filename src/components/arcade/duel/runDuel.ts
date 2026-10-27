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
 * The simulator's winner, except when the fight reached the round cap with both sides alive (the
 * simulator calls that an enemy win): then the side with the higher summed final HP% wins and the
 * player wins ties.
 */
export function duelOutcome(result: BattleResult): DuelResult {
    const last = result.rounds.at(-1);
    const ships = last?.ships ?? [];
    const hpOf = (side: 'player' | 'enemy') =>
        ships.filter((s) => s.side === side).reduce((sum, s) => sum + s.hpPct, 0);
    const aliveOn = (side: 'player' | 'enemy') => ships.some((s) => s.side === side && s.alive);
    const bothAlive = !!last && aliveOn('player') && aliveOn('enemy');
    const won = bothAlive ? hpOf('player') >= hpOf('enemy') : result.outcome.winner === 'player';
    return { outcome: won ? 'win' : 'lose', beats: buildDuelBeats(result) };
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
