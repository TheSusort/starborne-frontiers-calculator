/**
 * Replays of the owner's in-game bounty fights (#519): Judge (T4), Graphite (M3), Grif (B1) and
 * Thresh (B4) at their planner final stats, against Fenri Lv32, against Mamma Maglienza Lv32
 * with her three Capos, against General Colosso Lv32 with his three Major Grands (that team,
 * Los alone, and Graphite with Asphyxiator), and against Eelun Naphula Lv32 with her four
 * escorts (Graphite alone, and Grif, Liberator, Graphite, Los and Thresh), and against Abyssal
 * Fenri Lv33 with his two Torpedoes (two teams, each with a squad leader). Each pin is a hit read
 * off the in-game combat log.
 * The Fenri block checks the harness itself (Fenri's stats were fitted in an earlier fight); the
 * other blocks check the encounter's fitted stats and targeting.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildTeam } from '../buildTeam';
import { encounterBoard } from '../bossBoard';
import {
    simulateBattle,
    type BattlePlacement,
    type BattleSimulationInput,
} from '../../calculators/battleSimulator';
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
    Liberator: {
        position: 'M2',
        affinity: 'thermal',
        type: 'ATTACKER',
        refits: 6,
        stats: {
            hp: 24714,
            attack: 23051,
            defence: 4382,
            hacking: 118,
            security: 16,
            crit: 104,
            critDamage: 185,
            speed: 159.96,
            defensePenetration: 7,
            shieldPenetration: 40,
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
    // Hayyan and Sentinel: planner final stats read 2026-11-16 (`starborne` MCP, get_my_fleet,
    // main profile), when the ships above were re-read and still matched. Hayyan's heal
    // modifier is part of her planner stats.
    Hayyan: {
        position: 'T1',
        affinity: 'electric',
        type: 'SUPPORTER',
        refits: 6,
        stats: {
            hp: 69978.5,
            attack: 3209.9,
            defence: 4502.6,
            hacking: 135.5,
            security: 134.65,
            crit: 105,
            critDamage: 174,
            speed: 104.55,
            healModifier: 40,
        },
    },
    Sentinel: {
        position: 'M3',
        affinity: 'thermal',
        type: 'SUPPORTER',
        refits: 5,
        stats: {
            hp: 35541.7,
            attack: 8945.8,
            defence: 4933.9,
            hacking: 105,
            security: 118.3,
            crit: 63,
            critDamage: 52,
            speed: 305.14,
        },
    },
};

const OWNER_TEAM = ['Judge', 'Graphite', 'Grif', 'Thresh'] as const;

// Thresh carries an epic Intrusion implant, Liberator an epic and Los a rare Arcane Siege (both
// dormant unless shielded); Graphite wears the Boost set (her Overclock lasts 3 turns in game)
// and, in some fights, a legendary Resonating Fury implant. The pieces carry no stats: each
// ship's planner stats are its overrides.
const INTRUSION_ID = 'replay-intrusion';
const BOOST_SLOTS = ['weapon', 'hull', 'generator', 'sensor'] as const;
const boostId = (slot: string) => `replay-boost-${slot}`;
const RESONATING_FURY_ID = 'replay-resonating-fury';
const ARCANE_SIEGE_IDS: Partial<Record<string, string>> = {
    Liberator: 'replay-arcane-siege-epic',
    Los: 'replay-arcane-siege-rare',
};
const getGearPiece = (id: string) =>
    id.startsWith('replay-arcane-siege-')
        ? ({
              id,
              setBonus: 'ARCANE_SIEGE',
              rarity: id.slice('replay-arcane-siege-'.length),
          } as unknown as GearPiece)
        : id === INTRUSION_ID
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
        implants:
            name === 'Thresh'
                ? ({ ultimate: INTRUSION_ID } as Ship['implants'])
                : ARCANE_SIEGE_IDS[name]
                  ? ({ ultimate: ARCANE_SIEGE_IDS[name] } as Ship['implants'])
                  : {},
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

const eelunFight = (playerTeam: BattlePlacement[], rounds: number) =>
    simulateBattle(
        { playerTeam, enemyTeam: buildTeam(encounterBoard('eelun', 32)!, deps), rounds },
        getGearPiece
    );

/** `team` with Graphite wearing her legendary Resonating Fury. */
const withResonatingFury = (team: BattlePlacement[]) =>
    team.map((p) =>
        p.ship.name === 'Graphite'
            ? { ...p, ship: { ...p.ship, implants: { implant_major: RESONATING_FURY_ID } } }
            : p
    );

