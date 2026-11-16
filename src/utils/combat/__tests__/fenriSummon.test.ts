/**
 * Abyssal Fenri's charged "… and summons two torpedoes in the top row" (bounty Lv33).
 *
 * The roster is fixed for the run: the torpedoes stand on the board from round 1, and the summon
 * re-arms every DEAD same-side torpedo in its own cell — full HP, statuses wiped, its combat-start
 * gains (Stealth for 10 turns) granted again. A living torpedo is left alone (owner ruling,
 * spec 2026-11-16). A torpedo can therefore die more than once in a run.
 *
 * The summoner fires its charged skill on its 3rd turn (2 charges), as Fenri does. Torpedo T4
 * self-destructs at the end of round 1, T2 at the end of round 2; round 3's charged re-arms both;
 * at the end of round 3 T4 blasts again while T2, standing behind a living T4, does not.
 *
 * Every engine case runs with the summoner's side on the enemy side and on the player side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent, type CombatEventType } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { assembleBattleResult, simulateBattle } from '../../calculators/battleSimulator';
import { buildTeam } from '../../simulator/buildTeam';
import { encounterBoard } from '../../simulator/bossBoard';
import { referenceShip } from '../../ship/referenceShip';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { checkInvariants } from '../audit/invariants';
import type { BoardState } from '../../../components/simulator/PlacementBoard';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { bossShip, npcShip, npcShipId } from '../../../constants/bountyBosses';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { CombatActor } from '../state';
import {
    boardInput,
    NO_KIT,
    realKit,
    hitKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { Ability, ShipSkills } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(7));

const SIDES: Placement[] = ['enemy', 'player'];

const TORPEDO_HP = 38160;
const TORPEDO_ID = npcShipId('torpedo', 135);

const torpedo = (id: string, position: BoardUnit['position'], over: Partial<BoardUnit> = {}) =>
    ({
        id,
        shipId: TORPEDO_ID,
        kit: buildShipAbilities(npcShip('torpedo', 135)!),
        position,
        speed: 93,
        hp: TORPEDO_HP,
        attack: 29082,
        ...over,
    }) satisfies BoardUnit;

const dummy = (id: string, position: BoardUnit['position'], over: Partial<BoardUnit> = {}) =>
    ({ id, kit: NO_KIT, position, speed: 50, hp: 1e9, ...over }) satisfies BoardUnit;

const SUMMON: Ability = {
    id: 'summon',
    type: 'summon',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'summon', addId: 'torpedo' },
};

/** A charged skill that only summons, fired on the 3rd turn like Fenri's. */
const chargedSummoner = (over: Partial<BoardUnit> = {}): BoardUnit =>
    dummy('summoner', 'B1', {
        speed: 130,
        chargeCount: 2,
        kit: {
            slots: [
                { slot: 'active', abilities: [] },
                { slot: 'charged', abilities: [SUMMON] },
            ],
        },
        ...over,
    });

/** Summons on every turn. */
const activeSummoner = (over: Partial<BoardUnit> = {}): BoardUnit =>
    dummy('summoner', 'B1', {
        speed: 130,
        kit: { slots: [{ slot: 'active', abilities: [SUMMON] }] },
        ...over,
    });

const RECORDED: CombatEventType[] = [
    'reactive-damage-performed',
    'ship-destroyed',
    'ship-revived',
    'charge-changed',
    'buff-applied',
    'turn-started',
    'heal-performed',
    'hp-changed',
    'attacked',
];

interface Run {
    events: CombatEvent[];
    hp: Record<string, number>;
    /** HP of each revived actor at the moment of its revive, in revive order. */
    hpAtRevive: { id: string; hp: number; position?: string }[];
    id: (u: BoardUnit) => string;
}

