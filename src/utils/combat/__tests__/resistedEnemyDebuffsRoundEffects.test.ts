import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { ShipSkills, Ability } from '../../../types/abilities';

// ─────────────────────────────────────────────────────────────────────────────
// Task R1: capture resisted enemy→tank TIMED debuffs into EnemyRoundEffects.
//
// PR 5 item 12 routes an enemy attacker's TIMED debuff infliction through a
// hacking-vs-security landing roll (per-enemy `debuffLandingChance`). When the
// roll fails the debuff is RESISTED — it must surface on that enemy's
// EnemyRoundEffects entry as `resistedDebuffs` (NAMES ONLY, display-only) and
// must NOT appear in `debuffs`. When it lands it appears in `debuffs` and
// `resistedDebuffs` is empty.
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

// An enemy attacker whose kit carries a basic attack + a TIMED 'Defense Down'
// debuff infliction (application: 'inflict' → drawn against debuffLandingChance).
const debuffEnemy = (debuffLandingChance?: number): EnemyAttacker =>
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
                            type: 'debuff',
                            config: {
                                type: 'debuff',
                                buffName: 'Defense Down',
                                parsedEffects: { defense: -50 },
                                stacks: 1,
                                isStackable: false,
                                application: 'inflict',
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
            enemyAttackers: [debuffEnemy(debuffLandingChance)],
            shipSkills: { slots: [] },
        })
    );

const e1Effects = (result: ReturnType<typeof runCombat>) =>
    result.healing?.rounds?.[0]?.enemyEffects.find((e) => e.enemyId === 'e1');

describe('resisted enemy→tank TIMED debuffs in EnemyRoundEffects (Task R1)', () => {
    it('debuffLandingChance: 0 → debuff is in resistedDebuffs, NOT in debuffs', () => {
        const entry = e1Effects(runWithEnemy(0));
        expect(entry).toBeDefined();
        expect(entry!.resistedDebuffs.map((d) => d.buffName)).toContain('Defense Down');
        expect(entry!.debuffs.map((d) => d.buffName)).not.toContain('Defense Down');
    });

    it('debuffLandingChance: 1 → debuff is in debuffs, resistedDebuffs empty', () => {
        const entry = e1Effects(runWithEnemy(1));
        expect(entry).toBeDefined();
        expect(entry!.debuffs.map((d) => d.buffName)).toContain('Defense Down');
        expect(entry!.resistedDebuffs).toHaveLength(0);
    });
});
