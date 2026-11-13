/**
 * Replays of the owner's in-game bounty fights (#519): Judge (T4), Graphite (M3), Grif (B1) and
 * Thresh (B4) at their planner final stats, against Fenri Lv32, against Mamma Maglienza Lv32
 * with her three Capos, and against General Colosso Lv32 with his three Major Grands (that team,
 * Los alone, and Graphite with Asphyxiator). Each pin is a hit read off the in-game combat log.
 * The Fenri block checks the harness itself (Fenri's stats were fitted in an earlier fight); the
 * other blocks check the encounter's fitted stats and targeting.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildTeam } from '../buildTeam';
import { encounterBoard } from '../bossBoard';
import { simulateBattle, type BattlePlacement } from '../../calculators/battleSimulator';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { bossShip } from '../../../constants/bountyBosses';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { BoardState } from '../../../components/simulator/PlacementBoard';
import type { CombatLogEntry } from '../../combat/log/types';
import type { GearPiece } from '../../../types/gear';
import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});

const deps = { getGearPiece: () => undefined, getEngineeringStatsForShipType: () => undefined };

interface FleetShip {
    /** The ship's cell in the owner's four-ship team; other fights place it themselves. */
    position: Position;
    affinity: Ship['affinity'];
    type: Ship['type'];
    refits: number;
    stats: NonNullable<BattlePlacement['statOverrides']>;
}

// The owner's planner final stats (gear, implants, refits, engineering; level 60).
const FLEET: Record<string, FleetShip> = {
    Judge: {
        position: 'T4',
        affinity: 'electric',
        type: 'ATTACKER',
        refits: 6,
        stats: {
            hp: 19486,
            attack: 25977,
            defence: 3779,
            hacking: 102,
            security: 22,
            crit: 109,
            critDamage: 240,
            speed: 125.96,
            defensePenetration: 27,
        },
    },
    Graphite: {
        position: 'M3',
        affinity: 'thermal',
        type: 'SUPPORTER',
        refits: 6,
        stats: {
            hp: 40340,
            attack: 10430,
            defence: 4054,
            hacking: 111.75,
            security: 116.7,
            crit: 29,
            critDamage: 80,
            speed: 239.5,
        },
    },
    Grif: {
        position: 'B1',
        affinity: 'chemical',
        type: 'SUPPORTER',
        refits: 5,
        stats: {
            hp: 43598,
            attack: 6276,
            defence: 6673,
            hacking: 110.4,
            security: 104.5,
            crit: 23,
            critDamage: 68,
            speed: 331.5,
        },
    },
    Thresh: {
        position: 'B4',
        affinity: 'antimatter',
        type: 'ATTACKER',
        refits: 6,
        stats: {
            hp: 22246,
            attack: 21693,
            defence: 4106,
            hacking: 142,
            security: 18,
            crit: 103,
            critDamage: 274,
            speed: 110.24,
            defensePenetration: 7,
        },
    },
    Los: {
        position: 'M4',
        affinity: 'electric',
        type: 'ATTACKER',
        refits: 6,
        stats: {
            hp: 19248.7,
            attack: 22100.2,
            defence: 5144.1,
            hacking: 166,
            security: 36,
            crit: 103,
            critDamage: 212,
            speed: 118.88,
            defensePenetration: 0,
        },
    },
    Asphyxiator: {
        position: 'M3',
        affinity: 'thermal',
        type: 'DEBUFFER',
        refits: 3,
        stats: {
            hp: 20861.7,
            attack: 14230.7,
            defence: 2786,
            hacking: 300,
            security: 39,
            crit: 97,
            critDamage: 128,
            speed: 164.95,
        },
    },
};

const OWNER_TEAM = ['Judge', 'Graphite', 'Grif', 'Thresh'] as const;