const run = (
    placement: Placement,
    ownSide: BoardUnit[],
    opponents: BoardUnit[],
    rounds: number
): Run => {
    const [carrier, ...allies] = ownSide;
    const { input, id } = boardInput(placement, carrier, allies, opponents, rounds);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const type of RECORDED) bus.on(type, (e) => events.push(e));
    let actors: CombatActor[] = [];
    const hpAtRevive: Run['hpAtRevive'] = [];
    bus.on('ship-revived', (e) => {
        const a = actors.find((x) => x.id === e.actorId);
        hpAtRevive.push({ id: e.actorId, hp: a?.currentHp ?? NaN, position: a?.position });
    });
    runCombat({ ...input, bus, __testTapActors: (all) => (actors = all) });
    const hp: Record<string, number> = {};
    for (const a of actors) hp[a.id] = a.currentHp;
    return { events, hp, hpAtRevive, id };
};

const of = <T extends CombatEventType>(r: Run, type: T) =>
    r.events.filter((e) => e.type === type) as Extract<CombatEvent, { type: T }>[];

const deathRounds = (r: Run, u: BoardUnit) =>
    of(r, 'ship-destroyed')
        .filter((e) => e.actorId === r.id(u))
        .map((e) => e.round);

const reviveRounds = (r: Run, u: BoardUnit) =>
    of(r, 'ship-revived')
        .filter((e) => e.actorId === r.id(u))
        .map((e) => e.round);

const blastRounds = (r: Run, u: BoardUnit) => [
    ...new Set(
        of(r, 'reactive-damage-performed')
            .filter((e) => e.sourceId === r.id(u))
            .map((e) => e.round)
    ),
];

const stealthGrants = (r: Run, u: BoardUnit) =>
    of(r, 'buff-applied')
        .filter((e) => e.actorId === r.id(u) && e.buffName === 'Stealth')
        .map((e) => ({ round: e.round, duration: e.duration }));

const turnRounds = (r: Run, u: BoardUnit) =>
    of(r, 'turn-started')
        .filter((e) => e.actorId === r.id(u))
        .map((e) => e.round);

// ── parse ───────────────────────────────────────────────────────────────────────────────────

describe('summon parse', () => {
    const summonsOf = (skills: ShipSkills) =>
        skills.slots.flatMap((s) => s.abilities.map((a) => ({ slot: s.slot, a })));

    it("Lv33 Fenri's charged summons torpedoes on cast", () => {
        const found = summonsOf(buildShipAbilities(bossShip('fenri', 33)!)).filter(
            ({ a }) => a.config.type === 'summon'
        );
        expect(found).toHaveLength(1);
        expect(found[0].slot).toBe('charged');
        expect(found[0].a).toMatchObject({
            type: 'summon',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'summon', addId: 'torpedo' },
        });
    });

    it('Lv32 Fenri summons nothing', () => {
        const found = summonsOf(buildShipAbilities(bossShip('fenri', 32)!)).filter(
            ({ a }) => a.config.type === 'summon'
        );
        expect(found).toEqual([]);
    });

    it('CORPUS GUARD: no ship in docs/ship-skills.csv says "summons"', () => {
        const hits = loadShipSkillRecords()
            .filter((row) =>
                [row.active, row.charge, ...row.passives].some((t) => /\bsummons?\b/i.test(t))
            )
            .map((row) => row.name);
        expect(hits).toEqual([]);
    });
});

// ── engine ──────────────────────────────────────────────────────────────────────────────────

