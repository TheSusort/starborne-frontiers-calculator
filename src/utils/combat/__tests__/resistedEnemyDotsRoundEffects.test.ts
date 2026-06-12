import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { ShipSkills, Ability } from '../../../types/abilities';

// ─────────────────────────────────────────────────────────────────────────────
// Task R3: capture resisted enemy→tank DoTs into EnemyRoundEffects.
//
// PR 5 item 12 routes an enemy attacker's DoT infliction through the same
// hacking-vs-security landing roll (per-enemy `debuffLandingChance`). When the
// roll fails the DoT is RESISTED — it must surface on that enemy's
// EnemyRoundEffects entry as `resistedDots` (NAMES/COUNTS ONLY, display-only)
// and must NOT appear in `dots`. When it lands it appears in `dots` and
// `resistedDots` is empty.
// ─────────────────────────────────────────────────────────────────────────────

let idCounter = 0;

const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
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
    debuffLandingChance: 1,
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 2000,
    hp: 10000,
    ...overrides,
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const enemyAb = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `eka${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

// An enemy attacker whose kit carries a basic attack + a Corrosion DoT infliction.
// The DoT lands/misses on the per-enemy debuffLandingChance roll (shared dotsLanded draw).
const dotEnemy = (debuffLandingChance?: number): EnemyAttacker =>
    ({
        id: 'e1',
        stats: { attack: 1000, crit: 0, critDamage: 0, speed: 10 },
        chargeCount: 0,
        startCharged: false,
        ...(debuffLandingChance === undefined ? {} : { debuffLandingChance }),
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        enemyAb({
                            type: 'damage',
                            config: { type: 'damage', multiplier: 100 },
                        }),
                        enemyAb({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'corrosion',
                                tier: 6,
                                stacks: 3,
                                duration: 3,
                            },
                        }),
                    ],
                },
            ],
        } as ShipSkills,
    }) as EnemyAttacker;

const runWithEnemy = (debuffLandingChance: number) =>
    runCombat(
        BASE({
            numRounds: 1,
            hp: 1_000_000,
            defence: 0,
            healTargetId: 'attacker',
            enemyAttackers: [dotEnemy(debuffLandingChance)],
            shipSkills: { slots: [] },
        })
    );

const e1Effects = (result: ReturnType<typeof runCombat>) =>
    result.healing?.rounds?.[0]?.enemyEffects.find((e) => e.enemyId === 'e1');

describe('resisted enemy→tank DoTs in EnemyRoundEffects (Task R3)', () => {
    it('debuffLandingChance: 0 → DoT is in resistedDots, NOT in dots', () => {
        const entry = e1Effects(runWithEnemy(0));
        expect(entry).toBeDefined();
        expect(entry!.resistedDots).toEqual([{ type: 'corrosion', tier: 6, stacks: 3 }]);
        expect(entry!.dots).toHaveLength(0);
    });

    it('debuffLandingChance: 1 → DoT is in dots, resistedDots empty', () => {
        const entry = e1Effects(runWithEnemy(1));
        expect(entry).toBeDefined();
        expect(entry!.dots.map((d) => d.type)).toContain('corrosion');
        expect(entry!.resistedDots).toHaveLength(0);
    });
});