// Thresh carries an epic Intrusion implant; Graphite wears the Boost set (her Overclock lasts 3
// turns in game) and, in one Colosso fight, a legendary Resonating Fury implant. The pieces carry
// no stats: each ship's planner stats are its overrides.
const INTRUSION_ID = 'replay-intrusion';
const BOOST_SLOTS = ['weapon', 'hull', 'generator', 'sensor'] as const;
const boostId = (slot: string) => `replay-boost-${slot}`;
const RESONATING_FURY_ID = 'replay-resonating-fury';
const getGearPiece = (id: string) =>
    id === INTRUSION_ID
        ? ({ id, setBonus: 'INTRUSION', rarity: 'epic' } as unknown as GearPiece)
        : id === RESONATING_FURY_ID
          ? ({ id, setBonus: 'RESONATING_FURY', rarity: 'legendary' } as unknown as GearPiece)
          : id.startsWith('replay-boost-')
            ? ({
                  id,
                  slot: id.slice('replay-boost-'.length),
                  level: 16,
                  stars: 6,
                  rarity: 'legendary',
                  mainStat: null,
                  subStats: [],
                  setBonus: 'BOOST',
              } as GearPiece)
            : undefined;

const fleetShip = (name: string): Ship => {
    const entry = FLEET[name];
    const ship = buildTraceShip(name)!;
    // A ship missing from the snapshot comes back as a default antimatter attacker.
    expect([ship.affinity, ship.type]).toEqual([entry.affinity, entry.type]);
    return {
        ...ship,
        id: `replay:${name}`,
        refits: Array.from({ length: entry.refits }, (_, i) => ({ id: `refit-${i}`, stats: [] })),
        implants: name === 'Thresh' ? ({ ultimate: INTRUSION_ID } as Ship['implants']) : {},
        equipment:
            name === 'Graphite'
                ? Object.fromEntries(BOOST_SLOTS.map((slot) => [slot, boostId(slot)]))
                : ship.equipment,
    };
};

/** The named ships on the given cells at their planner stats; `extra` is spread over a ship's
 *  planner stats. */
const teamOf = (
    layout: Partial<Record<string, Position>>,
    extra: Partial<Record<string, BattlePlacement['statOverrides']>> = {}
): BattlePlacement[] => {
    const board: BoardState = {};
    for (const [name, position] of Object.entries(layout))
        board[position!] = { ship: fleetShip(name) };
    return buildTeam(board, deps).map((p) => ({
        ...p,
        statOverrides: { ...p.statOverrides, ...FLEET[p.ship.name].stats, ...extra[p.ship.name] },
    }));
};

/** The owner's four-ship team on its own cells. */
const playerTeam = (extra: Partial<Record<string, BattlePlacement['statOverrides']>> = {}) =>
    teamOf(Object.fromEntries(OWNER_TEAM.map((name) => [name, FLEET[name].position])), extra);

interface LoggedEntry {
    round: number;
    entry: CombatLogEntry;
}

/** Every log entry, nested reactions included, in log order. */
const entriesOf = (result: ReturnType<typeof simulateBattle>): LoggedEntry[] => {
    const out: LoggedEntry[] = [];
    const walk = (round: number, entry: CombatLogEntry) => {
        out.push({ round, entry });
        for (const reaction of entry.reactions) walk(round, reaction);
    };
    for (const round of result.combatLog) {
        for (const e of round.startOfRound) walk(round.round, e);
        for (const turn of round.turns) for (const e of turn.entries) walk(round.round, e);
        for (const e of round.endOfRound) walk(round.round, e);
    }
    return out;
};

const idOf = (result: ReturnType<typeof simulateBattle>, name: string) =>
    result.roster.find((r) => r.name === name)!.actorId;

const nameOf = (result: ReturnType<typeof simulateBattle>, actorId: string) =>
    result.roster.find((r) => r.actorId === actorId)!.name;

/** `actual` within `tolerance` (a fraction) of the in-game `measured`. */
const expectMeasured = (actual: number | undefined, measured: number, tolerance: number) => {
    expect(actual).toBeDefined();
    expect(Math.abs(actual! / measured - 1)).toBeLessThan(tolerance);
};

