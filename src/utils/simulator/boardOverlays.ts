/**
 * PURE overlay derivation for the simulator battle-playback board.
 *
 * `overlaysForRound` maps a single `BattleRound`'s per-ship state onto board cells by
 * POSITION, keyed off the roster's `actorId`↔`position` mapping (NOT raw ship ids — the
 * roster actorIds are synthetic: `'attacker'`, `p:<shipId>:<idx>`, `e:<shipId>:<idx>`).
 *
 * No React, no side effects — this is the testable core. The `BattleBoard` component
 * renders whatever this returns.
 */
import type { Position } from '../../types/encounters';
import type { BattleRound, BattleResult } from '../calculators/battleSimulator';

export interface CellOverlay {
    actorId: string;
    name: string;
    hpPct: number;
    alive: boolean;
    buffs: string[];
    debuffs: string[];
    /** This-round visual cue: 'damage' if the ship took damage, else 'heal' if it was healed. */
    effect?: 'damage' | 'heal';
}

/**
 * For each roster entry on `side`, find its `ShipRoundState` in `round.ships` by `actorId`
 * and place a `CellOverlay` at `entry.position`. Skips any roster entry with no matching
 * ship state this round. `effect` prefers 'damage' over 'heal' when both occurred.
 */
export function overlaysForRound(
    round: BattleRound,
    side: 'player' | 'enemy',
    roster: BattleResult['roster']
): Partial<Record<Position, CellOverlay>> {
    const overlays: Partial<Record<Position, CellOverlay>> = {};

    for (const entry of roster) {
        if (entry.side !== side) continue;
        const state = round.ships.find((s) => s.actorId === entry.actorId);
        if (!state) continue;

        const effect: CellOverlay['effect'] =
            state.damageTaken > 0 ? 'damage' : state.healingReceived > 0 ? 'heal' : undefined;

        overlays[entry.position] = {
            actorId: entry.actorId,
            name: entry.name,
            hpPct: state.hpPct,
            alive: state.alive,
            buffs: state.activeBuffs,
            debuffs: state.activeDebuffs,
            effect,
        };
    }

    return overlays;
}