describe.each(SIDES)('summoner on the %s side', (placement) => {
    const board = () => {
        const t4 = torpedo('torpedoT4', 'T4');
        const t2 = torpedo('torpedoT2', 'T2');
        // Opponents: a durable decoy (roster-first) and two in the top row.
        const decoy = dummy('decoy', 'B4');
        const front = dummy('front', 'T4');
        const back = dummy('back', 'T1');
        return { t4, t2, decoy, front, back, opponents: [decoy, front, back] };
    };

    it('the charged re-arms BOTH dead torpedoes in their own cells at full HP', () => {
        const b = board();
        const summoner = chargedSummoner();
        const r = run(placement, [b.t4, b.t2, summoner], b.opponents, 3);
        expect(deathRounds(r, b.t4)).toEqual([1, 3]);
        expect(deathRounds(r, b.t2)).toEqual([2]);
        expect(reviveRounds(r, b.t4)).toEqual([3]);
        expect(reviveRounds(r, b.t2)).toEqual([3]);
        expect(r.hpAtRevive).toEqual(
            expect.arrayContaining([
                { id: r.id(b.t4), hp: TORPEDO_HP, position: 'T4' },
                { id: r.id(b.t2), hp: TORPEDO_HP, position: 'T2' },
            ])
        );
        // T2 stands behind the living T4 at the end of round 3, so it survives at full HP.
        expect(r.hp[r.id(b.t2)]).toBe(TORPEDO_HP);
    });

    it('a summoner listed first on its side (the focus actor on the player side) re-arms too', () => {
        const b = board();
        const summoner = chargedSummoner();
        const r = run(placement, [summoner, b.t4, b.t2], b.opponents, 3);
        expect(reviveRounds(r, b.t4)).toEqual([3]);
        expect(reviveRounds(r, b.t2)).toEqual([3]);
        expect(of(r, 'ship-revived').every((e) => e.summonerId === r.id(summoner))).toBe(true);
    });

    it('the revive names its summoner', () => {
        const b = board();
        const summoner = chargedSummoner();
        const r = run(placement, [b.t4, b.t2, summoner], b.opponents, 3);
        expect(of(r, 'ship-revived').map((e) => e.summonerId)).toEqual([
            r.id(summoner),
            r.id(summoner),
        ]);
    });

    it('each re-armed torpedo gains Stealth for 10 turns again', () => {
        const b = board();
        const r = run(placement, [b.t4, b.t2, chargedSummoner()], b.opponents, 3);
        expect(stealthGrants(r, b.t4)).toEqual([
            { round: 1, duration: 10 },
            { round: 3, duration: 10 },
        ]);
        expect(stealthGrants(r, b.t2)).toEqual([
            { round: 1, duration: 10 },
            { round: 3, duration: 10 },
        ]);
    });

    it('a re-armed torpedo carries none of the statuses it died with', () => {
        // The summoner's active grants every ally Attack Up for 9 turns; T2 holds it when it dies
        // at the end of round 2. Round 3's charged grants nothing but re-arms T2.
        const attackUp: Ability = {
            id: 'team-attack-up',
            type: 'buff',
            target: 'all-allies',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'buff',
                buffName: 'Attack Up',
                parsedEffects: {},
                stacks: 1,
                isStackable: false,
                duration: 9,
            },
        };
        const summoner = chargedSummoner({
            kit: {
                slots: [
                    { slot: 'active', abilities: [attackUp] },
                    { slot: 'charged', abilities: [SUMMON] },
                ],
            },
        });
        const b = board();
        const bus = createEventBus();
        const snapshots: Extract<CombatEvent, { type: 'status-snapshot' }>[] = [];
        bus.on('status-snapshot', (e) => snapshots.push(e));
        const { input, id } = boardInput(placement, b.t4, [b.t2, summoner], b.opponents, 3);
        runCombat({ ...input, bus });
        const buffsOfT2 = (round: number) =>
            snapshots.find((e) => e.actorId === id(b.t2) && e.round === round)?.buffNames;
        expect(buffsOfT2(1)).toContain('Attack Up');
        expect(buffsOfT2(3)).toEqual(['Stealth']);
    });

    it('a living torpedo is left alone: only the dead one re-arms', () => {
        const b = board();
        // Summons every turn. Round 2: T4 died at the end of round 1, T2 is still alive.
        const r = run(placement, [b.t4, b.t2, activeSummoner()], b.opponents, 2);
        expect(reviveRounds(r, b.t4)).toEqual([2]);
        expect(reviveRounds(r, b.t2)).toEqual([]);
        expect(stealthGrants(r, b.t2)).toEqual([{ round: 1, duration: 10 }]);
    });

    it('nothing re-arms while every torpedo is alive', () => {
        const b = board();
        const r = run(placement, [b.t4, b.t2, activeSummoner()], b.opponents, 1);
        expect(of(r, 'ship-revived')).toEqual([]);
    });

    it('a re-armed torpedo blasts again at a later round end and dies again', () => {
        const b = board();
        const r = run(placement, [b.t4, b.t2, chargedSummoner()], b.opponents, 3);
        expect(blastRounds(r, b.t4)).toEqual([1, 3]);
        expect(deathRounds(r, b.t4)).toEqual([1, 3]);
        expect(r.hp[r.id(b.t4)]).toBe(0);
    });

    it('ASSUMPTION (re-arm turn timing): a re-armed torpedo takes turns from the round after its summon', () => {
        const b = board();
        const r = run(placement, [b.t4, b.t2, chargedSummoner()], b.opponents, 4);
        // T2: alive round 1-2 (dies at the end of round 2), re-armed in round 3 by a faster
        // summoner while its own slot of that round is still to come, acts again in round 4.
        expect(turnRounds(r, b.t2)).toEqual([1, 2, 4]);
    });

    // A pin, not a discriminator: the revived torpedo is already past its slot in this round, so
    // this passes with or without the emptied turn pool.
    it('ASSUMPTION (re-arm turn timing): a torpedo FASTER than its summoner also first acts in the round after the summon (pin)', () => {
        const fastT2 = torpedo('torpedoT2', 'T2', { speed: 200 });
        const b = board();
        const r = run(placement, [b.t4, fastT2, chargedSummoner()], b.opponents, 4);
        expect(reviveRounds(r, fastT2)).toEqual([3]);
        expect(turnRounds(r, fastT2)).toEqual([1, 2, 4]);
    });

    it('each torpedo death charges a Liberator, re-armed deaths included', () => {
        const b = board();
        const liberator = dummy('liberator', 'B1', { kit: realKit('Liberator'), chargeCount: 9 });
        const r = run(
            placement,
            [b.t4, b.t2, chargedSummoner()],
            [b.decoy, liberator, b.front, b.back],
            3
        );
        const grants = of(r, 'charge-changed').filter(
            (e) =>
                e.actorId === r.id(liberator) &&
                e.reason === 'manip' &&
                e.newCharge === e.oldCharge + 1
        );
        expect(deathRounds(r, b.t4)).toEqual([1, 3]);
        expect(grants.map((e) => e.round)).toEqual([1, 2, 3]);
    });

    it('a revive is not a repair: no heal or HP-change event names the torpedo', () => {
        const b = board();
        const r = run(placement, [b.t4, b.t2, chargedSummoner()], b.opponents, 3);
        expect(reviveRounds(r, b.t4)).toEqual([3]);
        expect(of(r, 'heal-performed').filter((e) => e.targets.includes(r.id(b.t4)))).toEqual([]);
        expect(
            of(r, 'hp-changed').filter((e) => e.targetId === r.id(b.t4) && e.newPct > 0)
        ).toEqual([]);
    });

    it('a dead ally that is another bounty add stays dead', () => {
        const b = board();
        // In front of the summoner in the bottom row, where the bottom-row hitter aims.
        const frail = dummy('frail', 'B4', { hp: 10, shipId: npcShipId('capo', 124) });
        const hitter = dummy('decoy', 'B4', { speed: 300, attack: 1e6, kit: hitKit(100) });
        const r = run(
            placement,
            [b.t4, b.t2, frail, activeSummoner()],
            [hitter, b.front, b.back],
            2
        );
        expect(deathRounds(r, frail)).toEqual([1]);
        expect(reviveRounds(r, frail)).toEqual([]);
        expect(reviveRounds(r, b.t4)).toEqual([2]);
    });

    it('ASSUMPTION (destroyed-enemy counts): a re-armed torpedo no longer counts for Judge', () => {
        // "20% more direct damage for each destroyed enemy" reads the enemies dead NOW. Judge
        // (speed 50) acts after the summoner (130) and both torpedoes (93) every round, and hits
        // the summoner, the only unit in its row. Round 1: none dead; round 2: T4 dead; round 3:
        // T2 dead too, then the charged re-arms both before Judge's turn.
        const b = board();
        const judge = dummy('judge', 'B4', { kit: realKit('Judge'), attack: 10000 });
        const r = run(placement, [b.t4, b.t2, chargedSummoner()], [judge, b.front, b.back], 3);
        expect(reviveRounds(r, b.t2)).toEqual([3]);
        const hitIn = (round: number) =>
            r.events
                .filter(
                    (e): e is Extract<CombatEvent, { type: 'attacked' }> =>
                        e.type === 'attacked' && e.attackerId === r.id(judge) && e.round === round
                )
                .reduce((sum, e) => sum + (e.damage ?? 0), 0);
        expect(hitIn(1)).toBeGreaterThan(0);
        expect(hitIn(2)).toBeCloseTo(hitIn(1) * 1.2, 6);
        expect(hitIn(3)).toBeCloseTo(hitIn(1), 6);
    });

    it('a summon on the cast that ends the fight re-arms nothing', () => {
        const b = board();
        // The only opponent stands in the bottom row, out of the torpedoes' reach; the charged
        // cast kills it in round 3.
        const lone = dummy('decoy', 'B4', { hp: 1000 });
        const killer = chargedSummoner({
            attack: 1e6,
            kit: {
                slots: [
                    { slot: 'active', abilities: [] },
                    {
                        slot: 'charged',
                        abilities: [...hitKit(100).slots[0].abilities, SUMMON],
                    },
                ],
            },
        });
        const r = run(placement, [b.t4, b.t2, killer], [lone], 3);
        expect(deathRounds(r, lone)).toEqual([3]);
        expect(deathRounds(r, b.t4)).toEqual([1]);
        expect(of(r, 'ship-revived')).toEqual([]);
    });
});