const TIGHT = 0.001;

describe('harness check: the owner team against Fenri Lv32', () => {
    setupKeyedRng(1);
    const result = simulateBattle(
        {
            playerTeam: playerTeam(),
            enemyTeam: buildTeam({ M1: { ship: bossShip('fenri', 32)! } }, deps),
            rounds: 3,
        },
        getGearPiece
    );
    const entries = entriesOf(result);
    const fenri = idOf(result, 'Fenri Khaliriz');
    const hitOn = (attacker: string, target: string, round: number) =>
        entries
            .filter(
                ({ round: r, entry }) =>
                    r === round && entry.kind === 'attack' && entry.actorId === attacker
            )
            .flatMap(({ entry }) => entry.targets)
            .find((t) => t.targetId === target);

    it("Judge's opening active crits Fenri for 128,006", () => {
        const hit = hitOn(idOf(result, 'Judge'), fenri, 1);
        expect(hit?.didCrit).toBe(true);
        expectMeasured(hit?.amount, 128_006, TIGHT);
    });

    // Intrusion reads the Concentrate Fire Judge has just put on Fenri.
    it("Thresh's opening active crits Fenri for 180,302", () => {
        const hit = hitOn(idOf(result, 'Thresh'), fenri, 1);
        expect(hit?.didCrit).toBe(true);
        expectMeasured(hit?.amount, 180_302, TIGHT);
    });

    it('Fenri hits Graphite for 18,774 into its shield plus 28,301', () => {
        const graphite = idOf(result, 'Graphite');
        const shield = entries.find(
            ({ round, entry }) =>
                round === 1 && entry.kind === 'shield' && entry.actorId === graphite
        );
        expectMeasured(
            shield?.entry.targets.find((t) => t.targetId === graphite)?.amount,
            18_774,
            TIGHT
        );
        const hit = hitOn(fenri, graphite, 1);
        expect(hit?.shieldWasHit).toBe(true);
        expectMeasured(hit?.amount, 18_774 + 28_301, TIGHT);
    });

    it("Judge's start-of-round hit on the wounded Fenri is 33,393", () => {
        const round2 = result.combatLog.find((r) => r.round === 2)!;
        const hit = round2.startOfRound
            .filter((e) => e.kind === 'attack' && e.actorId === idOf(result, 'Judge'))
            .flatMap((e) => e.targets)
            .find((t) => t.targetId === fenri);
        expectMeasured(hit?.amount, 33_393, TIGHT);
    });
});

