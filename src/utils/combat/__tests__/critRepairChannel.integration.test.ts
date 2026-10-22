/**
 * Critically REPAIRING and critically HITTING an enemy are separate channels (owner ruling
 * 2026-10-22). A repair crits on its own heal-crit roll (R155), whether or not the cast deals
 * damage, and only that roll wakes a crit-repair trigger; it never wakes an on-crit-HIT trigger.
 * Real kits from docs/ship-skills.csv, both sides:
 *  - Hermes: "when it critically repairs an ally, it cleanses 1 debuff from itself"
 *    (`on-ally-critically-repaired`, the owner's own repair) — his active only repairs;
 *  - Pallas: "gains Attack Up II ... after an ally is critically repaired"
 *    (`on-any-ally-critically-repaired`) — an ally's repair-only cast crits;
 *  - Hermes: "When an ally critically hits an enemy, this Unit adds 1 charge" does NOT fire off
 *    an ally's crit repair.
 * Each crit case has a crit-0 control.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { boardInput, NO_KIT, realKit, type BoardUnit } from '../__testutils__/realKitBoard';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';

beforeEach(() => {
    setupKeyedRng(1022);
});
afterEach(() => {
    resetRateGateRng();
});

const repairOnly: ShipSkills = {
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'repair-allies',
                    type: 'heal',
                    target: 'all-allies',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'heal', pct: 10, basis: 'hp' },
                } satisfies Ability,
            ],
        },
    ],
};
const hexer = (): BoardUnit => ({
    id: 'hexer',
    position: 'M4',
    speed: 300,
    hacking: 1e6,
    kit: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'attack-down',
                        type: 'debuff',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: {
                            type: 'debuff',
                            buffName: 'Attack Down I',
                            application: 'inflict',
                            duration: 3,
                            stacks: 1,
                            isStackable: false,
                            parsedEffects: {},
                        },
                    },
                ],
            },
        ],
    },
});

/** Every ship below starts at half HP, so a repair is never a no-op. */
const halfHp = (all: CombatActor[]) => {
    for (const a of all) a.currentHp = a.stats.hp / 2;
};

for (const placement of ['player', 'enemy'] as const) {
    describe(`crit repairs and crit hits are separate channels (${placement} side)`, () => {
        /** Hermes at the front, hexed first, then repairs himself. */
        const hermesSelfRepair = (crit: number) => {
            const hermes: BoardUnit = {
                id: 'hermes',
                position: 'M4',
                speed: 100,
                crit,
                critDamage: 50,
                chargeCount: 9,
                kit: realKit('Hermes'),
            };
            const { input, id } = boardInput(placement, hermes, [], [hexer()], 1);
            const bus = createEventBus();
            const seen = { hexed: false, repairCrit: false, cleansed: 0 };
            bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
                if (e.targetId === id(hermes)) seen.hexed = true;
            });
            bus.on('heal-performed', (e: Extract<CombatEvent, { type: 'heal-performed' }>) => {
                if (e.casterId === id(hermes) && (e.critHits ?? 0) > 0) seen.repairCrit = true;
            });
            bus.on(
                'reactive-cleanse-performed',
                (e: Extract<CombatEvent, { type: 'reactive-cleanse-performed' }>) => {
                    if (e.casterId === id(hermes))
                        for (const pt of e.perTarget) seen.cleansed += pt.count;
                }
            );
            runCombat({ ...input, bus, __testTapActors: halfHp });
            return seen;
        };

        it("Hermes's repair-only cast crits on its repair roll and cleanses his debuff", () => {
            const s = hermesSelfRepair(100);
            expect(s.hexed).toBe(true);
            expect(s.repairCrit).toBe(true);
            expect(s.cleansed).toBe(1);
        });

        it('control: a non-crit repair cleanses nothing', () => {
            const s = hermesSelfRepair(0);
            expect(s.hexed).toBe(true);
            expect(s.repairCrit).toBe(false);
            expect(s.cleansed).toBe(0);
        });

        /** Pallas (carrier) and Hermes with a repair-only ally. */
        const allyRepairs = (crit: number) => {
            const pallas: BoardUnit = {
                id: 'pallas',
                position: 'M1',
                speed: 10,
                chargeCount: 9,
                kit: realKit('Pallas'),
            };
            const hermes: BoardUnit = {
                id: 'hermes',
                position: 'T1',
                speed: 5,
                chargeCount: 9,
                kit: realKit('Hermes'),
            };
            const healer: BoardUnit = {
                id: 'healer',
                position: 'M4',
                speed: 100,
                crit,
                critDamage: 50,
                kit: repairOnly,
            };
            const target: BoardUnit = { id: 'target', position: 'M4', speed: 1, kit: NO_KIT };
            const { input, id } = boardInput(placement, pallas, [hermes, healer], [target], 1);
            const bus = createEventBus();
            const seen = { repairCrit: false, pallasAttackUp: false, hermesCharge: 0 };
            bus.on('heal-performed', (e: Extract<CombatEvent, { type: 'heal-performed' }>) => {
                if (e.casterId === id(healer) && (e.critHits ?? 0) > 0) seen.repairCrit = true;
            });
            bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
                if (e.actorId === id(pallas) && e.buffName === 'Attack Up II')
                    seen.pallasAttackUp = true;
            });
            bus.on('charge-changed', (e: Extract<CombatEvent, { type: 'charge-changed' }>) => {
                if (e.actorId === id(hermes) && e.reason === 'manip')
                    seen.hermesCharge += e.newCharge - e.oldCharge;
            });
            runCombat({ ...input, bus, __testTapActors: halfHp });
            return seen;
        };

        it("an ally's crit repair wakes Pallas's crit-repair trigger, never Hermes's crit-hit one", () => {
            const s = allyRepairs(100);
            expect(s.repairCrit).toBe(true);
            expect(s.pallasAttackUp).toBe(true);
            expect(s.hermesCharge).toBe(0);
        });

        it('control: a non-crit repair wakes neither', () => {
            const s = allyRepairs(0);
            expect(s.repairCrit).toBe(false);
            expect(s.pallasAttackUp).toBe(false);
            expect(s.hermesCharge).toBe(0);
        });
    });
}
