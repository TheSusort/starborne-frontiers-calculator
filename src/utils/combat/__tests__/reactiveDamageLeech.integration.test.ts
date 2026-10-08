/**
 * "% of damage dealt" repairs (the Leech set, Magnolia-style passives) pay on EVERY damage the
 * wearer deals: its own skill hit, its counter-attack, and an implant proc (R144). The repair is a
 * full repair, so it can crit at the wearer's crit rate and crit power (R145).
 *
 * Driven through the real placement path (`simulateBattle` -> `buildEquipmentAbilities`) with the
 * subject as the player focus, as a non-first player slot, and on the enemy side. Stalwart is the
 * real parsed kit (refit 4); Insidiousness is the real legendary implant with its proc roll
 * scripted to pass.
 *
 * Instrument: the wearer's `attack` rows (its own hit plus every counter/proc nested under it) and
 * its `heal` rows onto itself, read from the combat log. The expected repair is 15% of EACH damage
 * the wearer dealt, so a damage channel that skips the leech leaves the heal total short.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { simulateBattle, type BattlePlacement } from '../../calculators/battleSimulator';
import { setupKeyedRng, setKeyedRng } from '../../calculators/rateAccumulator';
import { flattenCombatLog } from '../log/__testutils__/flattenCombatLog';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data)'
        );
    }
});
beforeEach(() => setupKeyedRng(7));
afterEach(() => setKeyedRng(null));

const PIECES: Record<string, { setBonus: string; rarity: string }> = {
    'leech-a': { setBonus: 'LEECH', rarity: 'legendary' },
    'leech-b': { setBonus: 'LEECH', rarity: 'legendary' },
    insid: { setBonus: 'INSIDIOUSNESS', rarity: 'legendary' },
    'last-wish': { setBonus: 'LAST_WISH', rarity: 'legendary' },
    bloodthirst: { setBonus: 'BLOODTHIRST', rarity: 'legendary' },
};
const getGearPiece = (id: string): GearPiece | undefined =>
    PIECES[id] ? ({ id, ...PIECES[id] } as unknown as GearPiece) : undefined;

const makeShip = (id: string, activeSkillText: string, over: Partial<Ship> = {}): Ship => ({
    id,
    name: id,
    rarity: 'legendary',
    faction: 'TERRAN_COMBINE',
    type: 'ATTACKER',
    baseStats: {
        hp: 0,
        attack: 0,
        defence: 0,
        hacking: 0,
        security: 0,
        crit: 0,
        critDamage: 0,
        speed: 100,
    },
    equipment: {},
    implants: {},
    refits: [],
    affinity: 'antimatter',
    activeSkillText,
    chargeSkillCharge: 0,
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
    ...over,
});

const placement = (
    ship: Ship,
    position: BattlePlacement['position'],
    stats: {
        attack: number;
        hp: number;
        speed: number;
        hacking?: number;
        crit?: number;
        critDamage?: number;
    }
): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: stats.attack,
        crit: stats.crit ?? 0,
        critDamage: stats.critDamage ?? 0,
        defensePenetration: 0,
        hacking: stats.hacking ?? 0,
        security: 0,
        defence: 0,
        hp: stats.hp,
        speed: stats.speed,
    },
});

type Where = 'focus' | 'team' | 'enemy';
const WHERES: Where[] = ['focus', 'team', 'enemy'];
const carrierIdOf = (where: Where) =>
    where === 'focus' ? 'attacker' : where === 'team' ? 'p:carrier:1' : 'e:carrier:0';

/** Runs `carrier` against a `foe`, with the carrier on the side `where` names. */
function run(where: Where, carrier: BattlePlacement, foe: BattlePlacement, rounds = 3) {
    const filler = placement(makeShip('filler', 'deals 0% damage'), 'M1', {
        attack: 0,
        hp: 1_000_000,
        speed: 1,
    });
    const input =
        where === 'focus'
            ? { playerTeam: [carrier], enemyTeam: [foe], rounds }
            : where === 'team'
              ? { playerTeam: [filler, carrier], enemyTeam: [foe], rounds }
              : { playerTeam: [foe], enemyTeam: [carrier], rounds };
    return simulateBattle(input, getGearPiece);
}

/** Damage the carrier dealt per `attack` row (own hit and every nested counter/proc), and the gross
 *  repairs it landed on itself. */