describe('replay: the owner team against Mamma Maglienza Lv32 and her Capos', () => {
    setupKeyedRng(1);
    const result = simulateBattle(
        {
            playerTeam: playerTeam(),
            enemyTeam: buildTeam(encounterBoard('maglienza', 32)!, deps),
            rounds: 7,
        },
        getGearPiece
    );
    const entries = entriesOf(result);
    const mamma = idOf(result, 'Mamma Maglienza');
    const attacksBy = (predicate: (actorId: string) => boolean) =>
        entries.filter(({ entry }) => entry.kind === 'attack' && predicate(entry.actorId));
    const positionOf = (actorId: string) =>
        result.roster.find((r) => r.actorId === actorId)!.position;

    // Row B holds two ships, rows T and M one each.
    it("Mamma's first cast strikes row B: Grif and Thresh", () => {
        const first = attacksBy((id) => id === mamma)[0].entry;
        expect(first.targets.map((t) => nameOf(result, t.targetId)).sort()).toEqual([
            'Grif',
            'Thresh',
        ]);
    });

    // Rows T and M tie on one ship; the Capo's own row wins the tie.
    it("the M4 Capo's first cast strikes row M: Graphite", () => {
        const capo = result.roster.find(
            (r) => r.side === 'enemy' && r.name === 'Capo' && r.position === 'M4'
        )!.actorId;
        const first = attacksBy((id) => id === capo)[0].entry;
        expect(first.targets.map((t) => nameOf(result, t.targetId))).toEqual(['Graphite']);
    });

    it("Mamma's first cast crits Thresh for 16,004", () => {
        const first = attacksBy((id) => id === mamma)[0].entry;
        const hit = first.targets.find((t) => nameOf(result, t.targetId) === 'Thresh');
        expect(hit?.didCrit).toBe(true);
        expectMeasured(hit?.amount, 16_004, TIGHT);
    });

    it('each of her Inferno II stacks ticks for 6,587', () => {
        const thresh = idOf(result, 'Thresh');
        const tick = entries.find(
            ({ entry }) =>
                entry.kind === 'dot-ticked' &&
                entry.targets[0]?.targetId === thresh &&
                entry.note === 'inferno II ×2'
        );
        expectMeasured(tick?.entry.targets[0].amount, 2 * 6_587, TIGHT);
    });

    it('a Capo hits Graphite for 6,338 without a crit', () => {
        const hit = attacksBy((id) => id.includes('npc:capo'))
            .flatMap(({ entry }) => entry.targets)
            .find((t) => nameOf(result, t.targetId) === 'Graphite' && !t.didCrit);
        expectMeasured(hit?.amount, 6_338, TIGHT);
    });

    // The one logged hit this replay matches only to about half a percent.
    it("Thresh's crit on a Capo is 214,012", () => {
        const hit = attacksBy((id) => id === idOf(result, 'Thresh'))
            .flatMap(({ entry }) => entry.targets)
            .find((t) => t.targetId.includes('npc:capo') && t.didCrit);
        expectMeasured(hit?.amount, 214_012, 0.01);
    });

    it("Mamma's first cast hits Grif for 6,799 without a crit", () => {
        const first = attacksBy((id) => id === mamma)[0].entry;
        const hit = first.targets.find((t) => nameOf(result, t.targetId) === 'Grif');
        expect(hit?.didCrit).not.toBe(true);
        expectMeasured(hit?.amount, 6_799, TIGHT);
    });

    // Graphite's Boosted Overclock is still on Judge at the start of round 5, and his
    // destroyed-enemy bonus counts the two dead Capos (+40%).
    it("Judge's start-of-round hit in round 5 crits Mamma for 27,943", () => {
        const round5 = result.combatLog.find((r) => r.round === 5)!;
        const hit = round5.startOfRound
            .filter((e) => e.kind === 'attack' && e.actorId === idOf(result, 'Judge'))
            .flatMap((e) => e.targets)
            .find((t) => t.targetId === mamma);
        expect(hit?.didCrit).toBe(true);
        expectMeasured(hit?.amount, 27_943, TIGHT);
    });

    // Graphite's Boosted Overclock lasts 3 turns, so Judge still holds it in round 5 and its
    // expiry never slows him: he acts before Mamma and his active kills her.
    it("Judge's round-5 active crits Mamma for 107,114 and wins in round 5", () => {
        const hit = entries
            .filter(
                ({ round, entry }) =>
                    round === 5 &&
                    entry.kind === 'attack' &&
                    entry.actorId === idOf(result, 'Judge')
            )
            .flatMap(({ entry }) => entry.targets)
            .find((t) => t.targetId === mamma && (t.amount ?? 0) > 50_000);
        expect(hit?.didCrit).toBe(true);
        expectMeasured(hit?.amount, 107_114, TIGHT);
        expect(result.outcome).toMatchObject({ winner: 'player', lastRound: 5 });
    });

    it('every hit Mamma lands strikes a single row', () => {
        for (const { entry } of attacksBy((id) => id === mamma)) {
            const rows = new Set(entry.targets.map((t) => positionOf(t.targetId)[0]));
            expect(rows.size).toBe(1);
        }
    });
});

