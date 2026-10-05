/**
 * Every STACK of a buff is a separate buff (owner ruling R37, 2026-10-05 — the buff-side mirror of
 * R26). Your Butcher uses her charged skill ("an additional 35% for each buff on the enemy") on an
 * enemy Centurion who just gained 4 stacks of Core Charge I and holds nothing else: she counts 4,
 * for 150% + 140%. The same count serves Nuqtu's "If the target has 3 or more buffs", Rhodium's
 * "for each buff on the enemy", Valiant/Sustainer/Thresh "buffs on itself", and "the enemy with
 * the most buffs" (Rhodium, Lodolite). A purge still removes the newest WHOLE buff (R38).
 *
 * Real parsed kits (buildTraceShip, refit 4) for every ship under test; Centurion's real charged
 * skill ("This Unit gains 4 stacks of Core Charge I …") is the stacked buff. Neutral buffs with no
 * stat effects stand in where a count needs distinct names beside a stack. Each case runs with the
 * caster on the player side and on the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { Ability } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';
import { mirrorBoard, realSlots, ShipSpec, MirrorTeams } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

let idc = 0;
beforeEach(() => {
    idc = 0;
    setupKeyedRng(5);
});

/** A self buff with no stat effects. */
const plainBuff = (name: string): Ability => ({
    id: `plain-${++idc}`,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: name,
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 3,
    },
});

/** ONE stackable buff with no stat effects, held at `stacks` stacks. */
const stackedBuff = (name: string, stacks: number): Ability => ({
    ...plainBuff(name),
    config: {
        type: 'buff',
        buffName: name,
        parsedEffects: {},
        stacks,
        isStackable: true,
        maxStacks: stacks,
        duration: 'recurring',
    },
});

/** A durable ship that grants ITSELF `buffs` on its turn, faster than every caster. */
const holder = (id: string, position: Position, buffs: Ability[]): ShipSpec => ({
    id,
    position,
    speed: 150,
    skills: { slots: [{ slot: 'active', abilities: buffs }] },
});

/** Centurion casting his real charged skill on his first turn: 4 stacks of Core Charge I. */
const centurion = (id: string, position: Position): ShipSpec => ({
    id,
    position,
    speed: 150,
    chargeCount: 2,
    startCharged: true,
    skills: { slots: realSlots('Centurion', ['active', 'charged']) },
});

/** Damage of `caster`'s first damage ability in round 1. */
const firstHit = (teams: MirrorTeams, side: 'player' | 'enemy'): number => {
    const { input, idOf } = mirrorBoard(teams, side);
    const id = idOf('caster');
    const bus = createEventBus();
    const hits: number[] = [];
    bus.on('ability-performed', (e: Extract<CombatEvent, { type: 'ability-performed' }>) => {
        if (e.actorId === id && e.abilityType === 'damage' && e.round === 1)
            hits.push(e.damage ?? 0);
    });
    runCombat({ ...input, bus });
    return hits[0] ?? NaN;
};

const SIDES = ['player', 'enemy'] as const;

describe("Butcher charged: 'an additional 35% for each buff on the enemy' counts each stack", () => {
    const butcher = (): ShipSpec => {
        const slots = realSlots('Butcher', ['active', 'charged']);
        return {
            id: 'caster',
            position: 'M4',
            speed: 10,
            attack: 1000,
            chargeCount: 3,
            startCharged: true,
            skills: { slots },
        };
    };
    for (const side of SIDES) {
        it(`${side}-side: Centurion holding Core Charge I ×4 → 150% + 4 × 35%`, () => {
            const clean = firstHit(
                { caster: [butcher()], other: [holder('target', 'M4', [])] },
                side
            );
            const shred = firstHit(
                { caster: [butcher()], other: [centurion('target', 'M4')] },
                side
            );
            expect(clean).toBeGreaterThan(0);
            expect(shred / clean).toBeCloseTo(290 / 150, 4);
        });
        it(`${side}-side: a 3-stack buff and a plain one → 150% + 4 × 35%`, () => {
            const clean = firstHit(
                { caster: [butcher()], other: [holder('target', 'M4', [])] },
                side
            );
            const mixed = firstHit(
                {
                    caster: [butcher()],
                    other: [
                        holder('target', 'M4', [
                            stackedBuff('Neutral Stack', 3),
                            plainBuff('Neutral Plain'),
                        ]),
                    ],
                },
                side
            );
            expect(mixed / clean).toBeCloseTo(290 / 150, 4);
        });
        it(`${side}-side reverse board: the stacks land after Butcher hits → the base 150%`, () => {
            const clean = firstHit(
                { caster: [butcher()], other: [holder('target', 'M4', [])] },
                side
            );
            const late = firstHit(
                { caster: [{ ...butcher(), speed: 300 }], other: [centurion('target', 'M4')] },
                side
            );
            expect(late / clean).toBeCloseTo(1, 4);
        });
    }
});

