import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { ShipSkills, Ability } from '../../../types/abilities';
import { createEventBus, CombatEvent } from '../events';

// ─────────────────────────────────────────────────────────────────────────────
// PR 5 item 12: per-enemy `debuffLandingChance` input on EnemyActorInput.
//
// An enemy attacker that inflicts a DoT lands it each round through the per-turn
// landing roll: dotsLanded = roundDebuffLanded() → debuffLandingGate(debuffLandingChance)
// (playerTurn.ts). The per-enemy field feeds that gate:
//   - omitted / 1  → 100% landing (byte-identical to today) → DoT lands every round
//   - 0            → never lands → no `dot-applied` ever emitted
//
// The field is observed via the `dot-applied` event (sourceId = the enemy attacker).
// The hard-coded `debuffLandingChance: 1` runtime field made the `0` case impossible
// before this change — proving the input now reaches the gate.
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
// `debuffLandingChance` is optional — omitted → 100% landing (backward-compatible default).
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
                                tier: 5,
                                stacks: 1,
                                duration: 3,
                            },
                        }),
                    ],
                },
            ],
        } as ShipSkills,
    }) as EnemyAttacker;

// Count `dot-applied` events the enemy attacker ('e1') emitted over `numRounds`.
const countDotApplied = (debuffLandingChance: number | undefined, numRounds: number): number => {
    idCounter = 0;
    const events: CombatEvent[] = [];
    const bus = createEventBus();
    bus.on('dot-applied', (e) => events.push(e));
    runCombat(
        BASE({
            numRounds,
            hp: 1_000_000,
            defence: 0,
            healTargetId: 'attacker',
            bus,
            enemyAttackers: [dotEnemy(debuffLandingChance)],
            shipSkills: { slots: [] },
        })
    );
    return events.filter((e) => e.type === 'dot-applied' && e.sourceId === 'e1').length;
};

describe('per-enemy debuffLandingChance (PR 5 item 12)', () => {
    const N = 6;

    it('debuffLandingChance: 0 → the enemy attacker NEVER lands its DoT', () => {
        expect(countDotApplied(0, N)).toBe(0);
    });

    it('debuffLandingChance: 1 → the enemy attacker lands its DoT every round', () => {
        expect(countDotApplied(1, N)).toBe(N);
    });

    it('omitted debuffLandingChance → 100% landing (backward-compatible)', () => {
        expect(countDotApplied(undefined, N)).toBe(N);
    });

    it('omitted is byte-identical to explicit 1', () => {
        expect(countDotApplied(undefined, N)).toBe(countDotApplied(1, N));
    });
});