// ── combat report ───────────────────────────────────────────────────────────────────────────

describe('battle report across a revive', () => {
    const roster = [
        { actorId: 'p1', side: 'player' as const, name: 'P', position: 'B4' as const, maxHp: 1 },
        {
            actorId: 'summoner',
            side: 'enemy' as const,
            name: 'Summoner',
            position: 'B1' as const,
            maxHp: 1,
        },
        {
            actorId: 't4',
            side: 'enemy' as const,
            name: 'Torpedo',
            position: 'T4' as const,
            maxHp: 1,
        },
    ];
    const destroyed = (actorId: string, round: number): CombatEvent => ({
        type: 'ship-destroyed',
        actorId,
        round,
    });
    const revived = (actorId: string, round: number): CombatEvent => ({
        type: 'ship-revived',
        actorId,
        round,
        summonerId: 'summoner',
    });
    const assemble = (events: CombatEvent[], numRounds: number) =>
        assembleBattleResult({ events, perRoundPerTarget: {}, roster, numRounds });
    const t4Of = (res: ReturnType<typeof assemble>) =>
        res.rounds.map((rd) => rd.ships.find((s) => s.actorId === 't4')!);

    it('counts every death and reads liveness from the latest death or revive', () => {
        const res = assemble(
            [destroyed('t4', 1), revived('t4', 3), destroyed('t4', 3), revived('t4', 4)],
            4
        );
        expect(t4Of(res).map((s) => s.deaths)).toEqual([1, 1, 2, 2]);
        expect(t4Of(res).map((s) => s.alive)).toEqual([false, false, false, true]);
    });

    it('a side whose last living ship is a re-armed torpedo is not wiped', () => {
        const res = assemble([destroyed('t4', 1), revived('t4', 2), destroyed('summoner', 2)], 3);
        expect(res.outcome).toEqual({ winner: 'enemy', lastRound: 3 });
        expect(res.rounds).toHaveLength(3);
    });

    it('control: the same side IS wiped once that torpedo dies again', () => {
        const res = assemble(
            [destroyed('t4', 1), revived('t4', 2), destroyed('summoner', 2), destroyed('t4', 2)],
            3
        );
        expect(res.outcome).toEqual({ winner: 'player', lastRound: 2 });
    });
});

