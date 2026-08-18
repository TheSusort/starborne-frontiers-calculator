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

/** The id the second roster member carries in multi-enemy shapes (death retargeting). */
export const SECOND_BARE_ENEMY_ID = 'e2';

/**
 * A roster member that ACTS: the bare enemy plus a real attack and the same 100%-multiplier damage
 * kit the focus carries, so the enemy→player direction is genuinely exercised rather than being
 * turn-order filler. A 0-attack positioned enemy is RNG-stream-inert and books nothing, so it can
 * never evidence the "enemy turns" path (SP-1's lesson, narrowed by SP-4b-2a to enemies that ACT).
 */
export const attackingEnemy = (
    overrides: Omit<Partial<EnemyAttackerInput>, 'stats'> & {
        stats?: Partial<EnemyAttackerInput['stats']>;
    } = {}
): EnemyAttackerInput[] =>
    bareEnemy({
        shipSkills: damageKit(),
        ...overrides,
        stats: { attack: 10_000, ...overrides.stats },
    });

type TeamActorInput = NonNullable<CombatEngineInput['teamActors']>[number];

/** The id `bareAlly()` carries. */
export const BARE_ALLY_ID = 'ally';

/**
 * A WALKED team ally — a real speed-ordered player actor that runs the full `runPlayerTurn`
 * pipeline (the `walk` bundle is what makes it walked rather than a legacy scheduled-list source).
 *
 * `attack` is the whole knob, and the two settings cover two DIFFERENT engine paths:
 *  • `attack: 0` (default) → an empty kit. The actor still takes a real turn (`turn-started`), so
 *    this is the TEAM-ACTOR TURN path with no damage confound.
 *  • `attack > 0` → the shared damage kit, so its cast lands per-victim. That is the WALKED-TEAM
 *    DAMAGE path, which is a separate cast site in the engine from the focus's.
 * Speed 1 puts it LAST in the turn order, after the focus and the roster, so it never reorders the
 * turns the other cases observe.
 *
 * `attack` is the ONLY knob on purpose. Earlier drafts also exposed `hp` and `position`; no caller
 * ever passed either, and an unused knob on a shared fixture is a liability — it reads as "these
 * vary across cases" when they do not, and it invites a future caller to move the ally off M4
 * without noticing the speed-1 turn-order contract above. HP is fixed at 500,000 (survives any
 * corpus cast) and the position at 'M4' (the FRONT of the player board — column 4, not column 1).
 */
export const bareAlly = (overrides: { attack?: number } = {}): TeamActorInput => {
    const attack = overrides.attack ?? 0;
    return {
        id: BARE_ALLY_ID,
        speed: 1,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position: 'M4',
        walk: {
            shipSkills: attack > 0 ? damageKit() : { slots: [] },
            stats: {
                attack,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 500_000,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    };
};

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
