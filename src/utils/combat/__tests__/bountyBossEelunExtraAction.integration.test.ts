/**
 * Eelun Naphula's end-of-round action for her allies and Beleth's charge refill (#519). Owner
 * rulings 2026-11-14:
 *   - Eelun's charged "gives one extra end of round action to all other allies": after every unit
 *     has acted in the round, each OTHER living ally takes one more turn (active or charged as
 *     normal) in the usual speed order. That turn builds charge like any turn. Eelun gets none; an
 *     ally already dead when she casts gets none.
 *   - Beleth's charged "adds 2 charges to its Charged Skill": the cast spends her charges and
 *     refills them to 2, so once she first fires it she casts the charged every turn after.
 * Every board runs with the kit on the player side and on the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { bossShip, npcShip } from '../../../constants/bountyBosses';
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
import { parsePattern, parseTarget } from '../../targetingParser';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(519));

const SIDES: Placement[] = ['player', 'enemy'];

/** Eelun with her real kit, charged on her first turn (3 charges) and on her active after. */
const eelun = (extra: Partial<BoardUnit> = {}): BoardUnit => ({
    id: 'eelun',
    kit: buildShipAbilities(bossShip('eelun', 32)!),
    position: 'M4',
    speed: 300,
    hp: 1e9,
    hacking: 1e6,
    chargeCount: 3,
    startCharged: true,
    pattern: parsePattern('Pattern-All'),
    target: parseTarget('all'),
    ...extra,
});

const sturdy = (id: string, position: BoardUnit['position'], speed: number): BoardUnit => ({
    id,
    kit: NO_KIT,
    position,
    speed,
    hp: 1e12,
});

const frail = (id: string, position: BoardUnit['position']): BoardUnit => ({
    id,
    kit: NO_KIT,
    position,
    speed: 1,
    hp: 1,
});

/** An opponent that hits every one of Eelun's side before she acts. */
const sweeper = (): BoardUnit => ({
    id: 'sweeper',
    kit: hitKit(100),
    position: 'M1',
    speed: 500,
    attack: 1000,
    pattern: parsePattern('Pattern-All'),
    target: parseTarget('all'),
});

/** An opponent that does nothing. */
const idle = (id = 'idle', position: BoardUnit['position'] = 'B3'): BoardUnit => ({
    id,
    kit: NO_KIT,
    position,
    speed: 2,
    hp: 1e12,
});

const run = (
    placement: Placement,
    carrier: BoardUnit,
    allies: BoardUnit[],
    opponents: BoardUnit[],
    rounds: number
) => {
    const { input, id } = boardInput(placement, carrier, allies, opponents, rounds);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const type of ['turn-started', 'skill-fired', 'ship-destroyed'] as const)
        bus.on(type, (e: CombatEvent) => events.push(e));
    runCombat({ ...input, bus });
    return { events, id };
};

type Ev<T extends CombatEvent['type']> = Extract<CombatEvent, { type: T }>;
const ofType = <T extends CombatEvent['type']>(events: CombatEvent[], type: T): Ev<T>[] =>
    events.filter((e): e is Ev<T> => e.type === type);

/** Actor ids in turn order for one round. */
const turnsIn = (events: CombatEvent[], round: number) =>
    ofType(events, 'turn-started')
        .filter((e) => e.round === round)
        .map((e) => e.actorId);

/** Slots one actor fired, in order, with their rounds. */
const castsOf = (events: CombatEvent[], actorId: string) =>
    ofType(events, 'skill-fired')
        .filter((e) => e.actorId === actorId)
        .map((e) => `${e.round}:${e.slot}`);

