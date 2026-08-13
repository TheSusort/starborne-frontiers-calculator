/**
 * The "bare roster" shape: no positions, no targeting, one real enemy — what 54 fixture files
 * pass to `runCombat` today. Shared by the boundary and dummy-reachability suites so the two
 * agree on exactly what an under-specified caller looks like.
 */
import type { CombatEngineInput } from '../engine';
import type { ShipSkills } from '../../../types/abilities';

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

/** No position, no target, no pattern. */
export const bareEnemy = () => [
    {
        id: 'e1',
        stats: { attack: 0, crit: 0, critDamage: 0, speed: 10, defence: 0, hp: 500_000 },
        chargeCount: 0,
        startCharged: false,
    },
];

export const bareInput = (): CombatEngineInput =>
    ({
        attack: 10_000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: damageKit(),
        numRounds: 2,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: 1_000_000,
        enemyAttackers: bareEnemy(),
    }) as CombatEngineInput;
