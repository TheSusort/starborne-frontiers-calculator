import { describe, it, expect } from 'vitest';
import type { GearPiece } from '../../types/gear';
import type { Ship } from '../../types/ship';
import type { EquipmentSlotName } from '../../constants/gearTypes';
import type { WishlistEntry } from '../../types/wishlist';
import { baselineBreakdownCache } from '../gear/potentialCalculator';
import { makeMinimalPiece, makeShip } from '../gear/fastPotential/__tests__/fixtures';
import { scoreWishlistMatches, type ScoreWishlistInput } from './scoreWishlistMatches';

function piece(id: string, slot: EquipmentSlotName, over: Partial<GearPiece> = {}): GearPiece {
    return { ...makeMinimalPiece(id, slot), level: 16, ...over };
}

function entryFor(target: WishlistEntry['target']): WishlistEntry {
    return { id: 'e1', name: 'test', filters: {}, target };
}

interface Setup {
    ships: Ship[];
    inventory: GearPiece[];
}

function run(
    setup: Setup,
    entry: WishlistEntry,
    matches: GearPiece[],
    extra: Partial<ScoreWishlistInput> = {}
) {
    const byId = new Map(setup.inventory.map((p) => [p.id, p]));
    return scoreWishlistMatches({
        entry,
        matches,
        gearInventory: setup.inventory,
        ships: setup.ships,
        getGearPiece: (id) => byId.get(id),
        getEngineeringStatsForShipType: () => undefined,
        ...extra,
    });
}

const atk = (value: number) => ({ name: 'attack' as const, value, type: 'flat' as const });

