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

type EnemyAttackerInput = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/**
 * The id `bareEnemy()` carries. Fixtures that assert an actor identity read this instead of
 * hardcoding the string: on a positional run the vestigial dummy `enemy` is dropped from the turn
 * order, so the actor that takes the opposing turn — and that debuffs/DoTs report as their target —
 * is THIS id, not `'enemy'`.
 */
export const BARE_ENEMY_ID = 'e1';

/**
 * No position, no target, no pattern.
 *
 * `overrides` exists for one reason, learned repairing the SP-4b-2b fixture waves: the default
 * 500,000 HP is NOT a survival guarantee. A fixture whose focus actually deals damage for several
 * rounds will DESTROY this enemy mid-sim, and once the opposing roster is wiped the run changes
 * shape — the enemy stops taking turns, the cast falls back onto the legacy dummy victim (with the
 * dummy's `enemyDefense`, so damage magnitudes change too), and any assertion that assumed "one
 * enemy turn per round" silently reads a shorter fight. Fixtures that need a punching bag for the
 * whole sim pass `bareEnemy({ stats: { hp: 10_000_000 } })`; `stats` is merged field-by-field over
 * the inert defaults, so raising HP does not accidentally give the enemy an attack.
 */
export const bareEnemy = (
    overrides: Omit<Partial<EnemyAttackerInput>, 'stats'> & {
        stats?: Partial<EnemyAttackerInput['stats']>;
    } = {}
): EnemyAttackerInput[] => [
    {
        id: BARE_ENEMY_ID,
        chargeCount: 0,
        startCharged: false,
        ...overrides,
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            speed: 10,
            defence: 0,
            hp: 500_000,
            ...overrides.stats,
        },
    },
];

export const bareInput = (): CombatEngineInput => ({
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
});
