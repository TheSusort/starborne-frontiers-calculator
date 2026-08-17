/**
 * The real-enemy (positional) DPS fixture shared by the calculator-level and component-level
 * suites that drive a REAL `simulateDPS` run — a hand-built `RoundData` literal stays green
 * through the whole "vanishing `> 0`-guarded row" defect class (#324), so both layers must
 * exercise the same simulator input. Extracted from `dpsPositionalRoundFields.test.ts` for the
 * same reason `__testutils__/bareRosterFixture.ts` exists: importing a `.test.ts` module runs its
 * `describe` blocks as an import side effect, under a second file and a second seed.
 */
import type { DPSSimulationInput } from '../dpsSimulator';
import type { ShipSkills } from '../../../types/abilities';

export const REAL_ENEMY_ID = 'enemy-1';

export const damageKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'a1',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100 },
                },
            ],
        },
    ],
});

/** A focus that also applies corrosion, so the Direct-by-subtraction path is not vacuous. */
export const dotKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ...damageKit().slots[0].abilities,
                {
                    id: 'a2',
                    type: 'dot',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'dot', dotType: 'corrosion', tier: 5, stacks: 1, duration: 3 },
                },
            ],
        },
    ],
});

export const baseInput = (over: Partial<DPSSimulationInput> = {}): DPSSimulationInput => ({
    attack: 10_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: damageKit(),
    enemyDefense: 1000,
    enemyHp: 5_000_000,
    rounds: 3,
    selfBuffs: [],
    enemyDebuffs: [],
    defence: 0,
    hp: 1_000_000,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    hacking: 500,
    enemySecurity: 0,
    ...over,
});

/** The page's shape: an explicitly-supplied real, positioned enemy. */
export const realEnemyInput = (over: Partial<DPSSimulationInput> = {}): DPSSimulationInput => ({
    ...baseInput(over),
    enemyAttackers: [
        {
            id: REAL_ENEMY_ID,
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                speed: 50,
                defence: 1000,
                hp: 5_000_000,
                security: 100,
            },
            chargeCount: 0,
            startCharged: false,
        },
    ],
});
