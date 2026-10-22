/**
 * Tripwires for the combat flowchart's turn skeleton — rules the engine already follows that had
 * no test of their own (`docs/flowchart-conformance-ledger.md`, rows 2.1, 5.1, 8.4 and 8.7):
 *  - one turn runs turn-started → its own DoTs tick → the skill fires → its statuses decrement
 *    (Post Turn) → turn-ended;
 *  - a turn that is not blocked uses exactly ONE skill (active or charged); a stasised turn uses
 *    none;
 *  - a buff is always applied: it draws no landing roll;
 *  - a debuff never crits: its landing draws no crit roll, and a cast that only inflicts debuffs
 *    is no critical hit (a crit needs damage).
 * Every case runs with the acting ship on both sides.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import type { CombatActor } from '../state';
import { setKeyedRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { boardInput, NO_KIT, type BoardUnit, type Placement } from '../__testutils__/realKitBoard';
import type { Ability, ShipSkills } from '../../../types/abilities';

afterEach(() => {
    resetRateGateRng();
});

const hit: Ability = {
    id: 'hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
};
const attackUp = (duration: number): Ability => ({
    id: 'attack-up',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Attack Up I',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration,
    },
});
const inflict = (buffName: string, duration: number): Ability => ({
    id: `inflict-${buffName}`,
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName,
        application: 'inflict',
        duration,
        stacks: 1,
        isStackable: false,
        parsedEffects: {},
    },
});
const active = (abilities: Ability[]): ShipSkills => ({ slots: [{ slot: 'active', abilities }] });

const PLACEMENTS: Placement[] = ['player', 'enemy'];

/** The caster at M4 against one inert enemy, `rounds` rounds. */
const duel = (
    placement: Placement,
    caster: Partial<BoardUnit> & Pick<BoardUnit, 'kit'>,
    opponent: Partial<BoardUnit> = {},
    rounds = 1
): { input: CombatEngineInput; casterId: string; opponentId: string } => {
    const c: BoardUnit = { id: 'caster', position: 'M4', speed: 100, attack: 100, ...caster };
    const o: BoardUnit = { id: 'opponent', position: 'M4', speed: 5, kit: NO_KIT, ...opponent };
    const { input, id } = boardInput(placement, c, [], [o], rounds);
    return { input, casterId: id(c), opponentId: id(o) };
};