describe('a full Mamma fight with the owner team that ends on her death', () => {
    // Judge and Thresh each kill a Capo in round 1; with their security raised they resist the
    // Capo's death Stasis and reach Mamma, so the fight is decided by her death rather than by
    // the round cap.
    const run = (seed: number) => {
        setupKeyedRng(seed);
        return simulateBattle(
            {
                playerTeam: playerTeam({ Judge: { security: 1e6 }, Thresh: { security: 1e6 } }),
                enemyTeam: buildTeam(encounterBoard('maglienza', 32)!, deps),
                rounds: 30,
            },
            getGearPiece
        );
    };

    it.each([1, 2, 3])(
        'seed %i: the player wins on Mamma’s death with a Capo still alive',
        (seed) => {
            const result = run(seed);
            expect(result.outcome.winner).toBe('player');
            const last = result.rounds[result.rounds.length - 1];
            const alive = (name: string) =>
                last.ships.filter((s) => nameOf(result, s.actorId) === name && s.alive).length;
            expect(alive('Mamma Maglienza')).toBe(0);
            expect(alive('Capo')).toBeGreaterThanOrEqual(1);
        }
    );
});

/** Each attack target row of `actorName`'s casts in `round`, nested reactions included. */
const hitsBy = (result: ReturnType<typeof simulateBattle>, actorName: string, round: number) => {
    const actors = new Set(result.roster.filter((r) => r.name === actorName).map((r) => r.actorId));
    return entriesOf(result)
        .filter(
            ({ round: r, entry }) =>
                r === round && entry.kind === 'attack' && actors.has(entry.actorId)
        )
        .flatMap(({ entry }) => entry.targets);
};

const colossoFight = (playerTeam: BattlePlacement[], rounds: number) =>
    simulateBattle(
        { playerTeam, enemyTeam: buildTeam(encounterBoard('colosso', 32)!, deps), rounds },
        getGearPiece
    );

/** Whether `holderName` was granted `buffName` in `round` before `attackerName`'s first attack
 *  of that round, in log order. */
const grantedBeforeAttack = (
    result: ReturnType<typeof simulateBattle>,
    buffName: string,
    holderName: string,
    attackerName: string,
    round: number
): boolean => {
    const inRound = entriesOf(result).filter(({ round: r }) => r === round);
    const attack = inRound.findIndex(
        ({ entry }) => entry.kind === 'attack' && nameOf(result, entry.actorId) === attackerName
    );
    const holder = idOf(result, holderName);
    return inRound
        .slice(0, attack)
        .some(
            ({ entry }) =>
                entry.kind === 'buff' &&
                entry.note === buffName &&
                entry.targets.some((t) => t.targetId === holder)
        );
};

// Los alone on M4, the front of the middle row: every Major Grand's row scan reaches him.
describe('replay: Los alone against General Colosso Lv32 and his Major Grands', () => {
    setupKeyedRng(1);
    const result = colossoFight(teamOf({ Los: 'M4' }), 1);
    const los = idOf(result, 'Los');

    it("Los's opening charged skill crits Colosso for 32,237", () => {
        const hit = hitsBy(result, 'Los', 1).find(
            (t) => t.targetId === idOf(result, 'General Colosso')
        );
        expect(hit?.didCrit).toBe(true);
        expectMeasured(hit?.amount, 32_237, TIGHT);
    });

    // Seed 1 rolls no crit on the first Major Grand's hit on Los; another seed may.
    it('the first Major Grand hits Los for 1,908 without a crit', () => {
        const hit = hitsBy(result, 'Major Grand', 1).find((t) => t.targetId === los);
        expect(hit?.didCrit).not.toBe(true);
        expectMeasured(hit?.amount, 1_908, TIGHT);
    });

    it("Colosso's Marked hit on Los is 19,017 without a crit, every Major Grand alive", () => {
        const hits = hitsBy(result, 'General Colosso', 1);
        expect(hits.map((t) => t.targetId)).toEqual([los]);
        expect(hits[0].didCrit).not.toBe(true);
        expectMeasured(hits[0].amount, 19_017, TIGHT);
        const roster = result.roster.filter((r) => r.name === 'Major Grand').map((r) => r.actorId);
        const deaths = entriesOf(result).filter(
            ({ entry }) => entry.kind === 'death' && roster.includes(entry.actorId)
        );
        expect(deaths).toEqual([]);
    });
});