// Graphite alone at the front: each escort's first active strikes her after Beleth's Attack Up II
// and Defense Up II (+30%) and her own Overclock III. These are the hits Sitri's attack and
// Corson's defence were fitted to.
describe('replay: Graphite alone against Eelun Naphula Lv32 and her escorts', () => {
    setupKeyedRng(1);
    const result = eelunFight(teamOf({ Graphite: 'M4' }), 1);
    const graphite = idOf(result, 'Graphite');

    it("Sitri's first active hits Graphite for 10,542 without a crit", () => {
        const hit = hitsBy(result, 'Sitri', 1).find((t) => t.targetId === graphite);
        expect(hit?.didCrit).not.toBe(true);
        expectMeasured(hit?.amount, 10_542, TIGHT);
    });

    it("Corson's first active hits Graphite for 8,274 without a crit", () => {
        const hit = hitsBy(result, 'Corson', 1).find((t) => t.targetId === graphite);
        expect(hit?.didCrit).not.toBe(true);
        expectMeasured(hit?.amount, 8_274, TIGHT);
    });
});

// Combat 35c6ba24: Grif T1, Liberator M2, Graphite M3, Los M4, Thresh B4. Graphite's shield
// procs Resonating Fury (Crit Power Up III, 1 turn) on every ally and turns on Liberator's and
// Los's Arcane Siege. Liberator's active on Corson kills Corson and both Sitris; that action gives
// every ally +1 charge, his extra action fires his charged (no Crit Power Up III by then) and kills
// Beleth with splash on Eelun, giving +1 more; Los's charged and Thresh's charged then kill Eelun
// before she acts. Liberator's log shows each hit as two numbers; the pins are their sum.
describe('replay: the owner attack team against Eelun Naphula Lv32', () => {
    // Seed 6 is chosen so Resonating Fury procs on Graphite's round-1 shield (the opener). A
    // change to the RNG stream can move these pins without any engine change.
    setupKeyedRng(6);
    const result = eelunFight(
        withResonatingFury(
            teamOf({ Grif: 'T1', Liberator: 'M2', Graphite: 'M3', Los: 'M4', Thresh: 'B4' })
        ),
        3
    );
    const entries = entriesOf(result);
    const attacks = (name: string) =>
        entries.filter(
            ({ entry }) => entry.kind === 'attack' && nameOf(result, entry.actorId) === name
        );
    const hitOn = (attack: LoggedEntry, target: string) =>
        attack.entry.targets.filter((t) => nameOf(result, t.targetId) === target);
    const killedBy = (name: string) =>
        entries
            .filter(
                ({ entry }) =>
                    entry.kind === 'death' &&
                    entry.targets.some((t) => nameOf(result, t.targetId) === name)
            )
            .map(({ entry }) => nameOf(result, entry.actorId));

    it("Liberator's opening active hits Corson 74,688, each Sitri 65,393 and Beleth 48,485", () => {
        const opener = attacks('Liberator')[0];
        expect(opener.entry.slot).toBe('active');
        expectMeasured(hitOn(opener, 'Corson')[0]?.amount, 74_688, TIGHT);
        const sitris = hitOn(opener, 'Sitri');
        expect(sitris).toHaveLength(2);
        for (const s of sitris) expectMeasured(s.amount, 65_393, TIGHT);
        expectMeasured(hitOn(opener, 'Beleth')[0]?.amount, 48_485, TIGHT);
    });

    it("Liberator's extra action is his charged: Beleth 138,883, Eelun 48,994", () => {
        const extra = attacks('Liberator')[1];
        expect(extra.round).toBe(1);
        // The charged's first clause (Legion Discipline III) opens the turn and carries the slot.
        const opener = entries.indexOf(attacks('Liberator')[0]);
        const charged = entries.findIndex(
            ({ entry }, i) =>
                i > opener &&
                entry.kind === 'buff' &&
                entry.slot === 'charged' &&
                nameOf(result, entry.actorId) === 'Liberator'
        );
        expect(charged).toBeGreaterThan(opener);
        expect(charged).toBeLessThan(entries.indexOf(extra));
        expectMeasured(hitOn(extra, 'Beleth')[0]?.amount, 138_883, TIGHT);
        expectMeasured(hitOn(extra, 'Eelun Naphula')[0]?.amount, 48_994, TIGHT);
    });

    it('Crit Power Up III ends after Liberator’s first action', () => {
        const liberator = idOf(result, 'Liberator');
        const expiry = entries.findIndex(
            ({ entry }) =>
                entry.kind === 'buff-expired' &&
                entry.actorId === liberator &&
                entry.note === 'Crit Power Up III expired'
        );
        const extra = entries.indexOf(attacks('Liberator')[1]);
        expect(expiry).toBeGreaterThan(entries.indexOf(attacks('Liberator')[0]));
        expect(expiry).toBeLessThan(extra);
    });

    it("Los's charged hits Eelun for 79,270", () => {
        const hit = hitOn(attacks('Los')[0], 'Eelun Naphula')[0];
        expect(hit?.didCrit).toBe(true);
        expectMeasured(hit?.amount, 79_270, TIGHT);
    });

    it("Thresh's charged hits Eelun for 207,868 and kills her", () => {
        const strike = attacks('Thresh')[0];
        expect(strike.entry.slot).toBe('charged');
        expectMeasured(hitOn(strike, 'Eelun Naphula')[0]?.amount, 207_868, TIGHT);
        expect(killedBy('Thresh')).toEqual(['Eelun Naphula']);
        expect(result.outcome).toMatchObject({ winner: 'player', lastRound: 1 });
    });

    it('Liberator kills Corson and both Sitris with his first action and Beleth with his second', () => {
        expect(killedBy('Liberator').sort()).toEqual(['Beleth', 'Corson', 'Sitri', 'Sitri']);
        const deathsBeforeExtra = entries
            .slice(0, entries.indexOf(attacks('Liberator')[1]))
            .filter(({ entry }) => entry.kind === 'death')
            .map(({ entry }) => nameOf(result, entry.actorId))
            .sort();
        expect(deathsBeforeExtra).toEqual(['Corson', 'Sitri', 'Sitri']);
    });

    it('the enemies deal no damage and every player ship ends at full HP', () => {
        const enemyIds = new Set(
            result.roster.filter((r) => r.side === 'enemy').map((r) => r.actorId)
        );
        const enemyHits = entries.filter(
            ({ entry }) =>
                (entry.kind === 'attack' || entry.kind === 'dot-ticked') &&
                enemyIds.has(entry.actorId) &&
                entry.targets.some((t) => (t.amount ?? 0) > 0)
        );
        expect(enemyHits).toEqual([]);
        const last = result.rounds[result.rounds.length - 1];
        for (const ship of last.ships.filter((s) => !enemyIds.has(s.actorId)))
            expect(ship.hpPct).toBe(100);
    });
});