for (const placement of PLACEMENTS) {
    describe(`flowchart tripwires (acting ship on the ${placement} side)`, () => {
        it('row 2.1: turn-started < own DoT tick < skill-fired < buff-expired < turn-ended', () => {
            // Round 1: the charged skill grants a 1-turn Attack Up. Round 2: the caster's own
            // generic DoT ticks, it casts its active, and the Attack Up expires at its Post Turn.
            const { input, casterId } = duel(
                placement,
                {
                    kit: {
                        slots: [
                            { slot: 'active', abilities: [hit] },
                            { slot: 'charged', abilities: [hit, attackUp(1)] },
                        ],
                    },
                    chargeCount: 1,
                    startCharged: true,
                },
                {},
                2
            );
            const bus = createEventBus();
            const round2: string[] = [];
            const mine = (e: CombatEvent): boolean =>
                e.round === 2 &&
                ('actorId' in e
                    ? e.actorId === casterId
                    : 'targetId' in e && e.targetId === casterId);
            for (const type of [
                'turn-started',
                'dot-ticked',
                'skill-fired',
                'buff-expired',
                'turn-ended',
            ] as const)
                bus.on(type, (e: CombatEvent) => {
                    if (mine(e)) round2.push(e.type);
                });
            runCombat({
                ...input,
                bus,
                __testTapActors: (all: CombatActor[]) => {
                    all.find((a) => a.id === casterId)?.genericDoTEntries.push({
                        stacks: 1,
                        tier: 0,
                        remainingRounds: 9,
                        sourceId: 'seed',
                        perTickAmount: 10,
                    });
                },
            });
            expect(round2).toEqual([
                'turn-started',
                'dot-ticked',
                'skill-fired',
                'buff-expired',
                'turn-ended',
            ]);
        });

        it('rows 5.1/6.3: one skill per turn that is not blocked, none on a stasised turn', () => {
            // The opponent acts AFTER the caster and stasises it every round: the caster's round-1
            // turn is free, every later one is blocked. The opponent's own turns are all free.
            const { input, casterId, opponentId } = duel(
                placement,
                { kit: active([hit]), security: 0 },
                { speed: 50, hacking: 1e6, kit: active([inflict('Stasis', 1)]) },
                4
            );
            const bus = createEventBus();
            const perTurn: Record<string, number[]> = { [casterId]: [], [opponentId]: [] };
            let acting: string | undefined;
            bus.on('turn-started', (e: Extract<CombatEvent, { type: 'turn-started' }>) => {
                acting = e.actorId;
                perTurn[e.actorId]?.push(0);
            });
            bus.on('skill-fired', (e: Extract<CombatEvent, { type: 'skill-fired' }>) => {
                const turns = perTurn[e.actorId];
                if (turns && e.actorId === acting) turns[turns.length - 1] += 1;
            });
            bus.on('turn-ended', () => {
                acting = undefined;
            });
            runCombat({ ...input, bus });
            expect(perTurn[casterId]).toEqual([1, 0, 0, 0]);
            expect(perTurn[opponentId]).toEqual([1, 1, 1, 1]);
        });

        /** Every keyed RNG stream the run draws from, by key. */
        const drawnKeys = (input: CombatEngineInput): string[] => {
            const keys: string[] = [];
            setKeyedRng((key) => {
                keys.push(key);
                return 0.5;
            });
            try {
                runCombat(input);
            } finally {
                resetRateGateRng();
            }
            return keys;
        };

        it('row 8.4: a buff draws no landing roll (a debuff does)', () => {
            const caster = { crit: 50, critDamage: 50, hacking: 1e6 };
            const buffs = duel(placement, { ...caster, kit: active([attackUp(2)]) });
            expect(drawnKeys(buffs.input).filter((k) => k === `${buffs.casterId}:landing`)).toEqual(
                []
            );
            const debuffs = duel(placement, {
                ...caster,
                kit: active([inflict('Attack Down I', 2)]),
            });
            expect(drawnKeys(debuffs.input)).toContain(`${debuffs.casterId}:landing`);
        });

        it('row 8.7: a debuff landing draws no crit roll — adding one to a hit adds only its landing roll', () => {
            const caster = { crit: 50, critDamage: 50, hacking: 1e6 };
            const count = (keys: string[], key: string) => keys.filter((k) => k === key).length;
            const plain = duel(placement, { ...caster, kit: active([hit]) });
            const withDebuff = duel(placement, {
                ...caster,
                kit: active([hit, inflict('Attack Down I', 2)]),
            });
            const plainKeys = drawnKeys(plain.input);
            const debuffKeys = drawnKeys(withDebuff.input);
            const crit = `${plain.casterId}:active-crit`;
            const landing = `${plain.casterId}:landing`;
            expect(count(plainKeys, crit)).toBeGreaterThan(0);
            expect(count(debuffKeys, crit)).toBe(count(plainKeys, crit));
            expect(count(plainKeys, landing)).toBe(0);
            expect(count(debuffKeys, landing)).toBe(1);
        });

        it('row 8.7, cast level: a 100%-crit cast that only inflicts a debuff logs no crit (a hit does)', () => {
            const caster = { crit: 100, critDamage: 50, hacking: 1e6 };
            const castCrit = (kit: ShipSkills): boolean => {
                const d = duel(placement, { ...caster, kit });
                const bus = createEventBus();
                let crit = false;
                bus.on(
                    'ability-performed',
                    (e: Extract<CombatEvent, { type: 'ability-performed' }>) => {
                        if (e.actorId === d.casterId && e.didCrit) crit = true;
                    }
                );
                runCombat({ ...d.input, bus });
                return crit;
            };
            expect(castCrit(active([inflict('Attack Down I', 2)]))).toBe(false);
            expect(castCrit(active([hit]))).toBe(true);
        });
    });
}
