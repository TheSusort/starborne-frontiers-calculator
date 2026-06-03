import { describe, expect, it } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../../calculators/dpsSimulator';
import { Ability, ShipSkills } from '../../../types/abilities';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `dyn${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

const BASE: DPSSimulationInput = {
    attack: 15000,
    crit: 50,
    critDamage: 150,
    defensePenetration: 10,
    chargeCount: 0,
    enemyDefense: 8000,
    enemyHp: 400000,
    rounds: 12,
    selfBuffs: [],
    enemyDebuffs: [],
    hacking: 250,
    enemySecurity: 100,
    defence: 6000,
    hp: 30000,
};

const buffNamesByRound = (skills: ShipSkills, overrides: Partial<DPSSimulationInput> = {}) =>
    simulateDPS({ ...BASE, ...overrides, shipSkills: skills }).rounds.map((r) => ({
        round: r.round,
        names: r.activeSelfBuffs.map((b) => b.buffName),
        directDamage: r.directDamage,
    }));

describe('dynamic per-round condition gating', () => {
    it('1. ramping on: enemy-debuff threshold switches a buff on mid-fight', () => {
        idCounter = 0;
        // Corrosion (dur 3) applied each active round → pre-Step-3 entry count ramps
        // 0,1,2,2,… The buff is gated on enemy-debuff ≥ 2, so it flips on once the count
        // reaches 2 (round 3 onward) and stays on while the count holds.
        const gated: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                        ab({
                            type: 'buff',
                            target: 'self',
                            conditions: [
                                {
                                    subject: 'enemy-debuff',
                                    derivable: true,
                                    countComparator: 'gte',
                                    countThreshold: 2,
                                },
                            ],
                            config: {
                                type: 'buff',
                                buffName: 'Attack Up',
                                parsedEffects: { attack: 30 },
                                stacks: 1,
                                isStackable: false,
                                duration: 2,
                            },
                        }),
                        ab({
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
        };
        const rows = buffNamesByRound(gated);
        // Absent in early rounds (count < 2), present once count reaches 2.
        expect(rows[0].names).not.toContain('Attack Up'); // R1: count 0
        expect(rows[1].names).not.toContain('Attack Up'); // R2: count 1
        expect(rows[2].names).toContain('Attack Up'); // R3: count 2 → flips on
        expect(rows[5].names).toContain('Attack Up'); // stays on

        // Control: same skills WITHOUT the buff ability → a later round deals less damage.
        idCounter = 0;
        const control: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                        ab({
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
        };
        const controlRows = buffNamesByRound(control);
        expect(rows[5].directDamage).toBeGreaterThan(controlRows[5].directDamage);
    });

    it('2. declining off: aura gated on enemy HP > 50% switches off as HP drops', () => {
        idCounter = 0;
        // enemyHp tuned so the pool crosses 50% partway through. Aura buff is included
        // while enemy HP% > 50, dropped once it falls below.
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'buff',
                            target: 'self',
                            conditions: [
                                {
                                    subject: 'hp-threshold',
                                    derivable: true,
                                    hpComparator: 'above',
                                    hpPercent: 50,
                                },
                            ],
                            config: {
                                type: 'buff',
                                buffName: 'Opening Salvo',
                                parsedEffects: { attack: 40 },
                                stacks: 1,
                                isStackable: false,
                                duration: 'recurring',
                            },
                        }),
                    ],
                },
            ],
        };
        const rows = buffNamesByRound(skills, { enemyHp: 60000 });
        // Present early (HP entering round > 50%), absent once it crosses below.
        expect(rows[0].names).toContain('Opening Salvo');
        const flipsOff = rows.findIndex((r) => !r.names.includes('Opening Salvo'));
        expect(flipsOff).toBeGreaterThan(0);
        // Once off, it stays off (HP only ever decreases).
        for (let i = flipsOff; i < rows.length; i++) {
            expect(rows[i].names).not.toContain('Opening Salvo');
        }
    });

    it('3. aura flicker: aura gated on enemy-debuff ≥ 1 follows DoT entry presence', () => {
        idCounter = 0;
        // Charged-only corrosion (dur 2). chargeCount 2, startCharged false → charged on
        // rounds 3, 6, 9, 12. The aura is gated on enemy-debuff ≥ 1, so it follows the
        // corrosion entry presence (on after a charged round lands a DoT, off once it expires).
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 120 } }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 300 } }),
                        ab({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'corrosion',
                                tier: 5,
                                stacks: 1,
                                duration: 2,
                            },
                        }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'buff',
                            target: 'self',
                            conditions: [
                                {
                                    subject: 'enemy-debuff',
                                    derivable: true,
                                    countComparator: 'gte',
                                    countThreshold: 1,
                                },
                            ],
                            config: {
                                type: 'buff',
                                buffName: 'Predator',
                                parsedEffects: { critDamage: 25 },
                                stacks: 1,
                                isStackable: false,
                                duration: 'recurring',
                            },
                        }),
                    ],
                },
            ],
        };
        const rows = buffNamesByRound(skills, { chargeCount: 2, enemyHp: 5_000_000 });
        // Round 1-3 before any DoT lands: absent (gate built pre-Step-3, count 0 on R3).
        expect(rows[0].names).not.toContain('Predator');
        // After the first charged round (R3) applies a corrosion entry, later rounds see it.
        const onRounds = rows.filter((r) => r.names.includes('Predator')).map((r) => r.round);
        const offRounds = rows.filter((r) => !r.names.includes('Predator')).map((r) => r.round);
        // It flickers — at least one on AND one off after the first DoT.
        expect(onRounds.length).toBeGreaterThan(0);
        expect(offRounds.length).toBeGreaterThan(0);
    });

    it('4. timed window persists after the condition lapses', () => {
        idCounter = 0;
        // Timed buff (duration 3) gated hp-threshold above 80. Condition true at the
        // application round (R1, enemy at 100%), then false later as HP drops — but the
        // buff persists its full window once applied.
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                        ab({
                            type: 'buff',
                            target: 'self',
                            conditions: [
                                {
                                    subject: 'hp-threshold',
                                    derivable: true,
                                    hpComparator: 'above',
                                    hpPercent: 80,
                                },
                            ],
                            config: {
                                type: 'buff',
                                buffName: 'Alpha Strike',
                                parsedEffects: { attack: 30 },
                                stacks: 1,
                                isStackable: false,
                                duration: 3,
                            },
                        }),
                    ],
                },
            ],
        };
        // Small enemy HP so it drops below 80% almost immediately after round 1.
        const rows = buffNamesByRound(skills, { enemyHp: 30000 });
        // Applied at R1 (HP entering = 100% > 80) and persists rounds 1-3 even though
        // the condition is false from R2 onward.
        expect(rows[0].names).toContain('Alpha Strike'); // applied R1
        expect(rows[1].names).toContain('Alpha Strike'); // window persists R2
        expect(rows[2].names).toContain('Alpha Strike'); // window persists R3
    });

    it('5. skipped application then passing re-application', () => {
        idCounter = 0;
        // Timed buff gated enemy-debuff ≥ 2 on the active skill; corrosion (dur 3) applied
        // each round. First casts fail the gate (count < 2), a later cast passes (count ≥ 2).
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                        ab({
                            type: 'buff',
                            target: 'self',
                            conditions: [
                                {
                                    subject: 'enemy-debuff',
                                    derivable: true,
                                    countComparator: 'gte',
                                    countThreshold: 2,
                                },
                            ],
                            config: {
                                type: 'buff',
                                buffName: 'Momentum Strike',
                                parsedEffects: { attack: 30 },
                                stacks: 1,
                                isStackable: false,
                                duration: 1,
                            },
                        }),
                        ab({
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
        };
        const rows = buffNamesByRound(skills, { enemyHp: 5_000_000 });
        // R1 (count 0) and R2 (count 1): gate fails → absent.
        expect(rows[0].names).not.toContain('Momentum Strike');
        expect(rows[1].names).not.toContain('Momentum Strike');
        // R3 onward (count ≥ 2): gate passes → present.
        expect(rows[2].names).toContain('Momentum Strike');
    });
});
