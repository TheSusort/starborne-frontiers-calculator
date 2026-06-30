/**
 * D-PR1: procChance gate — per-proc rate gate for equipment reactive procs.
 *
 * A passive on-crit reactive heal with procChance 0.5 over 10 rounds should fire exactly 5
 * times. The rate gate now draws from a random RNG (rng() < rate). To keep this test
 * deterministic and preserve its intent (5 of 10 fires), we force a scripted RNG sequence
 * that alternates fire/no-fire (0.1 < 0.5 fires; 0.9 >= 0.5 skips) → 5 fires of 10. A control
 * ability without procChance fires all 10 (gate bypassed).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import { setRateGateRng, resetRateGateRng } from '../../calculators/rateAccumulator';

let idCounter = 0;
const nextId = (): string => `proc-test-${++idCounter}`;

const makeHealAbility = (procChance?: number): Ability => ({
    id: nextId(),
    type: 'heal',
    target: 'self',
    trigger: 'on-crit',
    conditions: [],
    ...(procChance !== undefined ? { procChance } : {}),
    config: { type: 'heal', pct: 50, basis: 'hp', noCrit: true },
});

const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 5000,
    crit: 100, // every hit crits → on-crit fires once per round
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    enemyDefense: 0,
    enemyHp: 10_000_000, // enemy never dies
    numRounds: 10,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 2000,
    hp: 10000,
    healTargetId: 'attacker', // enable healing mode, self is target
    ...overrides,
});

/** Build a ShipSkills with a single-hit damage active (so on-crit fires once per round)
 *  and the given reactive heal abilities on the passive slot. */
const makeSkills = (abilities: Ability[]): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: nextId(),
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100, hits: 1 },
                },
            ],
        },
        {
            slot: 'passive',
            abilities,
        },
    ],
});

/** Sum a heal bucket over all rounds for the focus actor ('attacker'). */
const sumHeal = (
    result: ReturnType<typeof runCombat>,
    bucket: 'directHeal' | 'effectiveHeal' | 'overheal'
): number =>
    (result.healing?.rounds ?? []).reduce(
        (sum, rd) => sum + (rd.perActor.get('attacker')?.[bucket] ?? 0),
        0
    );

describe('D-PR1: procChance gate — per-proc rate gate for equipment reactive procs', () => {
    afterEach(() => resetRateGateRng());

    it('procChance 0.5 over 10 on-crit triggers fires the reactive heal exactly 5 times (scripted RNG)', () => {
        idCounter = 0;
        // ORDER-SENSITIVE: assumes the crit gate draws before the proc gate each round (crit
        // on even indices, proc on odd). If the engine's per-round gate draw order changes,
        // this sequence must be re-derived.
        // Each round draws twice: the crit gate (rate 1.0, fires on any draw < 1) then the
        // proc gate (rate 0.5). So proc draws land on odd indices. Force those to alternate
        // 0.1 (fires, < 0.5) / 0.9 (skips, >= 0.5) → 5 fires of 10. Crit-gate draws (even
        // indices) are 0.0 so they always fire (crit=100) without affecting proc parity.
        const seq = [
            0, 0.1, 0, 0.9, 0, 0.1, 0, 0.9, 0, 0.1, 0, 0.9, 0, 0.1, 0, 0.9, 0, 0.1, 0, 0.9,
        ];
        let drawIdx = 0;
        setRateGateRng(() => {
            if (drawIdx >= seq.length) {
                throw new Error('Unexpected extra rate-gate draw');
            }
            return seq[drawIdx++];
        });
        // Each fire credits directHeal = 10000 (hp) × 50% = 5000.
        // 5 fires → 25000 total; 10 fires (no gate) → 50000 total.
        const gatedAbility = makeHealAbility(0.5);
        const result = runCombat(
            BASE({
                shipSkills: makeSkills([gatedAbility]),
            })
        );

        expect(result.healing).toBeDefined();
        expect(result.healing!.rounds).toHaveLength(10);

        // 5 fires × 5000 = 25000
        expect(sumHeal(result, 'directHeal')).toBe(25000);
    });

    it('control: reactive heal without procChance fires on all 10 on-crit triggers (no gate)', () => {
        idCounter = 0;
        const controlAbility = makeHealAbility(/* no procChance */);
        const result = runCombat(
            BASE({
                shipSkills: makeSkills([controlAbility]),
            })
        );

        expect(result.healing).toBeDefined();
        expect(result.healing!.rounds).toHaveLength(10);

        // 10 fires × 5000 = 50000
        expect(sumHeal(result, 'directHeal')).toBe(50000);
    });

    it('procChance exactly 1: fires on every trigger (no skip)', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                shipSkills: makeSkills([makeHealAbility(1)]),
            })
        );
        // procChance=1 is outside (0,1) so the gate is bypassed → 10 fires × 5000 = 50000
        expect(sumHeal(result, 'directHeal')).toBe(50000);
    });

    it('procChance exactly 0: gate bypassed, fires on every trigger (treated as absent)', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                shipSkills: makeSkills([makeHealAbility(0)]),
            })
        );
        // procChance=0 is outside (0,1) so gate is bypassed → 10 fires × 5000 = 50000
        // (procChance=0 means always fire, same as absent — the guard is pc > 0 && pc < 1)
        expect(sumHeal(result, 'directHeal')).toBe(50000);
    });
});
