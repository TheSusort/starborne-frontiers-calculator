/**
 * Several complete sets of one effect set stack in the combat sim (owner ruling 42): 6 Shield
 * pieces generate 12% per turn, 6 Leech pieces leech 45%, 6 Reflect pieces reflect 30%, 6
 * Hardened pieces cut crit damage taken by 15%, and 6 Revenge pieces give 3x the missing-HP
 * bonus — matching the stat page and autogear, which already count each complete set.
 *
 * Real `simulateBattle` path, real Bedrock kit ("deals 90% damage") on both sides, the gear
 * resolved through `buildEquipmentAbilities` from `{ setBonus }` pieces. Every board runs with
 * the wearer on the player side and again on the enemy side.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { CombatEvent } from '../events';
import { simulateBattle, BattlePlacement, BattleResult } from '../../calculators/battleSimulator';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { GearPiece } from '../../../types/gear';
import type { GearSetName } from '../../../constants/gearSets';
import type { CombatActor } from '../state';

const tap = vi.hoisted(() => ({ recorded: [] as CombatEvent[], buses: 0 }));
vi.mock('../events', async (importOriginal) => {
    const mod = await importOriginal<typeof import('../events')>();
    return {
        ...mod,
        createEventBus: () => {
            const bus = mod.createEventBus();
            // simulateBattle's own bus is created first; only the first bus of a run is recorded.
            if (tap.buses++ > 0) return bus;
            const emit = bus.emit.bind(bus);
            bus.emit = (e) => {
                tap.recorded.push(e);
                emit(e);
            };
            return bus;
        },
    };
});

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

const SLOTS = ['weapon', 'hull', 'generator', 'sensor', 'software', 'thrusters'] as const;
const HP = 1_000_000;

type Side = 'player' | 'enemy';
interface Combatant {
    attack: number;
    crit?: number;
    speed: number;
    set?: GearSetName;
    pieces?: number;
}

const gearFor = (owner: string, c: Combatant) => {
    const equipment: Record<string, string> = {};
    const pieces: Record<string, GearPiece> = {};
    for (let i = 0; i < (c.pieces ?? 0); i++) {
        const id = `${owner}-${c.set}-${i}`;
        equipment[SLOTS[i]] = id;
        pieces[id] = {
            id,
            slot: SLOTS[i],
            level: 16,
            stars: 6,
            rarity: 'legendary',
            mainStat: null,
            subStats: [],
            setBonus: c.set ?? null,
        };
    }
    return { equipment, pieces };
};

const placement = (owner: string, c: Combatant, equipment: Record<string, string>) => {
    const ship = buildTraceShip('Bedrock');
    if (!ship) throw new Error('Bedrock missing from reference data');
    return {
        ship: { ...ship, id: owner, equipment },
        position: 'M4',
        statOverrides: {
            attack: c.attack,
            crit: c.crit ?? 0,
            critDamage: 100,
            defensePenetration: 0,
            hacking: 0,
            security: 0,
            defence: 0,
            hp: HP,
            speed: c.speed,
        },
    } satisfies BattlePlacement;
};

interface Run {
    events: CombatEvent[];
    result: BattleResult;
    wearer: string;
    other: string;
}

/** The wearer fights a bare Bedrock; `wearerSide` says which team it sits on. */
const run = (
    wearerSide: Side,
    wearer: Combatant,
    other: Combatant,
    rounds = 2,
    wearerHpPct = 100
): Run => {
    tap.recorded.length = 0;
    tap.buses = 0;
    setupKeyedRng(1);
    const w = gearFor('W', wearer);
    const o = gearFor('O', other);
    const lookup = { ...w.pieces, ...o.pieces };
    const wearerPlacement = placement('W', wearer, w.equipment);
    const otherPlacement = placement('O', other, o.equipment);
    const wearerId = wearerSide === 'player' ? 'attacker' : 'e:W:0';
    const result = simulateBattle(
        {
            playerTeam: [wearerSide === 'player' ? wearerPlacement : otherPlacement],
            enemyTeam: [wearerSide === 'player' ? otherPlacement : wearerPlacement],
            rounds,
            __testTapActors: (actors: CombatActor[]) => {
                const a = actors.find((x) => x.id === wearerId);
                if (!a) throw new Error(`no actor ${wearerId}`);
                a.currentHp = (HP * wearerHpPct) / 100;
            },
        },
        (id) => lookup[id]
    );
    return {
        events: [...tap.recorded],
        result,
        wearer: wearerId,
        other: wearerSide === 'player' ? 'e:O:0' : 'attacker',
    };
};

type Ev<T extends CombatEvent['type']> = Extract<CombatEvent, { type: T }>;
const rows = <T extends CombatEvent['type']>(r: Run, type: T, pick: (e: Ev<T>) => boolean) =>
    r.events.filter((e): e is Ev<T> => e.type === type && pick(e as Ev<T>));