function ledger(result: ReturnType<typeof simulateBattle>, carrierId: string) {
    const entries = flattenCombatLog(result);
    const dealt = entries
        .filter((e) => e.kind === 'attack' && e.actorId === carrierId)
        .flatMap((e) => e.targets.map((t) => Math.round(t.amount ?? 0)));
    const repairs = entries
        .filter((e) => e.kind === 'heal' && e.actorId === carrierId)
        .flatMap((e) => e.targets)
        .filter((t) => t.targetId === carrierId)
        .map((t) => Math.round((t.amount ?? 0) + (t.overheal ?? 0)));
    return { dealt, repairs };
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('R144: the Leech set pays on counter-attack damage', () => {
    const stalwart = (withLeech: boolean): Ship => {
        const ship = buildTraceShip('Stalwart', { refitLevel: 4 })!;
        return {
            ...ship,
            id: 'carrier',
            equipment: withLeech ? { weapon: 'leech-a', hull: 'leech-b' } : {},
        };
    };
    const foe = () =>
        placement(
            makeShip('foe', 'This Unit deals <unit-damage>100% damage</unit-damage>.'),
            'M4',
            {
                attack: 1_000,
                hp: 1_000_000_000,
                speed: 500,
            }
        );
    const carrierP = (withLeech: boolean) =>
        placement(stalwart(withLeech), 'M4', { attack: 1_000, hp: 1_000_000, speed: 1 });

    for (const where of WHERES) {
        describe(`Stalwart as ${where}`, () => {
            it('every counter is leeched: repairs total 15% of everything Stalwart dealt', () => {
                const { dealt, repairs } = ledger(
                    run(where, carrierP(true), foe()),
                    carrierIdOf(where)
                );
                // The board really counters: more damage rows than his own one hit per round.
                expect(dealt.length).toBeGreaterThan(3);
                expect(repairs).toHaveLength(dealt.length);
                for (const d of dealt) expect(repairs).toContain(Math.round(d * 0.15));
                expect(sum(repairs)).toBeGreaterThanOrEqual(Math.round(sum(dealt) * 0.15) - 3);
            });

            it('control: without the Leech set nothing repairs', () => {
                const { dealt, repairs } = ledger(
                    run(where, carrierP(false), foe()),
                    carrierIdOf(where)
                );
                expect(dealt.length).toBeGreaterThan(3);
                expect(repairs).toEqual([]);
            });
        });
    }
});

describe('R144: the Leech set pays on an implant proc', () => {
    const carrierShip = () =>
        makeShip(
            'carrier',
            'This Unit deals <unit-damage>100% damage</unit-damage> and inflicts <unit-skill>Attack Down I</unit-skill> for 2 turns.',
            {
                equipment: { weapon: 'leech-a', hull: 'leech-b' },
                implants: { implant_major: 'insid' },
            }
        );
    const foe = () =>
        placement(makeShip('foe', 'This Unit deals <unit-damage>0% damage</unit-damage>.'), 'M4', {
            attack: 0,
            hp: 1_000_000_000,
            speed: 1,
        });
    const passProcs = (carrierId: string) =>
        setKeyedRng((key) => (key === `${carrierId}:proc` ? 0 : 0));

    for (const where of WHERES) {
        it(`${where}: a 1,000 Insidiousness proc repairs 150 on top of the cast's 150`, () => {
            passProcs(carrierIdOf(where));
            const carrier = placement(carrierShip(), 'M4', {
                attack: 1_000,
                hp: 1_000_000,
                speed: 100,
                hacking: 200,
            });
            const { dealt, repairs } = ledger(run(where, carrier, foe(), 1), carrierIdOf(where));
            // The cast hits for 1,000 and the proc hits for 1,000.
            expect(dealt).toEqual([1_000, 1_000]);
            expect(repairs).toEqual([150, 150]);
        });
    }

    it('control: with the proc roll failed only the cast repairs', () => {
        setKeyedRng((key) => (key === 'attacker:proc' ? 0.99 : 0));
        const carrier = placement(carrierShip(), 'M4', {
            attack: 1_000,
            hp: 1_000_000,
            speed: 100,
            hacking: 200,
        });
        const { dealt, repairs } = ledger(run('focus', carrier, foe(), 1), 'attacker');
        expect(dealt).toEqual([1_000]);
        expect(repairs).toEqual([150]);
    });
});

describe('R145: an implant or Leech-set repair crits at the wearer crit rate and power', () => {
    const CRIT = 60;
    const CRIT_DAMAGE = 50;
    const MULT = 1 + CRIT_DAMAGE / 100;
    /** Every draw passes: each hit crits, the proc rolls land, the repair crits. */
    const allPass = () => setKeyedRng(() => 0);
    /** Fails every heal-crit draw (any owner) and passes everything else. */
    const healCritsFail = () => setKeyedRng((key) => (key.includes('heal-crit') ? 0.99 : 0));

    describe('the Leech set', () => {
        const carrier = (crit: number) =>
            placement(
                makeShip('carrier', 'This Unit deals <unit-damage>100% damage</unit-damage>.', {
                    equipment: { weapon: 'leech-a', hull: 'leech-b' },
                }),
                'M4',
                { attack: 1_000, hp: 1_000_000, speed: 100, crit, critDamage: CRIT_DAMAGE }
            );
        const dummy = () =>
            placement(makeShip('dummy', 'deals 0% damage'), 'M4', {
                attack: 0,
                hp: 1_000_000_000,
                speed: 1,
            });
        for (const where of WHERES) {
            it(`${where}: a crit hit of 1,500 repairs 225 and the repair crits to 338`, () => {
                allPass();
                const { dealt, repairs } = ledger(
                    run(where, carrier(CRIT), dummy(), 1),
                    carrierIdOf(where)
                );
                expect(dealt).toEqual([1_500]);
                expect(repairs).toEqual([Math.round(1_500 * 0.15 * MULT)]);
            });
            it(`${where}: control, the repair draw failing leaves the plain 225`, () => {
                healCritsFail();
                const { repairs } = ledger(
                    run(where, carrier(CRIT), dummy(), 1),
                    carrierIdOf(where)
                );
                expect(repairs).toEqual([225]);
            });
            it(`${where}: control, a wearer with no crit rate repairs the plain 150`, () => {
                allPass();
                const { dealt, repairs } = ledger(
                    run(where, carrier(0), dummy(), 1),
                    carrierIdOf(where)
                );
                expect(dealt).toEqual([1_000]);
                expect(repairs).toEqual([150]);
            });
        }
    });

    describe('Bloodthirst', () => {
        const carrier = (crit: number) =>
            placement(
                makeShip('carrier', 'This Unit deals <unit-damage>100% damage</unit-damage>.', {
                    implants: { implant_major: 'bloodthirst' },
                }),
                'M4',
                { attack: 1_000, hp: 1_000_000, speed: 100, crit, critDamage: CRIT_DAMAGE }
            );
        const dummy = () =>
            placement(makeShip('dummy', 'deals 0% damage'), 'M4', {
                attack: 0,
                hp: 1_000_000_000,
                speed: 1,
            });
        for (const where of WHERES) {
            it(`${where}: 20% of a 1,500 crit hit is 300 and the repair crits to 450`, () => {
                allPass();
                const { dealt, repairs } = ledger(
                    run(where, carrier(CRIT), dummy(), 1),
                    carrierIdOf(where)
                );
                expect(dealt).toEqual([1_500]);
                expect(repairs).toEqual([Math.round(1_500 * 0.2 * MULT)]);
            });
            it(`${where}: control, the repair draw failing leaves the plain 300`, () => {
                healCritsFail();
                const { repairs } = ledger(
                    run(where, carrier(CRIT), dummy(), 1),
                    carrierIdOf(where)
                );
                expect(repairs).toEqual([300]);
            });
        }
    });

    describe('Last Wish', () => {
        /** The wearer dies to a hit; its death repairs the buddy for 32% of the buddy's max HP. */
        const board = (where: Where, crit: number) => {
            const carrier = placement(
                makeShip('carrier', 'deals 0% damage', {
                    implants: { implant_major: 'last-wish' },
                }),
                'M4',
                { attack: 0, hp: 100, speed: 1, crit, critDamage: CRIT_DAMAGE }
            );
            const buddy = placement(makeShip('buddy', 'deals 0% damage'), 'M1', {
                attack: 0,
                hp: 1_000_000,
                speed: 1,
            });
            const killer = placement(
                makeShip('killer', 'This Unit deals <unit-damage>100% damage</unit-damage>.'),
                'M4',
                { attack: 1_000, hp: 1_000_000_000, speed: 500 }
            );
            const input =
                where === 'focus'
                    ? { playerTeam: [carrier, buddy], enemyTeam: [killer], rounds: 1 }
                    : where === 'team'
                      ? { playerTeam: [buddy, carrier], enemyTeam: [killer], rounds: 1 }
                      : { playerTeam: [killer], enemyTeam: [carrier, buddy], rounds: 1 };
            return simulateBattle(input, getGearPiece);
        };
        const repairsOnBuddy = (result: ReturnType<typeof simulateBattle>, where: Where) =>
            flattenCombatLog(result)
                .filter((e) => e.kind === 'heal' && e.actorId === carrierIdOf(where))
                .flatMap((e) => e.targets)
                .filter((t) => t.targetId !== carrierIdOf(where))
                .map((t) => Math.round((t.amount ?? 0) + (t.overheal ?? 0)));
        for (const where of WHERES) {
            it(`${where}: the death repair crits, 320,000 becomes 480,000`, () => {
                allPass();
                expect(repairsOnBuddy(board(where, CRIT), where)).toEqual([
                    Math.round(320_000 * MULT),
                ]);
            });
            it(`${where}: control, the repair draw failing leaves 320,000`, () => {
                healCritsFail();
                expect(repairsOnBuddy(board(where, CRIT), where)).toEqual([320_000]);
            });
            it(`${where}: control, a wearer with no crit rate repairs 320,000`, () => {
                allPass();
                expect(repairsOnBuddy(board(where, 0), where)).toEqual([320_000]);
            });
        }
    });
});