describe.each(SIDES)('end-of-round action for other allies, Eelun on the %s side', (placement) => {
    it('after every normal turn, each other living ally takes one more turn and Eelun does not', () => {
        const carrier = eelun();
        const fast = sturdy('fast', 'T2', 200);
        const slow = sturdy('slow', 'B2', 100);
        const opp = idle();
        const { events, id } = run(placement, carrier, [slow, fast], [opp], 2);
        const e = id(carrier);
        const o = id(opp);
        expect(castsOf(events, e)).toEqual(['1:charged', '2:active']);
        // Normal pool by speed, then the end-of-round pool by speed.
        expect(turnsIn(events, 1)).toEqual([e, fast.id, slow.id, o, fast.id, slow.id]);
        // Her round-2 active grants nothing.
        expect(turnsIn(events, 2)).toEqual([e, fast.id, slow.id, o]);
    });

    it('an ally already dead when she casts gets no turn', () => {
        const carrier = eelun();
        const keeper = sturdy('keeper', 'T2', 200);
        const doomed = frail('doomed', 'B2');
        const opp = sweeper();
        const { events, id } = run(placement, carrier, [keeper, doomed], [opp, idle()], 1);
        expect(ofType(events, 'ship-destroyed').map((d) => d.actorId)).toEqual([doomed.id]);
        const turns = turnsIn(events, 1);
        expect(turns.filter((t) => t === keeper.id)).toHaveLength(2);
        expect(turns.filter((t) => t === id(carrier))).toHaveLength(1);
        expect(turns).not.toContain(doomed.id);
    });

    it("an add's extra action advances its charge: Sitri fires her charged a round earlier", () => {
        const sitri = (): BoardUnit => ({
            id: 'sitri',
            kit: buildShipAbilities(npcShip('sitri', 124)!),
            position: 'T2',
            speed: 200,
            hp: 1e12,
            attack: 100,
            chargeCount: 3,
        });
        const firstCharged = (carrier: BoardUnit) => {
            const add = sitri();
            const { events } = run(placement, carrier, [add], [idle('target', 'M1')], 5);
            return castsOf(events, add.id).find((c) => c.endsWith(':charged'));
        };
        // Without the grant: three turns bank 3 charges, the 4th turn fires.
        expect(firstCharged(eelun({ startCharged: false, chargeCount: 99 }))).toBe('4:charged');
        // With it: round 1's two turns bank 2, round 2 banks the 3rd, round 3 fires.
        expect(firstCharged(eelun())).toBe('3:charged');
    });
});

describe.each(SIDES)('the extra-turn tripwire, Eelun on the %s side', (placement) => {
    /** Liberator on Eelun's opposing side ("player-side" when she is the enemy): faster than her,
     *  his opening hit kills an add, which grants him his own extra action. */
    const liberator = (): BoardUnit => ({
        id: 'liberator',
        kit: realKit('Liberator'),
        position: 'M1',
        speed: 500,
        attack: 1000,
        pattern: parsePattern('Pattern-All'),
        target: parseTarget('all'),
    });
    const adds = () => [
        sturdy('a1', 'T2', 200),
        sturdy('a2', 'T3', 190),
        sturdy('a3', 'B2', 180),
        sturdy('a4', 'B3', 170),
        frail('doomed', 'M2'),
    ];

    it("a 4-ally fan-out plus Liberator's extra action stays inside the cap", () => {
        const carrier = eelun();
        const lib = liberator();
        const { events, id } = run(placement, carrier, adds(), [lib, idle()], 1);
        expect(ofType(events, 'ship-destroyed').map((d) => d.actorId)).toEqual(['doomed']);
        const turns = turnsIn(events, 1);
        expect(turns.filter((t) => t === id(lib))).toHaveLength(2);
        for (const add of ['a1', 'a2', 'a3', 'a4'])
            expect(turns.filter((t) => t === add)).toHaveLength(2);
        expect(turns.filter((t) => t === id(carrier))).toHaveLength(1);
    });

    it('two fan-outs plus Liberator count three grants, not nine turns', () => {
        const carrier = eelun();
        const twin = eelun({ id: 'twin', position: 'T4', speed: 290 });
        const [a1, a2, a3] = adds();
        const lib = liberator();
        const { events, id } = run(
            placement,
            carrier,
            [twin, a1, a2, a3, frail('doomed', 'M2')],
            [lib, idle()],
            1
        );
        const turns = turnsIn(events, 1);
        expect(turns.filter((t) => t === id(lib))).toHaveLength(2);
        // Each Eelun gets the other's grant; each add gets both.
        expect(turns.filter((t) => t === id(carrier))).toHaveLength(2);
        expect(turns.filter((t) => t === twin.id)).toHaveLength(2);
        for (const add of [a1, a2, a3]) expect(turns.filter((t) => t === add.id)).toHaveLength(3);
    });
});

describe.each(SIDES)("Beleth's charge refill, Beleth on the %s side", (placement) => {
    const beleth = (): BoardUnit => ({
        id: 'beleth',
        kit: buildShipAbilities(npcShip('beleth', 124)!),
        position: 'M3',
        speed: 119,
        chargeCount: 2,
    });

    it.each([
        ['as the carrier', true],
        ['as an ally of the carrier', false],
    ])('%s she casts active twice, then her charged on every turn after', (_label, carries) => {
        const b = beleth();
        const { events, id } = carries
            ? run(placement, b, [], [idle()], 5)
            : run(placement, idle('carrier', 'T2'), [b], [idle()], 5);
        expect(castsOf(events, id(b))).toEqual([
            '1:active',
            '2:active',
            '3:charged',
            '4:charged',
            '5:charged',
        ]);
    });
});