describe('scoreWishlistMatches: ship target', () => {
    const equippedWeapon = piece('eq-weapon', 'weapon', { mainStat: atk(300) });
    const equippedHull = piece('eq-hull', 'hull', {
        mainStat: { name: 'hp', value: 1000, type: 'flat' },
    });
    const ship = makeShip({ equipment: { weapon: 'eq-weapon', hull: 'eq-hull' } });
    const target = { kind: 'ship', shipId: ship.id } as const;

    it('a candidate identical to the equipped piece scores exactly 0 and is no upgrade', async () => {
        const setup = { ships: [ship], inventory: [equippedWeapon, equippedHull] };
        const { scores } = await run(setup, entryFor(target), [equippedWeapon]);
        expect(scores[0].deltaNowPct).toBe(0);
        expect(scores[0].deltaPotentialPct).toBe(0);
        expect(scores[0].isUpgrade).toBe(false);
    });

    it('a strictly better piece scores a positive delta and is an upgrade', async () => {
        const better = piece('better', 'weapon', { mainStat: atk(900) });
        const setup = { ships: [ship], inventory: [equippedWeapon, equippedHull, better] };
        const { scores } = await run(setup, entryFor(target), [better]);
        expect(scores[0].deltaNowPct).toBeGreaterThan(0);
        expect(scores[0].deltaPotentialPct).toBeGreaterThan(0);
        expect(scores[0].isUpgrade).toBe(true);
    });

    it('a strictly worse piece scores a negative delta', async () => {
        const worse = piece('worse', 'weapon', { mainStat: atk(10) });
        const setup = { ships: [ship], inventory: [equippedWeapon, equippedHull, worse] };
        const { scores } = await run(setup, entryFor(target), [worse]);
        expect(scores[0].deltaPotentialPct).toBeLessThan(0);
        expect(scores[0].isUpgrade).toBe(false);
    });

    it('a swap that breaks a 2-piece set scores lower than the same stats with the set kept', async () => {
        const setWeapon = piece('set-weapon', 'weapon', {
            mainStat: atk(300),
            setBonus: 'ATTACK',
        });
        const setHull = piece('set-hull', 'hull', { setBonus: 'ATTACK' });
        const setShip = makeShip({ equipment: { weapon: 'set-weapon', hull: 'set-hull' } });
        const kept = piece('kept', 'weapon', { mainStat: atk(300), setBonus: 'ATTACK' });
        const broken = piece('broken', 'weapon', { mainStat: atk(300), setBonus: null });
        const setup = { ships: [setShip], inventory: [setWeapon, setHull, kept, broken] };
        const { scores } = await run(setup, entryFor({ kind: 'ship', shipId: setShip.id }), [
            kept,
            broken,
        ]);
        const keptScore = scores.find((s) => s.pieceId === 'kept');
        const brokenScore = scores.find((s) => s.pieceId === 'broken');
        expect(keptScore?.deltaNowPct).toBe(0);
        expect(brokenScore?.deltaNowPct).toBeLessThan(0);
        expect(brokenScore?.isUpgrade).toBe(false);
    });

    it('an empty slot makes every match an upgrade', async () => {
        const bare = makeShip({ id: 'bare', equipment: {} });
        const a = piece('a', 'weapon', { mainStat: atk(100) });
        const b = piece('b', 'hull', { mainStat: { name: 'hp', value: 500, type: 'flat' } });
        const setup = { ships: [bare], inventory: [a, b] };
        const { scores } = await run(setup, entryFor({ kind: 'ship', shipId: 'bare' }), [a, b]);
        expect(scores).toHaveLength(2);
        expect(scores.every((s) => s.isUpgrade)).toBe(true);
    });

    it('compares levelled to levelled: a low-level candidate is simulated, the equipped piece too', async () => {
        const low = piece('low', 'weapon', { mainStat: atk(100), level: 0 });
        const setup = { ships: [ship], inventory: [equippedWeapon, equippedHull, low] };
        const simulated: string[] = [];
        const { scores } = await run(setup, entryFor(target), [low], {
            simulationCount: 3,
            simulate: (p) => {
                simulated.push(p.id);
                return { ...p, level: 16, mainStat: atk(800) };
            },
        });
        // Only the candidate is below 16: the equipped piece is level 16 and is not simulated.
        expect(simulated).toEqual(['low', 'low', 'low']);
        expect(scores[0].potentialScore).toBeGreaterThan(scores[0].nowScore);
        expect(scores[0].deltaPotentialPct).toBeGreaterThan(scores[0].deltaNowPct ?? 0);
    });

    it('simulates a sub-16 equipped piece for the levelled baseline', async () => {
        const lowEquipped = piece('eq-low', 'weapon', { mainStat: atk(300), level: 4 });
        const lowShip = makeShip({ id: 'low-ship', equipment: { weapon: 'eq-low' } });
        const cand = piece('cand', 'weapon', { mainStat: atk(300), level: 16 });
        const setup = { ships: [lowShip], inventory: [lowEquipped, cand] };
        const { scores } = await run(
            setup,
            entryFor({ kind: 'ship', shipId: 'low-ship' }),
            [cand],
            {
                simulationCount: 2,
                simulate: (p) => ({ ...p, level: 16, mainStat: atk(1000) }),
            }
        );
        // Equipped piece levels up to 1000 attack; the 300-attack level-16 candidate is worse.
        expect(scores[0].deltaNowPct).toBe(0);
        expect(scores[0].deltaPotentialPct).toBeLessThan(0);
    });

    it('does not serve a stale slot baseline after another slot of the ship changes', async () => {
        const strongHull = piece('strong-hull', 'hull', { mainStat: atk(4000) });
        const cand = piece('c', 'weapon', { mainStat: atk(900) });
        const inv = [equippedWeapon, equippedHull, strongHull, cand];
        const first = await run({ ships: [ship], inventory: inv }, entryFor(target), [cand]);
        const swapped = { ...ship, equipment: { ...ship.equipment, hull: 'strong-hull' } };
        const second = await run({ ships: [swapped], inventory: inv }, entryFor(target), [cand]);
        // The weapon slot baseline contains the hull, so a stale baseline would repeat the score.
        expect(second.scores[0].nowScore).toBeGreaterThan(first.scores[0].nowScore);
        expect(baselineBreakdownCache.size).toBe(0);
    });
});

