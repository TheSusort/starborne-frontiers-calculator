/**
 * A cleanse or purge clause that resolves and removes nothing logs its attempt: one LOG-ONLY
 * `cleanse-attempt-log` / `purge-attempt-log`, which opens an `attemptOnly` row of 0. A clause that
 * removed something logs its performed event and no attempt. Every emission site runs with the
 * carrier on the player side and mirrored onto the enemy side.
 *
 * Kits come from skill text (`textKit`), in the wording real ships use: Obsidian's "purges 1 buff
 * from the enemy and deals …" (purge ahead of the damage), Sefuba's "deals … and purges 1 buff from
 * the enemy" (purge after it), the "cleanses 1 debuff and deals …" self-cleanse, the plain support
 * "cleanses 1 debuff", Nuqtu's "Every turn this Unit cleanses 1 debuff, once per round", and the
 * on-attacked "reduces the duration of all active debuffs on itself by 1 turn".
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import {
    boardInput,
    hitKit,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import { textKit } from '../__testutils__/textKit';
import type { ShipSkills } from '../../../types/abilities';
import type { AffinityName } from '../../../types/ship';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(11));

const PLACEMENTS: Placement[] = ['player', 'enemy'];
const ATTEMPT_TYPES = new Set<CombatEvent['type']>(['cleanse-attempt-log', 'purge-attempt-log']);

const PURGE_BEFORE_DAMAGE =
    'This Unit <unit-skill>purges 1 buff</unit-skill> from the enemy and deals <unit-damage>100% damage</unit-damage>.';
const PURGE_AFTER_DAMAGE =
    'This Unit deals <unit-damage>100% damage</unit-damage> and <unit-skill>purges 1 buff</unit-skill> from the enemy.';
const SELF_CLEANSE_BEFORE_DAMAGE =
    'This Unit <unit-skill>cleanses 1 debuff</unit-skill> and deals <unit-damage>100% damage</unit-damage>.';
const SUPPORT_CLEANSE = 'This Unit <unit-skill>cleanses 1 debuff</unit-skill>.';
const TURN_CLEANSE =
    'Every turn this Unit <unit-skill>cleanses 1 debuff</unit-skill>, once per round.';
const REDUCE_ON_ATTACKED =
    'When directly damaged, this Unit <unit-skill>reduces the duration of all active</unit-skill> <unit-aid>debuffs</unit-aid> on itself by 1 turn.';
const GRANT_BUFF = 'This Unit grants <unit-skill>Defense Up II</unit-skill> for 2 turns.';
const INFLICT_DEBUFF = 'This Unit inflicts <unit-skill>Attack Down II</unit-skill> for 3 turns.';

const passiveKit = (text: string): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [] }, ...textKit('P', { passives: [text] }, 4).slots],
});

const unit = (
    id: string,
    kit: ShipSkills,
    speed: number,
    affinity?: AffinityName,
    extra: Partial<BoardUnit> = {}
): BoardUnit => ({ id, kit, position: 'M4', speed, attack: 1000, hp: 1e9, affinity, ...extra });

/** Runs the board, recording every event. `swallowAttempts` withholds the attempt events from
 *  every listener (the log-only check). */
const run = (
    placement: Placement,
    carrier: BoardUnit,
    opponents: BoardUnit[],
    swallowAttempts = false
) => {
    const { input, id } = boardInput(placement, carrier, [], opponents, 1);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const emit = bus.emit;
    bus.emit = (e) => {
        events.push(e);
        if (swallowAttempts && ATTEMPT_TYPES.has(e.type)) return;
        emit(e);
    };
    const result = runCombat({ ...input, bus });
    const of = <T extends CombatEvent['type']>(type: T) =>
        events.filter(
            (e): e is Extract<CombatEvent, { type: T }> =>
                e.type === type && 'casterId' in e && e.casterId === id(carrier)
        );
    return { result, events, id, of };
};

