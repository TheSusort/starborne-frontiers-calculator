import type { Ship } from '../../../types/ship';
import type { DuelOutcome } from '../../../utils/arcade/types';
import type { BattlePlacement, BattleResult } from '../../../utils/calculators/battleSimulator';
import type { CombatStatsDeps } from '../../../utils/ship/combatStats';
import { buildTeam } from '../../../utils/simulator/buildTeam';
import { runSeededBattle } from '../../../utils/simulator/seededRuns';
import { buildDuelBeats, type DuelBeat } from './duelPlayback';
import { teamCells, type TeamTrio } from './teamCells';

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

interface Sides {
    playerTeam: BattlePlacement[];
    enemyTeam: BattlePlacement[];
}

/** Runs a capped fight between two sides; any error → skipped. The first player placement is
 *  the engine's focus, and the result's roster (so every beat's ships) keeps each side's
 *  placement order. */
function runFight(teams: () => Sides, deps: CombatStatsDeps, seed: number): DuelResult {
    try {
        const input = { ...teams(), rounds: CHALLENGE_ROUNDS };
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
    const teams = () => ({
        playerTeam: buildTeam({ M2: { ship: player } }, deps),
        enemyTeam: buildTeam({ M2: { ship: opponent } }, deps),
    });
    return runFight(teams, deps, seed);
}

/** One side's placements in the order of `ships`, ship `i` on `cells[i]`. */
const placeInOrder = (ships: readonly Ship[], cells: TeamTrio, deps: CombatStatsDeps) =>
    ships.flatMap((ship, i) => buildTeam({ [cells[i]]: { ship } }, deps));

/** A 3v3's two sides on the cells `teamCells(seed)` draws. Each side keeps the order given here,
 *  whatever cells its ships stand on: the flown ship first, so it is the engine's focus and ship
 *  0 of every beat's `player`. */
export function teamPlacements(
    player: Ship,
    allies: readonly [Ship, Ship],
    opponents: readonly [Ship, Ship, Ship],
    deps: CombatStatsDeps,
    seed: number
): Sides {
    const cells = teamCells(seed);
    return {
        playerTeam: placeInOrder([player, ...allies], cells.player, deps),
        enemyTeam: placeInOrder(opponents, cells.enemy, deps),
    };
}

/** A 3v3 laid out by `teamPlacements`, capped at CHALLENGE_ROUNDS; each beat's `position` says
 *  where every ship stands. Won as `duelOutcome` decides, on summed HP%. Any error → skipped. */
export function runTeamDuel(
    player: Ship,
    allies: readonly [Ship, Ship],
    opponents: readonly [Ship, Ship, Ship],
    deps: CombatStatsDeps,
    seed: number
): DuelResult {
    return runFight(() => teamPlacements(player, allies, opponents, deps, seed), deps, seed);
}