describe("Valiant charged: 'an additional 22.5% for each buff on itself' counts each stack", () => {
    // Valiant's charged also gains Legion Discipline II before the hit (a buff, counted in every
    // variant); a neutral buff written ahead of it varies the rest. Damage is linear in the count.
    const valiant = (extra: Ability[]): ShipSpec => {
        const [active, charged] = realSlots('Valiant', ['active', 'charged']);
        return {
            id: 'caster',
            position: 'M4',
            speed: 10,
            attack: 1000,
            chargeCount: 3,
            startCharged: true,
            skills: {
                slots: [active, { ...charged, abilities: [...extra, ...charged.abilities] }],
            },
        };
    };
    for (const side of SIDES) {
        it(`${side}-side: a 3-stack buff adds three times what one plain buff adds`, () => {
            const target = holder('target', 'M4', []);
            const none = firstHit({ caster: [valiant([])], other: [target] }, side);
            const plain = firstHit(
                { caster: [valiant([plainBuff('Neutral Plain')])], other: [target] },
                side
            );
            const stacked = firstHit(
                { caster: [valiant([stackedBuff('Neutral Stack', 3)])], other: [target] },
                side
            );
            expect(plain).toBeGreaterThan(none);
            expect(stacked - none).toBeCloseTo(3 * (plain - none), 6);
        });
    }
});

describe("Nuqtu active: 'If the target has 3 or more buffs' counts each stack", () => {
    const nuqtu = (): ShipSpec => ({
        id: 'caster',
        position: 'M4',
        speed: 10,
        attack: 1000,
        chargeCount: 10,
        hasChargedSkill: true,
        skills: { slots: realSlots('Nuqtu', ['active', 'charged']) },
    });
    const chargeGain = (teams: MirrorTeams, side: 'player' | 'enemy'): number => {
        const { input, idOf } = mirrorBoard(teams, side);
        const id = idOf('caster');
        const bus = createEventBus();
        let gain = 0;
        bus.on('charge-changed', (e: Extract<CombatEvent, { type: 'charge-changed' }>) => {
            if (e.actorId === id && e.round === 1 && e.reason === 'manip')
                gain += e.newCharge - e.oldCharge;
        });
        runCombat({ ...input, bus });
        return gain;
    };
    for (const side of SIDES) {
        it(`${side}-side: one buff at 3 stacks → +2 charges`, () => {
            expect(
                chargeGain(
                    {
                        caster: [nuqtu()],
                        other: [holder('target', 'M4', [stackedBuff('Neutral Stack', 3)])],
                    },
                    side
                )
            ).toBe(2);
        });
        it(`${side}-side: one buff at 2 stacks → no charge`, () => {
            expect(
                chargeGain(
                    {
                        caster: [nuqtu()],
                        other: [holder('target', 'M4', [stackedBuff('Neutral Stack', 2)])],
                    },
                    side
                )
            ).toBe(0);
        });
    }
});

describe("Rhodium passive: 'the enemy with the most buffs' counts each stack", () => {
    const rhodium = (): ShipSpec => ({
        id: 'caster',
        position: 'M4',
        speed: 10,
        skills: {
            slots: [{ slot: 'active', abilities: [] }, ...realSlots('Rhodium', ['passive'])],
        },
    });
    /** Who Rhodium's round-1 end-of-round purge hits. */
    const purged = (teams: MirrorTeams, side: 'player' | 'enemy'): string[] => {
        const { input, idOf } = mirrorBoard(teams, side);
        const id = idOf('caster');
        const bus = createEventBus();
        const out: string[] = [];
        bus.on('purge-performed', (e: Extract<CombatEvent, { type: 'purge-performed' }>) => {
            if (e.casterId !== id || e.round !== 1) return;
            out.push(teams.other.find((s) => idOf(s.id) === e.targetId)?.id ?? e.targetId);
        });
        runCombat({ ...input, bus });
        return out;
    };
    // The two holders sit apart (T4, B4) so Centurion's "grants all adjacent allies 2 stacks"
    // reaches neither of them.
    const plains = (n: number): Ability[] =>
        Array.from({ length: n }, (_, i) => plainBuff(`Neutral ${i + 1}`));
    for (const side of SIDES) {
        it(`${side}-side: A with 3 plain buffs, B Centurion with Core Charge I ×4 → B`, () => {
            const teams: MirrorTeams = {
                caster: [rhodium()],
                other: [holder('a', 'T4', plains(3)), centurion('b', 'B4')],
            };
            expect(purged(teams, side)).toEqual(['b']);
        });
        it(`${side}-side reverse board: A Centurion with Core Charge I ×4, B with 3 plain → A`, () => {
            const teams: MirrorTeams = {
                caster: [rhodium()],
                other: [centurion('a', 'T4'), holder('b', 'B4', plains(3))],
            };
            expect(purged(teams, side)).toEqual(['a']);
        });
        it(`${side}-side: A with 3 plain buffs, B Centurion without his charge → A`, () => {
            const teams: MirrorTeams = {
                caster: [rhodium()],
                other: [
                    holder('a', 'T4', plains(3)),
                    { ...centurion('b', 'B4'), startCharged: false },
                ],
            };
            expect(purged(teams, side)).toEqual(['a']);
        });
    }
});