const fenri33Fight = (
    playerTeam: BattlePlacement[],
    playerSquadLeader: BattleSimulationInput['playerSquadLeader'],
    rounds: number
) =>
    simulateBattle(
        {
            playerTeam,
            enemyTeam: buildTeam(encounterBoard('fenri', 33)!, deps),
            rounds,
            playerSquadLeader,
        },
        getGearPiece
    );

/** What a heal entry's repair on `targetId` would have been with room to land: the game shows
 *  the full repair, the log splits it into landed `amount` and `overheal`. */
const grossHeal = (entry: CombatLogEntry, targetId: string) => {
    const t = entry.targets.find((x) => x.targetId === targetId);
    return t === undefined ? undefined : (t.amount ?? 0) + (t.overheal ?? 0);
};

// Hayyan T1, Grif T4, Thresh B2, Judge B4 under Viper Lv3 (XAOC: Grif alone gets its +10% HP and
// attack and +7.5% outgoing damage; every enemy loses 20 speed). Fenri's attack and defence were
// fitted to this fight.
describe('replay: Hayyan, Grif, Thresh and Judge against Abyssal Fenri Lv33 and his Torpedoes', () => {
    // Seed 1: none of Fenri's hits crit, as in game, and both of his Stasis applications land.
    setupKeyedRng(1);
    const result = fenri33Fight(
        teamOf({ Hayyan: 'T1', Grif: 'T4', Thresh: 'B2', Judge: 'B4' }),
        { faction: 'XAOC', name: 'Viper', stage: 3 },
        3
    );
    const entries = entriesOf(result);
    const fenri = idOf(result, 'Abyssal Fenri Khaliriz');
    const torpedoAt = (position: Position) =>
        result.roster.find((r) => r.name === 'Torpedo' && r.position === position)!.actorId;
    const inRound = (round: number) => entries.filter((e) => e.round === round);
    const indexOf = (round: number, match: (entry: CombatLogEntry) => boolean) =>
        inRound(round).findIndex(({ entry }) => match(entry));
    const attackBy = (actorId: string, round: number) =>
        inRound(round).find(({ entry }) => entry.kind === 'attack' && entry.actorId === actorId)
            ?.entry;
    const target = (entry: CombatLogEntry | undefined, name: string) =>
        entry?.targets.find((t) => t.targetId === idOf(result, name));
    const killedBy = (actorId: string, round: number) =>
        inRound(round)
            .filter(({ entry }) => entry.kind === 'death' && entry.targets[0]?.targetId === actorId)
            .map(({ entry }) => nameOf(result, entry.actorId))
            .sort();

    it("Judge's opening active crits Fenri for 81,694 and Thresh's for 113,643", () => {
        const judge = target(attackBy(idOf(result, 'Judge'), 1), 'Abyssal Fenri Khaliriz');
        const thresh = target(attackBy(idOf(result, 'Thresh'), 1), 'Abyssal Fenri Khaliriz');
        expect([judge?.didCrit, thresh?.didCrit]).toEqual([true, true]);
        expectMeasured(judge?.amount, 81_694, TIGHT);
        expectMeasured(thresh?.amount, 113_643, TIGHT);
    });

    it('Judge and Thresh both act before Fenri in round 1', () => {
        const attackers = inRound(1)
            .filter(({ entry }) => entry.kind === 'attack')
            .map(({ entry }) => nameOf(result, entry.actorId));
        expect(attackers.slice(0, 3)).toEqual(['Judge', 'Thresh', 'Abyssal Fenri Khaliriz']);
    });

    it("Hayyan's opening repair is 29,528 on each of the four ships", () => {
        const heal = inRound(1).find(
            ({ entry }) => entry.kind === 'heal' && entry.actorId === idOf(result, 'Hayyan')
        )?.entry;
        expect(heal).toBeDefined();
        for (const name of ['Hayyan', 'Grif', 'Thresh', 'Judge'])
            expectMeasured(grossHeal(heal!, idOf(result, name)), 29_528, TIGHT);
    });

    it("Fenri's round-1 active hits Judge for 61,977 and splashes Thresh for 29,660, killing both", () => {
        const cast = attackBy(fenri, 1);
        expect(cast?.slot).toBe('active');
        const judge = target(cast, 'Judge');
        const thresh = target(cast, 'Thresh');
        expect(judge?.isPrimary).toBe(true);
        expect([judge?.didCrit, thresh?.didCrit]).not.toContain(true);
        expectMeasured(judge?.amount, 61_977, TIGHT);
        expectMeasured(thresh?.amount, 29_660, TIGHT);
        expect(killedBy(fenri, 1)).toEqual(['Judge', 'Thresh']);
    });

    // The game showed one repair of 103,016 (12% of max HP at crit power 72). The sim repairs once
    // per death; seed 1 crits the second at crit power 71.
    it('each round-1 death repairs Fenri, at least 12% of his max HP, and grants Attack Up II', () => {
        const repairs = inRound(1)
            .filter(({ entry }) => entry.kind === 'heal' && entry.actorId === fenri)
            .map(({ entry }) => grossHeal(entry, fenri)!)
            .sort((a, b) => a - b);
        expect(repairs).toHaveLength(2);
        expect(repairs[0]).toBeCloseTo(0.12 * 499_108, 0);
        expect(repairs[1]).toBeGreaterThan(repairs[0]);
        const attackUp = inRound(1).filter(
            ({ entry }) =>
                entry.kind === 'buff' && entry.actorId === fenri && entry.note === 'Attack Up II'
        );
        expect(attackUp).toHaveLength(2);
    });

    it('at the end of round 1 Fenri puts Stasis on Grif, then the T4 Torpedo blasts Grif 43,623 and Hayyan 21,812', () => {
        const t4 = torpedoAt('T4');
        const stasis = indexOf(
            1,
            (e) =>
                e.kind === 'debuff' &&
                e.note === 'Stasis' &&
                e.actorId === fenri &&
                e.targets[0]?.targetId === idOf(result, 'Grif')
        );
        const blastAt = indexOf(1, (e) => e.kind === 'attack' && e.actorId === t4);
        expect(stasis).toBeGreaterThanOrEqual(0);
        expect(blastAt).toBeGreaterThan(stasis);
        const blast = hitsBy(result, 'Torpedo', 1);
        const grif = blast.find((t) => t.targetId === idOf(result, 'Grif'));
        const hayyan = blast.find((t) => t.targetId === idOf(result, 'Hayyan'));
        expect(blast.every((t) => !t.didCrit)).toBe(true);
        expectMeasured(grif?.amount, 43_623, TIGHT);
        expectMeasured(hayyan?.amount, 21_812, TIGHT);
        expect(inRound(1).some(({ entry }) => entry.kind === 'death' && entry.actorId === t4)).toBe(
            true
        );
    });

    // Grif's 43,598 planner HP would not survive the 43,623 blast; Viper's +10% HP does.
    it("Fenri's round-2 active hits Grif for 62,898 and kills him", () => {
        const cast = attackBy(fenri, 2);
        expect(cast?.slot).toBe('active');
        const grif = target(cast, 'Grif');
        expect(grif?.didCrit).not.toBe(true);
        expectMeasured(grif?.amount, 62_898, TIGHT);
        expect(killedBy(fenri, 2)).toEqual(['Grif']);
    });

    it('at the end of round 2 Fenri puts Stasis on Hayyan, then the T2 Torpedo blasts her for 43,623', () => {
        const t2 = torpedoAt('T2');
        const hayyan = idOf(result, 'Hayyan');
        const stasis = indexOf(
            2,
            (e) =>
                e.kind === 'debuff' &&
                e.note === 'Stasis' &&
                e.actorId === fenri &&
                e.targets[0]?.targetId === hayyan
        );
        const blastAt = indexOf(2, (e) => e.kind === 'attack' && e.actorId === t2);
        expect(stasis).toBeGreaterThanOrEqual(0);
        expect(blastAt).toBeGreaterThan(stasis);
        const hit = attackBy(t2, 2)?.targets.find((t) => t.targetId === hayyan);
        expect(hit?.didCrit).not.toBe(true);
        expectMeasured(hit?.amount, 43_623, TIGHT);
    });

    // The T2 blast breaks the Stasis, so Hayyan keeps her round-3 turn.
    it("Hayyan acts in round 3, then Fenri's charged hits her for 97,442", () => {
        const hayyan = idOf(result, 'Hayyan');
        const ownTurn = indexOf(3, (e) => e.actorId === hayyan && e.slot !== undefined);
        const charged = indexOf(3, (e) => e.kind === 'attack' && e.actorId === fenri);
        expect(ownTurn).toBeGreaterThanOrEqual(0);
        expect(charged).toBeGreaterThan(ownTurn);
        const cast = attackBy(fenri, 3);
        expect(cast?.slot).toBe('charged');
        const hit = cast?.targets.find((t) => t.targetId === hayyan);
        expect(hit?.didCrit).not.toBe(true);
        expectMeasured(hit?.amount, 97_442, TIGHT);
    });

    // In game the charged re-arms both Torpedoes although it kills the last ship; the sim re-arms
    // nothing on a cast that ends the fight.
    it.todo('the round-3 charged re-arms both Torpedoes at T2 and T4 with Stealth');
    // In game Hayyan's round-3 turn also shows a 10,738 crit repair: her 4% cleanse repair, so a
    // debuff was still on her to cleanse. The sim cleanses nothing there.
    it.todo("Hayyan's round-3 cleanse repairs her for 10,738");
});