// Graphite on M4 at the front of the middle row, Asphyxiator directly behind it on M3: a Major
// Grand's line strikes Graphite and splashes Asphyxiator. Graphite acts first, so Asphyxiator's
// opening hit carries her Overclock III.
describe('replay: Graphite and Asphyxiator against General Colosso Lv32', () => {
    setupKeyedRng(1);
    const result = colossoFight(teamOf({ Graphite: 'M4', Asphyxiator: 'M3' }), 1);
    const graphite = idOf(result, 'Graphite');
    const asphyxiator = idOf(result, 'Asphyxiator');

    it("Asphyxiator's opening active crits a Major Grand for 38,404", () => {
        const hit = hitsBy(result, 'Asphyxiator', 1).find((t) =>
            t.targetId.includes('major-grand')
        );
        expect(hit?.didCrit).toBe(true);
        expect(grantedBeforeAttack(result, 'Overclock III', 'Asphyxiator', 'Asphyxiator', 1)).toBe(
            true
        );
        expectMeasured(hit?.amount, 38_404, TIGHT);
    });

    it('a Major Grand hits Graphite for 2,911 and splashes Asphyxiator for 1,749', () => {
        const casts = entriesOf(result).filter(
            ({ entry }) =>
                entry.kind === 'attack' &&
                nameOf(result, entry.actorId) === 'Major Grand' &&
                entry.targets.some((t) => t.targetId === graphite)
        );
        expect(casts.length).toBeGreaterThan(0);
        const targets = casts[0].entry.targets;
        expect(targets.find((t) => t.targetId === graphite)?.didCrit).not.toBe(true);
        expectMeasured(targets.find((t) => t.targetId === graphite)?.amount, 2_911, TIGHT);
        expectMeasured(targets.find((t) => t.targetId === asphyxiator)?.amount, 1_749, TIGHT);
        const marked = entriesOf(result)
            .filter(({ entry }) => entry.kind === 'debuff' && entry.note === 'Marked')
            .flatMap(({ entry }) => entry.targets.map((t) => t.targetId));
        expect(new Set(marked)).toEqual(new Set([graphite, asphyxiator]));
    });

    // The Major Grand Asphyxiator struck dies to his Inferno III before Colosso acts: Colosso
    // holds Defense Up III, which his defence-scaled hits read.
    it('with one Major Grand dead Colosso hits Asphyxiator for 52,470 and Graphite for 46,452', () => {
        const order = entriesOf(result).filter(
            ({ entry }) =>
                (entry.kind === 'death' && nameOf(result, entry.actorId) === 'Major Grand') ||
                (entry.kind === 'attack' && nameOf(result, entry.actorId) === 'General Colosso')
        );
        expect(order.map(({ entry }) => entry.kind)).toEqual(['death', 'attack']);
        const hits = hitsBy(result, 'General Colosso', 1);
        expect(hits.every((t) => !t.didCrit)).toBe(true);
        expectMeasured(hits.find((t) => t.targetId === asphyxiator)?.amount, 52_470, TIGHT);
        expectMeasured(hits.find((t) => t.targetId === graphite)?.amount, 46_452, TIGHT);
    });
});

