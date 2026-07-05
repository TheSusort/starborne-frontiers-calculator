import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const debuffEnemy = (id: string, debuffs = 1): EnemyAttacker =>
    ({
        id,
        stats: {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 10,
            hacking: 0,
        },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: Array.from({ length: debuffs }, (_, i) => ({
                        id: `enemy-debuff-${i}`,
                        type: 'debuff' as const,
                        target: 'enemy' as const,
                        trigger: 'on-cast' as const,
                        conditions: [],
                        config: {
                            type: 'debuff' as const,
                            buffName: `Def Down ${i}`,
                            parsedEffects: {},
                            stacks: 1,
                            isStackable: false,
                            application: 'inflict' as const,
                            duration: 1,
                        },
                    })),
                },
            ],
        },
    }) as EnemyAttacker;

// Vindicator's on-resist HP proc, injected directly (the builder path is covered by Task 2).
const onResistPassive = (pct = 30): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        {
            id: 'vindi-onresist',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-debuff-resisted',
            conditions: [],
            config: { type: 'damage', multiplier: 0, hits: 1, hpBasisPct: pct },
        },
    ],
});

const noopActive: ShipSkills['slots'][number] = {
    slot: 'active',
    abilities: [
        {
            id: 'noop',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 0 },
        },
    ],
};

const CARRIER_HP = 1_000_000;
const BASE = (
    slots: ShipSkills['slots'],
    overrides: Partial<CombatEngineInput> = {}
): CombatEngineInput => ({
    attack: 1,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
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
    hp: CARRIER_HP,
    speed: 100,
    healTargetId: 'attacker',
    ...overrides,
});

// Sums direct-channel creditDamage attributed to `sourceId` across the run.
const creditedDirectFor = (sourceId: string, input: CombatEngineInput): number => {
    let total = 0;
    runCombat({
        ...input,
        __testTapCreditDamage: (id, channel, amount) => {
            if (id === sourceId && channel === 'direct') total += amount;
        },
    });
    return total;
};

describe('Vindicator on-resist HP damage — engine integration', () => {
    it('deals ~30% of the carrier max HP to the resisted enemy (defence-0, mitigation ~none)', () => {
        const credited = creditedDirectFor(
            'attacker',
            BASE([noopActive, onResistPassive(30)], {
                enemyAttackers: [debuffEnemy('enemy-deb', 1)],
            })
        );
        expect(credited).toBeCloseTo(CARRIER_HP * 0.3, 0);
    });

    it('is mitigated by the victim defence', () => {
        const lowDef = creditedDirectFor(
            'attacker',
            BASE([noopActive, onResistPassive(30)], {
                enemyAttackers: [debuffEnemy('enemy-deb', 1)],
            })
        );
        const highDefEnemy = debuffEnemy('enemy-deb', 1);
        (highDefEnemy.stats as { defence: number }).defence = 50_000;
        const highDef = creditedDirectFor(
            'attacker',
            BASE([noopActive, onResistPassive(30)], { enemyAttackers: [highDefEnemy] })
        );
        expect(highDef).toBeGreaterThan(0);
        expect(highDef).toBeLessThan(lowDef);
    });

    it('procs once when two debuffs from ONE cast are both resisted', () => {
        const credited = creditedDirectFor(
            'attacker',
            BASE([noopActive, onResistPassive(30)], {
                enemyAttackers: [debuffEnemy('enemy-deb', 2)],
            })
        );
        expect(credited).toBeCloseTo(CARRIER_HP * 0.3, 0); // one proc, not two
    });

    it('procs once per DISTINCT enemy resisting in the same round', () => {
        const credited = creditedDirectFor(
            'attacker',
            BASE([noopActive, onResistPassive(30)], {
                enemyAttackers: [debuffEnemy('enemy-a', 1), debuffEnemy('enemy-b', 1)],
            })
        );
        expect(credited).toBeCloseTo(CARRIER_HP * 0.6, 0); // two procs
    });

    it('control: no on-resist passive → no credit', () => {
        const credited = creditedDirectFor(
            'attacker',
            BASE([noopActive], { enemyAttackers: [debuffEnemy('enemy-deb', 1)] })
        );
        expect(credited).toBe(0);
    });
});

// Team symmetry: an ENEMY-owned Vindicator resisting a PLAYER debuff procs identically.
//
// NOTE on targeting: a NON-positional player cast always resolves against the fixed 'enemy'
// DPS dummy (engine.ts's `legacyVictim` for the player side), never against a specific
// `enemyAttackers[]` entry — so a plain `target: 'enemy'` debuff can never land ON the
// enemy-owned Vindicator. To route the player's debuff at the actual enemyAttacker, both the
// caster and the target enemy need a board `position` (the recipe `enemySideAttacked.integration
// .test.ts` uses for its positional two-team battle): `position`/`target`/`pattern` on the
// CombatEngineInput make the player's cast resolve via `resolvePositionalTarget` over
// `enemyAttackerActors`, landing on 'enemy-vindi' instead of the dummy.
const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

describe('Vindicator on-resist HP damage — team symmetry (enemy-owned)', () => {
    it('an enemy carrier deals ~30% of ITS max HP to the resisting player when it resists a player debuff', () => {
        const ENEMY_HP = 2_000_000;
        // Player casts a timed debuff at the (positionally-targeted) enemy carrier; the player's
        // hacking 0 vs the carrier's default security 100 → landing chance clamps to 0 → the
        // debuff is RESISTED every time (deterministic, no RNG pin needed).
        const input: CombatEngineInput = {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'player-debuff',
                                type: 'debuff',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: {
                                    type: 'debuff',
                                    buffName: 'Def Down',
                                    parsedEffects: {},
                                    stacks: 1,
                                    isStackable: false,
                                    application: 'inflict',
                                    duration: 1,
                                },
                            },
                        ],
                    },
                ],
            },
            enemyDefense: 0,
            enemyHp: ENEMY_HP,
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
            hp: 1_000_000_000,
            speed: 100,
            healTargetId: 'attacker',
            hacking: 0,
            position: 'M4' as Position,
            target: parsedTarget('front'),
            pattern: basePattern(),
            enemyAttackers: [
                {
                    id: 'enemy-vindi',
                    stats: {
                        attack: 1,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: ENEMY_HP,
                        speed: 10,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'M4' as Position,
                    shipSkills: { slots: [noopActive, onResistPassive(30)] },
                } as EnemyAttacker,
            ],
        };
        const credited = creditedDirectFor('enemy-vindi', input);
        expect(credited).toBeGreaterThan(0);
        expect(credited).toBeCloseTo(ENEMY_HP * 0.3, 0);
    });
});