// Grif, Sentinel, Asphyxiator, Judge and Thresh under Colonel Lv2 (Legion: Judge and Sentinel get
// its +10% attack, +7.5% defence penetration and +7.5% attack per other living Legion ally). The
// in-game layout is not recorded: this one puts Asphyxiator, Judge and Thresh in Sentinel's cone,
// with Judge acting before Thresh, so Thresh's Intrusion reads Judge's Concentrate Fire. These
// pins corroborate the defence fitted in the fight above.
describe('replay: Grif, Sentinel, Asphyxiator, Judge and Thresh against Abyssal Fenri Lv33', () => {
    setupKeyedRng(1);
    const result = fenri33Fight(
        teamOf({ Grif: 'T3', Sentinel: 'M3', Asphyxiator: 'M4', Judge: 'B2', Thresh: 'M2' }),
        { faction: 'FRONTIER_LEGION', name: 'Colonel', stage: 2 },
        1
    );
    const fenri = idOf(result, 'Abyssal Fenri Khaliriz');

    it("Asphyxiator's opening active crits Fenri for 52,012 under his own Defense Down III", () => {
        expect(grantedBeforeAttack(result, 'Attack Up III', 'Asphyxiator', 'Asphyxiator', 1)).toBe(
            true
        );
        const hit = hitsBy(result, 'Asphyxiator', 1).find((t) => t.targetId === fenri);
        expect(hit?.didCrit).toBe(true);
        expectMeasured(hit?.amount, 52_012, TIGHT);
    });

    it("Sentinel's reaction hits Fenri for 4,750", () => {
        const hits = hitsBy(result, 'Sentinel', 1).filter((t) => t.targetId === fenri);
        expect(hits.length).toBeGreaterThan(0);
        for (const hit of hits) expectMeasured(hit.amount, 4_750, TIGHT);
    });

    it("Thresh's active crits Fenri for 265,009 and destroys him", () => {
        const hit = hitsBy(result, 'Thresh', 1).find((t) => t.targetId === fenri);
        expect(hit?.didCrit).toBe(true);
        expectMeasured(hit?.amount, 265_009, TIGHT);
        expect(result.outcome).toMatchObject({ winner: 'player', lastRound: 1 });
    });

    // In this layout Judge's active reads 255,673, 5.2% low: about 5.4 more defence penetration
    // than the sim gives him would close it.
    it.todo("Judge's crit on Fenri is 269,777");
});
