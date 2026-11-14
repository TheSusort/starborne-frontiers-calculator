/**
 * Eelun Naphula's Acidic Decay (#519). Owner rulings 2026-11-14:
 *   - her active and charged inflict Acidic Decay III (a Corrosion III that cannot be cleansed)
 *     on every enemy for 3 turns;
 *   - "When an ally dies, the next Active also applies a second Acidic Decay III for 1 turn":
 *     any own-side death (DoT and bomb deaths included) primes her next ACTIVE; several deaths
 *     still give one extra copy; the charged neither uses nor clears the prime; the two copies
 *     are independent entries.
 * Every board runs with Eelun on the player side and on the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import type { CombatActor } from '../state';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { bossShip } from '../../../constants/bountyBosses';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import {
    boardInput,
    hitKit,
    NO_KIT,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import { textKit } from '../__testutils__/textKit';
import { parsePattern, parseTarget } from '../../targetingParser';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(519));

const SIDES: Placement[] = ['player', 'enemy'];

const CLEANSE_TEXT =
    'This Unit deals <unit-damage>100% damage</unit-damage> and <unit-skill>cleanses all debuffs</unit-skill>.';
const CORROSION_TEXT = 'This Unit inflicts <unit-skill>Corrosion I</unit-skill> for 3 turns.';
const INFERNO_TEXT = 'This Unit inflicts <unit-skill>Inferno I</unit-skill> for 2 turns.';

/** Eelun with her real kit. A high `chargeCount` keeps her on her active. */
const eelun = (extra: Partial<BoardUnit> = {}): BoardUnit => ({
    id: 'eelun',
    kit: buildShipAbilities(bossShip('eelun', 32)!),
    position: 'M4',
    speed: 300,
    hp: 1e9,
    hacking: 1e6,
    chargeCount: 99,
    pattern: parsePattern('Pattern-All'),
    target: parseTarget('all'),
    ...extra,
});

/** An Eelun ally that dies to any hit. */
const frail = (id: string, position: BoardUnit['position']): BoardUnit => ({
    id,
    kit: NO_KIT,
    position,
    speed: 1,
    hp: 1,
});

/** An opponent that strikes every one of Eelun's side before she acts. */
const sweeper = (kit = hitKit(100)): BoardUnit => ({
    id: 'sweeper',
    kit,
    position: 'M1',
    speed: 500,
    attack: 1000,
    hacking: 1e6,
    pattern: parsePattern('Pattern-All'),
    target: parseTarget('all'),
});

const victim = (id: string, position: BoardUnit['position'], extra: Partial<BoardUnit> = {}) => ({
    id,
    kit: NO_KIT,
    position,
    speed: 2,
    hp: 1e9,
    security: 0,
    ...extra,
});

interface Landing {
    round: number;
    targetId: string;
    tier?: number;
    remainingRounds?: number;
    family?: string;
    unremovable?: boolean;
}

interface Cast {
    round: number;
    slot: 'active' | 'charged';
    landings: Landing[];
}

/** Every one of Eelun's casts, in order, with the DoT entries it landed (read off the victim's
 *  container the moment each lands). */
const eelunCasts = (
    placement: Placement,
    carrier: BoardUnit,
    allies: BoardUnit[],
    opponents: BoardUnit[],
    rounds: number
): {
    casts: Cast[];
    id: (u: BoardUnit) => string;
    actors: CombatActor[];
    dots: Extract<CombatEvent, { type: 'dot-applied' }>[];
} => {
    const { input, id } = boardInput(placement, carrier, allies, opponents, rounds);
    const bus = createEventBus();
    let actors: CombatActor[] = [];
    const casts: Cast[] = [];
    const dots: Extract<CombatEvent, { type: 'dot-applied' }>[] = [];
    const eelunId = id(carrier);
    bus.on('skill-fired', (e: Extract<CombatEvent, { type: 'skill-fired' }>) => {
        if (e.actorId === eelunId) casts.push({ round: e.round, slot: e.slot, landings: [] });
    });
    bus.on('dot-applied', (e: Extract<CombatEvent, { type: 'dot-applied' }>) => {
        dots.push(e);
        if (e.sourceId !== eelunId) return;
        const holder = actors.find((a) => a.id === e.targetId);
        const entry = holder?.corrosionEntries.find((x) => x.appliedSeq === e.appliedSeq);
        casts[casts.length - 1].landings.push({
            round: e.round,
            targetId: e.targetId,
            tier: e.tier,
            remainingRounds: entry?.remainingRounds,
            family: entry?.family,
            unremovable: entry?.unremovable,
        });
    });
    runCombat({
        ...input,
        bus,
        __testTapActors: (a) => {
            actors = a;
        },
    });
    return { casts, id, actors, dots };
};

