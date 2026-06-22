import { describe, it, expect } from 'vitest';
import { dotResistLabel, isBlockDebuff } from '../debuffImmunity';
import { runCombat, CombatEngineInput } from '../engine';
import { ShipSkills, Ability } from '../../../types/abilities';

describe('debuffImmunity helpers', () => {
    describe('isBlockDebuff', () => {
        it('returns true for "Block Debuff"', () => {
            expect(isBlockDebuff('Block Debuff')).toBe(true);
        });

        it('returns false for unrelated buff names', () => {
            expect(isBlockDebuff('Attack Up I')).toBe(false);
        });
    });

    describe('dotResistLabel', () => {
        it('formats inferno with roman numeral tier', () => {
            expect(dotResistLabel('inferno', 3)).toBe('Inferno III');
        });

        it('formats corrosion with roman numeral tier', () => {
            expect(dotResistLabel('corrosion', 2)).toBe('Corrosion II');
        });

        it('formats bomb with no tier suffix', () => {
            expect(dotResistLabel('bomb', 0)).toBe('Bomb');
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 4: Block Debuff — cast-side timed + persistent landing fold.
//
// A target carrying `Block Debuff` auto-resists EVERY incoming timed and
// persistent-stacking debuff. We drive the engine via `runCombat` with an enemy
// attacker (the opposing caster) inflicting a TIMED debuff (`Attack Down II`) and a
// PERSISTENT-STACKING debuff (`Defense Shred`) at the heal target. The heal target —
// the focus actor `attacker` — carries `Block Debuff` (a recurring self-buff), so
// when the enemy casts, the turn target is immune. The fold returns `false` from the
// landing decision → the existing resist plumbing records the resist: the debuff
// surfaces in that enemy's `resistedDebuffs` (display) and NOT in `debuffs`.
// ─────────────────────────────────────────────────────────────────────────────

let idCounter = 0;

const blockDebuffEngineBase = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    enemyDefense: 0,
    enemyHp: 10_000_000,
    numRounds: 1,
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
    healTargetId: 'attacker',
    ...overrides,
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const enemyAb = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `bdka${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

/**
 * An enemy attacker (speed 10 — acts AFTER the speed-100 focus actor each round, so the
 * focus actor's Block Debuff self-buff is already active when this enemy casts) whose kit
 * inflicts a basic attack + ONE timed/persistent debuff at the heal target. `hacking`
 * omitted → defaults to 200 → 100% landing (so the ONLY thing that can resist is the
 * Block Debuff immunity fold).
 */
const debuffEnemy = (debuff: Ability): EnemyAttacker =>
    ({
        id: 'e1',
        stats: { attack: 1000, crit: 0, critDamage: 0, speed: 10 },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        enemyAb({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                        debuff,
                    ],
                },
            ],
        } as ShipSkills,
    }) as EnemyAttacker;

/** Focus actor (heal target) shipSkills granting a recurring `Block Debuff` self-buff. */
const blockDebuffSelfSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'passive',
            abilities: [
                {
                    id: 'block-debuff-self',
                    type: 'buff',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'buff',
                        buffName: 'Block Debuff',
                        stacks: 1,
                        isStackable: false,
                        duration: 'recurring',
                        parsedEffects: {},
                    },
                },
            ],
        },
    ],
});

const runWith = (debuff: Ability, focusSkills: ShipSkills) =>
    runCombat(
        blockDebuffEngineBase({
            enemyAttackers: [debuffEnemy(debuff)],
            shipSkills: focusSkills,
        })
    );

const e1Effects = (result: ReturnType<typeof runCombat>) =>
    result.healing?.rounds?.[0]?.enemyEffects.find((e) => e.enemyId === 'e1');

const timedAttackDown: Ability = {
    id: 'ad2',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Attack Down II',
        parsedEffects: { attack: -50 },
        stacks: 1,
        isStackable: false,
        application: 'inflict',
        duration: 3,
    },
};

const persistentDefenseShred: Ability = {
    id: 'dshred',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Defense Shred',
        parsedEffects: { defense: -2 },
        stacks: 1,
        isStackable: true,
        application: 'inflict',
        duration: 3,
    },
};

describe('Block Debuff — cast-side timed/persistent landing fold (engine)', () => {
    it('immune target auto-resists a TIMED debuff: it is in resistedDebuffs, NOT debuffs', () => {
        const entry = e1Effects(runWith(timedAttackDown, blockDebuffSelfSkills()));
        expect(entry).toBeDefined();
        expect(entry!.resistedDebuffs.map((d) => d.buffName)).toContain('Attack Down II');
        expect(entry!.debuffs.map((d) => d.buffName)).not.toContain('Attack Down II');
    });

    it('control: WITHOUT Block Debuff the same TIMED debuff lands (non-vacuity)', () => {
        const entry = e1Effects(runWith(timedAttackDown, { slots: [] }));
        expect(entry).toBeDefined();
        expect(entry!.debuffs.map((d) => d.buffName)).toContain('Attack Down II');
        expect(entry!.resistedDebuffs).toHaveLength(0);
    });

    it('immune target auto-resists a PERSISTENT-STACKING debuff: resisted, no stack added', () => {
        const entry = e1Effects(runWith(persistentDefenseShred, blockDebuffSelfSkills()));
        expect(entry).toBeDefined();
        expect(entry!.resistedDebuffs.map((d) => d.buffName)).toContain('Defense Shred');
        expect(entry!.debuffs.map((d) => d.buffName)).not.toContain('Defense Shred');
    });

    it('control: WITHOUT Block Debuff the same PERSISTENT-STACKING debuff lands (non-vacuity)', () => {
        const entry = e1Effects(runWith(persistentDefenseShred, { slots: [] }));
        expect(entry).toBeDefined();
        expect(entry!.debuffs.map((d) => d.buffName)).toContain('Defense Shred');
        expect(entry!.resistedDebuffs).toHaveLength(0);
    });
});
