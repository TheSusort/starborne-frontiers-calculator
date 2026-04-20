import { describe, it, expect, beforeEach } from 'vitest';
import { buildPotentialContext } from '../potentialContext';
import { STAT_INDEX } from '../../../fastScoring/statVector';
import { baselineBreakdownCache, baselineStatsCache } from '../../potentialCalculator';
import type { GearPiece } from '../../../../types/gear';
import { makeMinimalPiece, makeShip } from './fixtures';

beforeEach(() => {
    baselineBreakdownCache.clear();
    baselineStatsCache.clear();
});

describe('buildPotentialContext — dummy mode', () => {
    it('sets withShip=false and uses role base stats for percentRef', () => {
        const inventory = [makeMinimalPiece('g1', 'weapon', 'DECIMATION')];
        const ctx = buildPotentialContext({
            inventory,
            shipRole: 'ATTACKER',
            slot: undefined,
            selectedStats: [],
            ship: undefined,
            getGearPiece: undefined,
            getEngineeringStatsForShipType: undefined,
        });
        expect(ctx.withShip).toBe(false);
        expect(ctx.ship).toBeUndefined();
        // ATTACKER base attack = 6250 (per spec Invariants + ROLE_BASE_STATS)
        expect(ctx.percentRef.attack).toBe(6250);
    });

    it('leaves all slot setCounts zeroed', () => {
        const inventory = [makeMinimalPiece('g1', 'weapon', 'DECIMATION')];
        const ctx = buildPotentialContext({
            inventory,
            shipRole: 'ATTACKER',
            slot: undefined,
            selectedStats: [],
            ship: undefined,
            getGearPiece: undefined,
            getEngineeringStatsForShipType: undefined,
        });
        for (const baseline of ctx.baselinesBySlot.values()) {
            for (const n of baseline.setCount) expect(n).toBe(0);
        }
    });

    it('finalVector is null for every slot', () => {
        const inventory = [makeMinimalPiece('g1', 'weapon', 'DECIMATION')];
        const ctx = buildPotentialContext({
            inventory,
            shipRole: 'ATTACKER',
            slot: undefined,
            selectedStats: [],
            ship: undefined,
            getGearPiece: undefined,
            getEngineeringStatsForShipType: undefined,
        });
        for (const baseline of ctx.baselinesBySlot.values()) {
            expect(baseline.finalVector).toBeNull();
        }
    });
});

describe('buildPotentialContext — with-ship mode', () => {
    it('sets withShip=true and percentRef equals afterEngineering', () => {
        const ship = makeShip();
        const inventory = [makeMinimalPiece('g1', 'weapon')];
        const ctx = buildPotentialContext({
            inventory,
            shipRole: 'ATTACKER',
            slot: 'weapon',
            selectedStats: [],
            ship,
            getGearPiece: () => undefined,
            getEngineeringStatsForShipType: () => undefined,
        });
        expect(ctx.withShip).toBe(true);
        // afterEngineering with no refits / no engineering = baseStats
        expect(ctx.percentRef.attack).toBe(ship.baseStats.attack);
    });

    it('populates afterGearVector and finalVector from the cached breakdown', () => {
        const ship = makeShip();
        const inventory = [makeMinimalPiece('g1', 'weapon')];
        const ctx = buildPotentialContext({
            inventory,
            shipRole: 'ATTACKER',
            slot: 'weapon',
            selectedStats: [],
            ship,
            getGearPiece: () => undefined,
            getEngineeringStatsForShipType: () => undefined,
        });
        const baseline = ctx.baselinesBySlot.get('weapon')!;
        expect(baseline.afterGearVector).toBeInstanceOf(Float64Array);
        expect(baseline.finalVector).toBeInstanceOf(Float64Array);
        expect(baseline.afterGearVector[STAT_INDEX.attack]).toBe(ship.baseStats.attack);
        expect(baseline.finalVector![STAT_INDEX.attack]).toBe(ship.baseStats.attack);
    });

    it('setCount excludes gear in the slot being baselined', () => {
        const equippedPiece: GearPiece = makeMinimalPiece('eq-weapon', 'weapon', 'DECIMATION');
        const otherPiece: GearPiece = makeMinimalPiece('eq-hull', 'hull', 'SHIELD');
        const ship = makeShip({ equipment: { weapon: 'eq-weapon', hull: 'eq-hull' } });
        const gearById = new Map<string, GearPiece>([
            ['eq-weapon', equippedPiece],
            ['eq-hull', otherPiece],
        ]);
        const inventory = [makeMinimalPiece('g1', 'weapon')];

        const ctx = buildPotentialContext({
            inventory,
            shipRole: 'ATTACKER',
            slot: 'weapon',
            selectedStats: [],
            ship,
            getGearPiece: (id) => gearById.get(id),
            getEngineeringStatsForShipType: () => undefined,
        });

        const baseline = ctx.baselinesBySlot.get('weapon')!;
        const decimationId = ctx.setNameToId.get('DECIMATION')!;
        const shieldId = ctx.setNameToId.get('SHIELD')!;
        // weapon slot excluded → DECIMATION count is 0, SHIELD count is 1
        expect(baseline.setCount[decimationId]).toBe(0);
        expect(baseline.setCount[shieldId]).toBe(1);
    });
});

describe('buildPotentialContext — shared', () => {
    it('reserves setNameToId id=0 for "no set"', () => {
        const inventory = [makeMinimalPiece('g1', 'weapon', 'DECIMATION')];
        const ctx = buildPotentialContext({
            inventory,
            shipRole: 'ATTACKER',
            slot: undefined,
            selectedStats: [],
            ship: undefined,
            getGearPiece: undefined,
            getEngineeringStatsForShipType: undefined,
        });
        expect(ctx.setIdToName[0]).toBe('');
        expect(ctx.setNameToId.get('DECIMATION')).toBeGreaterThan(0);
    });

    it('sizes workspace.setCount to setIdToName.length', () => {
        const inventory = [makeMinimalPiece('g1', 'weapon', 'DECIMATION')];
        const ctx = buildPotentialContext({
            inventory,
            shipRole: 'ATTACKER',
            slot: undefined,
            selectedStats: [],
            ship: undefined,
            getGearPiece: undefined,
            getEngineeringStatsForShipType: undefined,
        });
        expect(ctx.workspace.setCount.length).toBe(ctx.setIdToName.length);
    });
});