describe.each(PLACEMENTS)('cast-path purge attempts, purger on the %s side', (placement) => {
    describe.each([
        ['ahead of the damage', PURGE_BEFORE_DAMAGE],
        ['after the damage', PURGE_AFTER_DAMAGE],
    ])('purge written %s', (_, text) => {
        const purger = () => unit('purger', textKit('Purger', { active: text }), 1, 'thermal');
        const target = (affinity: AffinityName, buffed: boolean) =>
            unit(
                'target',
                buffed ? textKit('Granter', { active: GRANT_BUFF }) : NO_KIT,
                2,
                affinity
            );

        it('an unbuffed enemy: one nothing-to-remove row naming it', () => {
            const t = target('antimatter', false);
            const s = run(placement, purger(), [t]);
            expect(s.of('purge-performed')).toEqual([]);
            expect(s.of('purge-attempt-log')).toEqual([
                expect.objectContaining({ reason: 'nothing-to-remove', targetIds: [s.id(t)] }),
            ]);
        });

        it('a buffed enemy at an affinity disadvantage: one affinity row, nothing more', () => {
            const t = target('electric', true);
            const s = run(placement, purger(), [t]);
            expect(s.of('purge-performed')).toEqual([]);
            expect(s.of('purge-attempt-log')).toEqual([
                expect.objectContaining({ reason: 'affinity', targetIds: [s.id(t)] }),
            ]);
        });

        it('control: a buffed enemy at neutral affinity is purged, with no attempt row', () => {
            const s = run(placement, purger(), [target('antimatter', true)]);
            expect(s.of('purge-performed')).toHaveLength(1);
            expect(s.of('purge-attempt-log')).toEqual([]);
        });
    });
});

describe.each(PLACEMENTS)('cast-path cleanse attempts, cleanser on the %s side', (placement) => {
    const debuffer = () =>
        unit('debuffer', textKit('Seeder', { active: INFLICT_DEBUFF }), 500, undefined, {
            hacking: 1e6,
        });

    describe.each([
        ['self-cleanse ahead of the damage', SELF_CLEANSE_BEFORE_DAMAGE],
        ['support-pass cleanse', SUPPORT_CLEANSE],
    ])('%s', (_, text) => {
        const cleanser = () => unit('cleanser', textKit('Cleanser', { active: text }), 100);

        it('nothing to cleanse: one attempt row naming the recipient', () => {
            const c = cleanser();
            const s = run(placement, c, [unit('idle', NO_KIT, 1)]);
            expect(s.of('cleanse-performed')).toEqual([]);
            expect(s.of('cleanse-attempt-log')).toEqual([
                expect.objectContaining({ targetIds: [s.id(c)] }),
            ]);
            expect(s.of('cleanse-attempt-log')[0].mode).toBeUndefined();
        });

        it('control: a debuff to cleanse logs the cleanse and no attempt row', () => {
            const s = run(placement, cleanser(), [debuffer()]);
            expect(s.of('cleanse-performed')).toHaveLength(1);
            expect(s.of('cleanse-attempt-log')).toEqual([]);
        });
    });

    it('the self-cleanse ahead of the damage logs its attempt before the hit', () => {
        const c = unit('cleanser', textKit('C', { active: SELF_CLEANSE_BEFORE_DAMAGE }), 100);
        const s = run(placement, c, [unit('idle', NO_KIT, 1)]);
        const attempt = s.events.findIndex((e) => e.type === 'cleanse-attempt-log');
        const hit = s.events.findIndex((e) => e.type === 'attacked' && e.attackerId === s.id(c));
        expect(attempt).toBeGreaterThanOrEqual(0);
        expect(attempt).toBeLessThan(hit);
    });
});

describe.each(PLACEMENTS)('reactive cleanse attempts, cleanser on the %s side', (placement) => {
    it('remove mode, nothing to cleanse: one attempt row, stamped reactive', () => {
        const c = unit('cleanser', passiveKit(TURN_CLEANSE), 100);
        const s = run(placement, c, [unit('idle', NO_KIT, 1)]);
        expect(s.of('reactive-cleanse-performed')).toEqual([]);
        expect(s.of('cleanse-attempt-log')).toEqual([
            expect.objectContaining({ targetIds: [s.id(c)], reactive: true }),
        ]);
    });

    it('remove mode control: a debuff to cleanse logs the cleanse and no attempt row', () => {
        const c = unit('cleanser', passiveKit(TURN_CLEANSE), 100);
        const seeder = unit('seeder', textKit('S', { active: INFLICT_DEBUFF }), 500, undefined, {
            hacking: 1e6,
        });
        const s = run(placement, c, [seeder]);
        expect(s.of('reactive-cleanse-performed')).toHaveLength(1);
        expect(s.of('cleanse-attempt-log')).toEqual([]);
    });

    it('reduce-duration mode, nothing to shrink: one attempt row carrying the mode', () => {
        const c = unit('cleanser', passiveKit(REDUCE_ON_ATTACKED), 1);
        const s = run(placement, c, [unit('hitter', hitKit(), 200)]);
        expect(s.of('reactive-cleanse-performed')).toEqual([]);
        expect(s.of('cleanse-attempt-log')).toEqual([
            expect.objectContaining({
                targetIds: [s.id(c)],
                mode: 'reduce-duration',
                durationTurns: 1,
            }),
        ]);
    });

    it('reduce-duration control: a debuff to shrink logs the cut and no attempt row', () => {
        const c = unit('cleanser', passiveKit(REDUCE_ON_ATTACKED), 1);
        const seeder = unit('seeder', textKit('S', { active: INFLICT_DEBUFF }), 500, undefined, {
            hacking: 1e6,
        });
        const s = run(placement, c, [seeder, unit('hitter', hitKit(), 200)]);
        expect(s.of('reactive-cleanse-performed')).toHaveLength(1);
        expect(s.of('cleanse-attempt-log')).toEqual([]);
    });
});