/** The ONE cast hit `from` landed on `to` in `round`. */
const hit = (r: Run, from: string, to: string, round: number): number => {
    const found = rows(
        r,
        'attacked',
        (e) => e.attackerId === from && e.targetId === to && e.round === round
    );
    expect(found).toHaveLength(1);
    return found[0].damage!;
};

/** One ship's round-`round` row of the assembled result (what the Simulator page shows). */
const shipRow = (r: Run, actorId: string, round: number) => {
    const row = r.result.rounds
        .find((x) => x.round === round)
        ?.ships.find((s) => s.actorId === actorId);
    if (!row) throw new Error(`no row for ${actorId} in round ${round}`);
    return row;
};

const SIDES: Side[] = ['player', 'enemy'];
// 0 pieces is the control; 5 pieces is two complete sets plus an orphan.
const PIECES_TO_SETS = [
    [2, 1],
    [4, 2],
    [5, 2],
    [6, 3],
] as const;

describe.each(SIDES)('complete gear sets stack — wearer on the %s side', (side) => {
    it('Shield: the turn-start shield is 4% of max HP per complete set', () => {
        const shieldOn = (pieces: number) => {
            const r = run(
                side,
                { attack: 0, speed: 200, set: 'SHIELD', pieces },
                { attack: 0, speed: 100 }
            );
            const grants = rows(
                r,
                'shield-applied',
                (e) => e.granterId === r.wearer && e.round === 1
            );
            return grants.reduce((s, e) => s + e.amount, 0);
        };
        for (const [pieces, sets] of PIECES_TO_SETS) {
            expect(shieldOn(pieces)).toBeCloseTo(HP * 0.04 * sets, 6);
        }
        // Negative: one piece is no set, so no shield.
        expect(shieldOn(1)).toBe(0);
    });

    it('Leech: the leech is 15% of the damage dealt per complete set', () => {
        const leechRatio = (pieces: number) => {
            const r = run(
                side,
                { attack: 10_000, speed: 200, set: 'LEECH', pieces },
                { attack: 0, speed: 100 },
                2,
                10 // hurt, so the leech is not clipped by the max-HP cap
            );
            const dealt = hit(r, r.wearer, r.other, 1);
            expect(dealt).toBeGreaterThan(0);
            return shipRow(r, r.wearer, 1).healingDone / dealt;
        };
        for (const [pieces, sets] of PIECES_TO_SETS) {
            expect(leechRatio(pieces)).toBeCloseTo(0.15 * sets, 9);
        }
    });

    it('Reflect: the reflected share of each hit is 10% per complete set', () => {
        // The wearer deals nothing itself, so everything the opponent takes is reflected.
        const reflectedShare = (pieces: number) => {
            const r = run(
                side,
                { attack: 0, speed: 100, set: 'REFLECT', pieces },
                { attack: 10_000, speed: 200 }
            );
            const taken = shipRow(r, r.wearer, 1).damageTaken;
            const reflected = shipRow(r, r.other, 1).damageTaken;
            return { taken, reflected };
        };
        for (const [pieces, sets] of PIECES_TO_SETS) {
            const { taken, reflected } = reflectedShare(pieces);
            expect(taken).toBeGreaterThan(0);
            expect(reflected / taken).toBeCloseTo(0.1 * sets, 6);
        }
    });

    it('Hardened: a crit on the wearer is cut 5% per complete set; a plain hit is not', () => {
        const takenFrom = (crit: number, pieces: number) => {
            const r = run(
                side,
                { attack: 0, speed: 100, set: 'HARDENED', pieces },
                { attack: 10_000, crit, speed: 200 }
            );
            return hit(r, r.other, r.wearer, 1);
        };
        const critBare = takenFrom(100, 0);
        for (const [pieces, sets] of PIECES_TO_SETS) {
            expect(takenFrom(100, pieces) / critBare).toBeCloseTo(1 - 0.05 * sets, 9);
        }
        // Negative: the set is crit-only.
        expect(takenFrom(0, 6)).toBeCloseTo(takenFrom(0, 0), 9);
    });

    it('Revenge: the missing-HP bonus is 25% x lost HP% per complete set', () => {
        const castAt = (hpPct: number, pieces: number) => {
            const r = run(
                side,
                { attack: 10_000, speed: 200, set: 'REVENGE', pieces },
                { attack: 0, speed: 100 },
                2,
                hpPct
            );
            return hit(r, r.wearer, r.other, 1);
        };
        const bare = castAt(50, 0);
        for (const [pieces, sets] of PIECES_TO_SETS) {
            // 50% HP lost -> +12.5% per set.
            expect(castAt(50, pieces) / bare).toBeCloseTo(1 + 0.125 * sets, 9);
        }
        // Negative: at full HP nothing is missing, whatever the set count.
        expect(castAt(100, 6)).toBeCloseTo(castAt(100, 0), 9);
    });
});