const durationsOn = (cast: Cast, targetId: string) =>
    cast.landings
        .filter((l) => l.targetId === targetId)
        .map((l) => l.remainingRounds)
        .sort();

describe.each(SIDES)('Acidic Decay, Eelun on the %s side', (placement) => {
    it('her active lands one Acidic Decay III for 3 turns on every enemy', () => {
        const a = victim('a', 'M1');
        const b = victim('b', 'B3');
        const { casts, id } = eelunCasts(placement, eelun(), [], [a, b], 1);
        expect(casts).toHaveLength(1);
        expect(casts[0].slot).toBe('active');
        for (const v of [a, b]) {
            const on = casts[0].landings.filter((l) => l.targetId === id(v));
            expect(on).toEqual([
                {
                    round: 1,
                    targetId: id(v),
                    tier: 9,
                    remainingRounds: 3,
                    family: 'Acidic Decay',
                    unremovable: true,
                },
            ]);
        }
    });

    it('after an ally dies her next active lands a second, 1-turn copy; the one after does not', () => {
        const a = victim('a', 'B3');
        const { casts, id } = eelunCasts(
            placement,
            eelun(),
            [frail('ally', 'M2')],
            [sweeper(), a],
            2
        );
        expect(casts.map((c) => c.slot)).toEqual(['active', 'active']);
        expect(durationsOn(casts[0], id(a))).toEqual([1, 3]);
        expect(durationsOn(casts[1], id(a))).toEqual([3]);
    });

    it('validity: with no ally death every active lands one copy', () => {
        const a = victim('a', 'B3');
        const { casts, id } = eelunCasts(placement, eelun(), [], [sweeper(), a], 2);
        expect(casts.map((c) => durationsOn(c, id(a)))).toEqual([[3], [3]]);
    });

    it('two deaths before her active still give one extra copy', () => {
        const a = victim('a', 'B3');
        const { casts, id } = eelunCasts(
            placement,
            eelun(),
            [frail('ally1', 'M2'), frail('ally2', 'T2')],
            [sweeper(), a],
            1
        );
        expect(durationsOn(casts[0], id(a))).toEqual([1, 3]);
    });

    it('a DoT death primes her next active too', () => {
        const a = victim('a', 'B3');
        // The ally ticks its Inferno at its own turn start, before Eelun acts, and dies to it.
        const ally = { ...frail('ally', 'M2'), speed: 400 };
        const { casts, id } = eelunCasts(
            placement,
            eelun(),
            [ally],
            [sweeper(textKit('Burner', { active: INFERNO_TEXT })), a],
            1
        );
        expect(durationsOn(casts[0], id(a))).toEqual([1, 3]);
    });

    it('a charged cast between the death and her active neither uses nor clears the prime', () => {
        const a = victim('a', 'B3');
        const { casts, id } = eelunCasts(
            placement,
            eelun({ chargeCount: 3, startCharged: true }),
            [frail('ally', 'M2')],
            [sweeper(), a],
            3
        );
        const firstActive = casts.findIndex((c) => c.slot === 'active');
        expect(casts[0].slot).toBe('charged');
        expect(firstActive).toBeGreaterThan(0);
        expect(durationsOn(casts[0], id(a))).toEqual([3]);
        expect(durationsOn(casts[firstActive], id(a))).toEqual([1, 3]);
    });

    it('a cleanse removes a plain Corrosion but leaves Acidic Decay standing', () => {
        const cleanser = victim('cleanser', 'M1', {
            kit: textKit('Cleanser', { active: CLEANSE_TEXT }),
        });
        // A second applier on Eelun's side, faster than the cleanser, lands a plain Corrosion.
        const corroder: BoardUnit = {
            id: 'corroder',
            kit: textKit('Corroder', { active: CORROSION_TEXT }),
            position: 'T4',
            speed: 250,
            hacking: 1e6,
            pattern: parsePattern('Pattern-All'),
            target: parseTarget('all'),
        };
        const { casts, id, actors, dots } = eelunCasts(
            placement,
            eelun(),
            [corroder],
            [cleanser],
            1
        );
        // Both landed before the cleanser's turn, so the contrast below is not vacuous.
        expect(durationsOn(casts[0], id(cleanser))).toEqual([3]);
        expect(dots.some((d) => d.sourceId === id(corroder) && d.targetId === id(cleanser))).toBe(
            true
        );
        const entries = actors.find((x) => x.id === id(cleanser))!.corrosionEntries;
        expect(entries.map((e) => [e.tier, e.family])).toEqual([[9, 'Acidic Decay']]);
    });
});