// ── the real encounter, end to end ──────────────────────────────────────────────────────────

describe('Abyssal Fenri encounter (simulateBattle)', () => {
    const deps = { getGearPiece: () => undefined, getEngineeringStatsForShipType: () => undefined };
    /** Durable ships that barely scratch Fenri, all out of the torpedoes' top row. */
    const players = (): BoardState => {
        const board: BoardState = {};
        for (const [pos, name] of [
            ['M4', 'Butcher'],
            ['B4', 'Nuqtu'],
        ] as const) {
            const template = buildTraceShip(name);
            if (!template) throw new Error(`no reference data for ${name}`);
            board[pos] = {
                ship: referenceShip(template, 'r0', null),
                overrides: { hp: 1e12, attack: 1 },
            };
        }
        return board;
    };
    const fight = () => {
        setupKeyedRng(1);
        return simulateBattle({
            playerTeam: buildTeam(players(), deps),
            enemyTeam: buildTeam(encounterBoard('fenri', 33)!, deps),
            rounds: 4,
        });
    };
    const torpedoAt = (res: ReturnType<typeof fight>, pos: string) =>
        res.roster.find((r) => r.position === pos && r.actorId.includes(TORPEDO_ID))!.actorId;

    it("ASSUMPTION (re-arm turn timing): Fenri's charged re-arms both torpedoes; the report counts each death and T2 first acts in round 4", () => {
        const res = fight();
        const t4 = torpedoAt(res, 'T4');
        const t2 = torpedoAt(res, 'T2');
        const ship = (round: number, id: string) =>
            res.rounds.find((r) => r.round === round)!.ships.find((s) => s.actorId === id)!;
        expect([1, 2, 3, 4].map((rd) => ship(rd, t4).deaths)).toEqual([1, 1, 2, 2]);
        expect([1, 2, 3, 4].map((rd) => ship(rd, t4).alive)).toEqual([false, false, false, false]);
        // T2 is front-most again once T4 died at the end of round 3.
        expect([1, 2, 3, 4].map((rd) => ship(rd, t2).deaths)).toEqual([0, 1, 1, 2]);
        expect([1, 2, 3, 4].map((rd) => ship(rd, t2).alive)).toEqual([true, false, true, false]);
        // T2, re-armed in round 3, takes its turn in round 4.
        expect(res.rounds.find((r) => r.round === 3)!.turnOrder).not.toContain(t2);
        expect(res.rounds.find((r) => r.round === 4)!.turnOrder).toContain(t2);
    });

    it('the combat log shows the summon and the invariants hold across the revive', () => {
        const res = fight();
        const revived = res.combatLog
            .flatMap((r) => r.turns.map((t) => ({ round: r.round, entries: t.entries })))
            .flatMap(({ round, entries }) =>
                entries.filter((e) => e.kind === 'revived').map((e) => ({ round, e }))
            );
        expect(
            revived.map(({ round, e }) => [round, e.targets[0].targetId].join(' ')).sort()
        ).toEqual([`3 ${torpedoAt(res, 'T4')}`, `3 ${torpedoAt(res, 'T2')}`].sort());
        expect(revived.every(({ e }) => e.actorId.includes('boss:fenri:33'))).toBe(true);
        expect(checkInvariants(res).map((v) => `${v.invariant} r${v.round} ${v.detail}`)).toEqual(
            []
        );
    });
});
