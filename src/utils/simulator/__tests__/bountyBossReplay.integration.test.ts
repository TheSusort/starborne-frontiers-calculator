/**
 * Replays of the owner's in-game bounty fights (#519): Judge (T4), Graphite (M3), Grif (B1) and
 * Thresh (B4) at their planner final stats, against Fenri Lv32 and against Mamma Maglienza Lv32
 * with her three Capos. Each pin is a hit read off the in-game combat log. The Fenri block checks
 * the harness itself (Fenri's stats were fitted in an earlier fight); the Mamma block checks
 * Mamma's and the Capo's stats and row choices.
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
};

// Thresh carries an epic Intrusion implant; Graphite wears the Boost set (her Overclock lasts 3
// turns in game). The pieces carry no stats: each ship's planner stats are its overrides.
const INTRUSION_ID = 'replay-intrusion';
const BOOST_SLOTS = ['weapon', 'hull', 'generator', 'sensor'] as const;
const boostId = (slot: string) => `replay-boost-${slot}`;
const getGearPiece = (id: string) =>
    id === INTRUSION_ID
        ? ({ id, setBonus: 'INTRUSION', rarity: 'epic' } as unknown as GearPiece)
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

/** The owner's team; `extra` is spread over a ship's planner stats. */
const playerTeam = (
    extra: Partial<Record<string, BattlePlacement['statOverrides']>> = {}
): BattlePlacement[] => {
    const board: BoardState = {};
    for (const name of Object.keys(FLEET)) board[FLEET[name].position] = { ship: fleetShip(name) };
    return buildTeam(board, deps).map((p) => ({
        ...p,
        statOverrides: { ...p.statOverrides, ...FLEET[p.ship.name].stats, ...extra[p.ship.name] },
    }));
};

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