describe('replay: the owner team against General Colosso Lv32', () => {
    // Seed 8: Colosso's round-1 hit on Graphite crits and his round-2 hit does not.
    setupKeyedRng(8);
    const result = colossoFight(playerTeam(), 2);
    const graphite = idOf(result, 'Graphite');

    it("Colosso's round-1 Marked hit crits Graphite for 31,478, every Major Grand alive", () => {
        const hit = hitsBy(result, 'General Colosso', 1).find((t) => t.targetId === graphite);
        expect(hit?.didCrit).toBe(true);
        expectMeasured(hit?.amount, 31_478, TIGHT);
    });

    it("Colosso's round-2 hit on Graphite is 29,528 with one Enrage Damage III stack, every Major Grand alive", () => {
        const hit = hitsBy(result, 'General Colosso', 2).find((t) => t.targetId === graphite);
        expect(hit?.didCrit).not.toBe(true);
        expectMeasured(hit?.amount, 29_528, TIGHT);
        const entries = entriesOf(result);
        const attack = entries.findIndex(
            ({ round, entry }) =>
                round === 2 &&
                entry.kind === 'attack' &&
                nameOf(result, entry.actorId) === 'General Colosso'
        );
        const before = entries.slice(0, attack).map(({ entry }) => entry);
        expect(
            before.filter((e) => e.kind === 'buff' && e.note === 'Enrage Damage III')
        ).toHaveLength(1);
        expect(
            before.filter((e) => e.kind === 'death' && nameOf(result, e.actorId) === 'Major Grand')
        ).toEqual([]);
    });
});

// A separate fight from the block above: Graphite's Resonating Fury procs on her round-1 shield
// and grants Judge and Thresh Crit Power Up III (Thresh's fifth buff, so 44.5% penetration), and
// Thresh's hit destroys Colosso.
describe('replay: the owner team with Resonating Fury on Graphite against General Colosso Lv32', () => {
    // Seed 5: the legendary implant's proc lands on Graphite's round-1 shield.
    setupKeyedRng(5);
    const team = playerTeam().map((p) =>
        p.ship.name === 'Graphite'
            ? {
                  ...p,
                  ship: {
                      ...p.ship,
                      implants: { implant_major: RESONATING_FURY_ID },
                  },
              }
            : p
    );
    const result = colossoFight(team, 2);
    const colosso = idOf(result, 'General Colosso');

    it("Judge's opening active crits Colosso for 115,783 under Crit Power Up III", () => {
        expect(grantedBeforeAttack(result, 'Crit Power Up III', 'Judge', 'Judge', 1)).toBe(true);
        const hit = hitsBy(result, 'Judge', 1).find((t) => t.targetId === colosso);
        expect(hit?.didCrit).toBe(true);
        expectMeasured(hit?.amount, 115_783, TIGHT);
    });

    it("Thresh's opening active crits Colosso for 145,329 under Crit Power Up III", () => {
        expect(grantedBeforeAttack(result, 'Crit Power Up III', 'Thresh', 'Thresh', 1)).toBe(true);
        const hit = hitsBy(result, 'Thresh', 1).find((t) => t.targetId === colosso);
        expect(hit?.didCrit).toBe(true);
        expectMeasured(hit?.amount, 145_329, TIGHT);
    });

    it("Thresh's hit destroys Colosso and the player wins in round 1", () => {
        const death = entriesOf(result).find(
            ({ entry }) => entry.kind === 'death' && entry.actorId === colosso
        );
        expect(death && nameOf(result, death.entry.targets[0].targetId)).toBe('Thresh');
        expect(result.outcome).toMatchObject({ winner: 'player', lastRound: 1 });
    });
});

describe('a full Colosso fight with the owner team', () => {
    // A side wins by wiping the other or, for the player, by Colosso's death; a fight that
    // reaches the round cap is decided without either.
    it.each([1, 2, 3])('seed %i: the fight ends on a wipe, his death or the round cap', (seed) => {
        setupKeyedRng(seed);
        const result = colossoFight(playerTeam(), 30);
        const last = result.rounds[result.rounds.length - 1];
        const alive = (name: string) =>
            last.ships.filter((s) => nameOf(result, s.actorId) === name && s.alive).length;
        const playerWiped = OWNER_TEAM.every((name) => alive(name) === 0);
        const colossoDead = alive('General Colosso') === 0;
        const cap = result.outcome.lastRound === 30;
        expect(result.outcome.lastRound).toBe(result.rounds.length);
        if (result.outcome.winner === 'player') expect(colossoDead || cap).toBe(true);
        else expect(playerWiped || cap).toBe(true);
    });
});