describe('scoreWishlistMatches: role target', () => {
    const entry = entryFor({ kind: 'role', role: 'ATTACKER' });

    it('ranks across the whole slot pool, including pieces that are not matches', async () => {
        const top = piece('top', 'weapon', { mainStat: atk(900), rarity: 'epic' });
        const mid = piece('mid', 'weapon', { mainStat: atk(500) });
        const low = piece('low', 'weapon', { mainStat: atk(100) });
        const otherSlot = piece('hull1', 'hull', {
            mainStat: { name: 'hp', value: 9999, type: 'flat' },
        });
        const inventory = [top, mid, low, otherSlot];
        const { scores } = await run({ ships: [], inventory }, entry, [mid]);
        expect(scores).toHaveLength(1);
        expect(scores[0].potentialRank).toBe(2);
        expect(scores[0].rankPoolSize).toBe(3);
        expect(scores[0].bestOwnedPotentialScore).toBeGreaterThan(scores[0].potentialScore);
    });

    it('flags only the top 3 as upgrades', async () => {
        const pieces = [900, 800, 700, 600].map((v, i) =>
            piece(`p${i}`, 'weapon', { mainStat: atk(v) })
        );
        const { scores } = await run({ ships: [], inventory: pieces }, entry, pieces);
        const byId = Object.fromEntries(scores.map((s) => [s.pieceId, s]));
        expect(byId.p0.potentialRank).toBe(1);
        expect(byId.p2.isUpgrade).toBe(true);
        expect(byId.p3.potentialRank).toBe(4);
        expect(byId.p3.isUpgrade).toBe(false);
    });
});

describe('scoreWishlistMatches: edge cases', () => {
    it('level-16 piece has potentialScore equal to nowScore and is never simulated', async () => {
        const p = piece('p', 'weapon');
        let calls = 0;
        const { scores } = await run(
            { ships: [], inventory: [p] },
            entryFor({ kind: 'role', role: 'ATTACKER' }),
            [p],
            {
                simulate: (x) => {
                    calls++;
                    return x;
                },
            }
        );
        expect(scores[0].potentialScore).toBe(scores[0].nowScore);
        expect(calls).toBe(0);
    });

    it('a missing ship leaves matches unscored', async () => {
        const p = piece('p', 'weapon');
        const result = await run(
            { ships: [], inventory: [p] },
            entryFor({ kind: 'ship', shipId: 'gone' }),
            [p]
        );
        expect(result.status).toBe('ship-missing');
        expect(result.scores).toEqual([]);
    });

    it('an unknown role leaves matches unscored and does not mutate the entry', async () => {
        const p = piece('p', 'weapon');
        const e = entryFor({ kind: 'role', role: 'NOT_A_ROLE' as never });
        const snapshot = JSON.stringify(e);
        const result = await run({ ships: [], inventory: [p] }, e, [p]);
        expect(result.status).toBe('role-unknown');
        expect(result.scores).toEqual([]);
        expect(JSON.stringify(e)).toBe(snapshot);
    });

    it('an entry without a target is not scored', async () => {
        const p = piece('p', 'weapon');
        const result = await run({ ships: [], inventory: [p] }, entryFor(undefined), [p]);
        expect(result.status).toBe('no-target');
        expect(result.scores).toEqual([]);
    });

    it('uses 40 simulations per piece by default', async () => {
        const p = piece('p', 'weapon', { level: 0 });
        let calls = 0;
        await run(
            { ships: [], inventory: [p] },
            entryFor({ kind: 'role', role: 'ATTACKER' }),
            [p],
            {
                simulate: (x) => {
                    calls++;
                    return x;
                },
            }
        );
        // The candidate is its own pool entry; its potential is computed once.
        expect(calls).toBe(40);
    });
});