describe.each(PLACEMENTS)('the attempt rows are log-only, carrier on the %s side', (placement) => {
    /** Healing-ledger cleanse credits across the whole fight. */
    const cleanseCredits = (result: ReturnType<typeof runCombat>): number =>
        (result.healing?.rounds ?? []).reduce(
            (sum, rd) =>
                sum + [...rd.perActor.values()].reduce((s, a) => s + (a.cleanseCount ?? 0), 0),
            0
        );

    it('a zero cleanse wakes no on-enemy-cleansed / on-own-cleanse reaction and books nothing', () => {
        // Cleanser with Cultivator's "When this Unit cleanses a debuff, it also repairs that ally"
        // (on-own-cleanse); Pestilence opposite with "When an enemy cleanses a debuff" (on-enemy-cleansed).
        const cultivator = realKit('Cultivator').slots.filter((sl) => sl.slot === 'passive');
        const c = unit(
            'cleanser',
            {
                slots: [...textKit('C', { active: SUPPORT_CLEANSE }).slots, ...cultivator],
            },
            100
        );
        const pestilence = unit(
            'pestilence',
            {
                slots: [
                    { slot: 'active', abilities: [] },
                    ...realKit('Pestilence').slots.filter((sl) => sl.slot === 'passive'),
                ],
            },
            1,
            undefined,
            { hacking: 1e6 }
        );
        const shown = run(placement, c, [pestilence]);
        const withheld = run(placement, c, [pestilence], true);
        expect(shown.of('cleanse-attempt-log').length).toBeGreaterThan(0);
        expect(shown.events.filter((e) => e.type === 'dot-applied')).toEqual([]);
        expect(shown.events.filter((e) => e.type === 'reactive-heal-performed')).toEqual([]);
        expect(cleanseCredits(shown.result)).toBe(0);
        expect(JSON.stringify(withheld.result.rounds)).toBe(JSON.stringify(shown.result.rounds));
        expect(JSON.stringify(withheld.result.healing)).toBe(JSON.stringify(shown.result.healing));
    });

    it('a zero purge wakes no on-enemy-purged / on-ally-purged reaction', () => {
        // Sefuba's "When this Unit purges a buff from an enemy, it repairs …" rides the purger
        // (on-enemy-purged); "When a buff is purged from an ally, this Unit repairs that ally" rides
        // the victim's side (on-ally-purged).
        const sefuba = realKit('Sefuba').slots.filter((sl) => sl.slot === 'passive');
        const p = unit(
            'purger',
            {
                slots: [...textKit('P', { active: PURGE_AFTER_DAMAGE }).slots, ...sefuba],
            },
            1,
            'thermal'
        );
        const guardian = unit(
            'guardian',
            passiveKit(
                "When a <unit-aid>buff</unit-aid> is <unit-skill>purged</unit-skill> from an ally, this Unit <unit-damage>repairs that ally for 5%</unit-damage> of this Unit's max HP."
            ),
            2,
            'electric'
        );
        for (const opponents of [
            [guardian],
            [unit('target', textKit('G', { active: GRANT_BUFF }), 3, 'electric'), guardian],
        ]) {
            const shown = run(placement, p, opponents);
            const withheld = run(placement, p, opponents, true);
            expect(shown.of('purge-attempt-log').length).toBeGreaterThan(0);
            expect(shown.events.filter((e) => e.type === 'purge-performed')).toEqual([]);
            expect(shown.events.filter((e) => e.type === 'reactive-heal-performed')).toEqual([]);
            expect(JSON.stringify(withheld.result.rounds)).toBe(
                JSON.stringify(shown.result.rounds)
            );
        }
    });
});
