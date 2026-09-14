import type { BattlePlacement, BattleSimulationInput } from '../../calculators/battleSimulator';
import type { Position } from '../../../types/encounters';
import type { Ship } from '../../../types/ship';

/** A placement the engine can actually fight with. A ship with no skill text resolves to zero
 *  abilities (`getShipSkillRows` filters empty-text rows), so its turn loop has nothing to cast
 *  and every fight is a 0-damage draw regardless of `statOverrides`. A plain single-target hit is
 *  the minimum kit that makes a stat sweep observable in combat. */
const combatant = (
    id: string,
    position: Position,
    stats: BattlePlacement['statOverrides']
): BattlePlacement => ({
    ship: {
        id,
        name: id,
        type: 'ATTACKER',
        baseStats: {},
        equipment: {},
        refits: [],
        activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    } as unknown as Ship,
    position,
    statOverrides: stats,
});

const combatStats = (attack: number, speed: number) => ({
    attack,
    crit: 50,
    critDamage: 150,
    hacking: 200,
    security: 100,
    defence: 500,
    hp: 20000,
    speed,
});

/**
 * Two player ships (T1, M2) against one enemy (T1), deliberately lopsided so outcomes are
 * non-degenerate — someone dies — while staying cheap enough for a multi-step sweep.
 *
 * `B4` is deliberately empty, so a test can name a position that holds no placement.
 */
export const sweepBoardInput = (): BattleSimulationInput => ({
    playerTeam: [
        combatant('striker', 'T1', combatStats(4000, 120)),
        combatant('wing', 'M2', combatStats(3000, 110)),
    ],
    enemyTeam: [combatant('dummy', 'T1', combatStats(800, 100))],
});
