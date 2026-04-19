import { describe, it, expect } from 'vitest';
import type { StatPriority } from '../../../../types/autogear';
import type { GearPiece } from '../../../../types/gear';
import { GEAR_SLOT_ORDER, type GearSlotName } from '../../../../constants';
import { calculateTotalScore } from '../../scoring';
import { fastScore } from '../fastScore';
import { buildFastScoringContext } from '../context';
import {
    generateTestInventory,
    makeTestShip,
    makeTestEngineering,
    seededRandom,
} from './fixtures/testInventory';

const SCORE_REL_TOLERANCE = 1e-6;

function scoresEqual(a: number, b: number): boolean {
    const scale = Math.max(1, Math.abs(a), Math.abs(b));
    return Math.abs(a - b) <= SCORE_REL_TOLERANCE * scale;
}

interface Scenario {
    seed: number;
    priorities: StatPriority[];
    role: 'ATTACKER' | 'DEFENDER' | 'DEBUFFER' | undefined;
    arenaModifiers: Record<string, number> | null;
    equipmentMask: number;
}

function makeScenarios(n: number, startSeed: number): Scenario[] {
    const scenarios: Scenario[] = [];
    const roles: Scenario['role'][] = ['ATTACKER', 'DEFENDER', 'DEBUFFER', undefined];
    for (let i = 0; i < n; i++) {
        const rnd = seededRandom(startSeed + i);
        scenarios.push({
            seed: startSeed + i,
            priorities: [
                { stat: 'attack', weight: 1 + Math.floor(rnd() * 3) },
                { stat: 'hp', weight: 1 + Math.floor(rnd() * 3) },
            ],
            role: roles[Math.floor(rnd() * roles.length)],
            arenaModifiers: rnd() < 0.3 ? { attack: 10, hp: -5 } : null,
            equipmentMask: Math.floor(rnd() * 64),
        });
    }
    return scenarios;
}

describe('fastScore equivalence with calculateTotalScore', () => {
    const ship = makeTestShip();
    const engineering = makeTestEngineering();
    const inventory = generateTestInventory(100, 30);
    const getGearPiece = (id: string) => inventory.find((p) => p.id === id);
    const getEng = (type: string) => (type === 'ATTACKER' ? engineering : undefined);

    it('matches slow path for 50 randomized scenarios', () => {
        const scenarios = makeScenarios(50, 1);

        for (const sc of scenarios) {
            const ctx = buildFastScoringContext({
                ship,
                availableInventory: inventory,
                priorities: sc.priorities,
                shipRole: sc.role,
                engineeringStats: engineering,
                arenaModifiers: sc.arenaModifiers ?? undefined,
                resolveGearPiece: getGearPiece,
            });

            const rnd = seededRandom(sc.seed);
            const equipment: Partial<Record<GearSlotName, string>> = {};
            const gearIds: number[] = [];
            for (let s = 0; s < ctx.gearSlotOrder.length; s++) {
                const slotName = ctx.gearSlotOrder[s];
                const bit = (sc.equipmentMask >> s) & 1;
                if (!bit) {
                    gearIds.push(-1);
                    continue;
                }
                const candidates = inventory.filter((p) => p.slot === slotName);
                if (candidates.length === 0) {
                    gearIds.push(-1);
                    continue;
                }
                const pick = candidates[Math.floor(rnd() * candidates.length)];
                equipment[slotName] = pick.id;
                gearIds.push(ctx.gearRegistry.idOf.get(pick.id)!);
            }

            const implantIds: number[] = [];

            const slowScore = calculateTotalScore(
                ship,
                equipment,
                sc.priorities,
                getGearPiece,
                getEng,
                sc.role,
                undefined,
                undefined,
                false,
                sc.arenaModifiers
            );
            const fastResult = fastScore(ctx, gearIds, implantIds);

            if (!scoresEqual(slowScore, fastResult.fitness)) {
                console.error('Divergence', { sc, equipment, slowScore, fast: fastResult.fitness });
            }
            expect(scoresEqual(slowScore, fastResult.fitness)).toBe(true);
        }
    });

    it('covers explicit set bonus thresholds (2, 4 pieces) for each test set', () => {
        const setNames = ['SHIELD', 'DECIMATION', 'BOOST', 'HARDENED'] as const;
        const gearSlots = GEAR_SLOT_ORDER;

        for (const setName of setNames) {
            for (const pieceCount of [2, 4]) {
                const specific: GearPiece[] = [];
                for (let i = 0; i < pieceCount && i < gearSlots.length; i++) {
                    specific.push({
                        id: `set-${setName}-${i}`,
                        slot: gearSlots[i],
                        setBonus: setName,
                        rarity: 'legendary',
                        level: 16,
                        stars: 6,
                        mainStat: { name: 'attack', value: 500, type: 'flat' },
                        subStats: [{ name: 'hp', value: 1000, type: 'flat' }],
                    } as unknown as GearPiece);
                }

                const lookup = (id: string) => specific.find((p) => p.id === id);

                const equipment: Partial<Record<GearSlotName, string>> = {};
                for (const p of specific) equipment[p.slot] = p.id;

                const ctx = buildFastScoringContext({
                    ship,
                    availableInventory: specific,
                    priorities: [{ stat: 'attack', weight: 1 }],
                    shipRole: 'ATTACKER',
                    engineeringStats: engineering,
                    arenaModifiers: undefined,
                    resolveGearPiece: lookup,
                });
                const gearIds = ctx.gearSlotOrder.map((slot) => {
                    const id = equipment[slot];
                    return id ? ctx.gearRegistry.idOf.get(id)! : -1;
                });

                const slowScore = calculateTotalScore(
                    ship,
                    equipment,
                    [{ stat: 'attack', weight: 1 }],
                    lookup,
                    getEng,
                    'ATTACKER',
                    undefined,
                    undefined,
                    false,
                    null
                );
                const fast = fastScore(ctx, gearIds, []);

                expect(
                    scoresEqual(slowScore, fast.fitness),
                    `set=${setName} pieces=${pieceCount} slow=${slowScore} fast=${fast.fitness}`
                ).toBe(true);
            }
        }
    });

    it('cache returns same fitness on repeated call with identical ids', () => {
        const ctx = buildFastScoringContext({
            ship,
            availableInventory: inventory,
            priorities: [{ stat: 'attack', weight: 1 }],
            shipRole: 'ATTACKER',
            engineeringStats: engineering,
            arenaModifiers: undefined,
            resolveGearPiece: getGearPiece,
        });
        const gearIds = ctx.gearSlotOrder.map(() => -1);
        gearIds[0] = ctx.gearRegistry.idOf.get(
            inventory.filter((p) => p.slot === ctx.gearSlotOrder[0])[0].id
        )!;
        const first = fastScore(ctx, gearIds, []);
        const second = fastScore(ctx, gearIds, []);
        expect(second.fitness).toBe(first.fitness);
        expect(ctx.cache.size).toBeGreaterThan(0);
    });

    it('equivalence when GA is not optimizing implants but ship has them equipped', () => {
        const implantPiece = {
            id: 'ship-implant-1',
            slot: 'implant_major',
            setBonus: null,
            rarity: 'legendary',
            level: 16,
            stars: 6,
            mainStat: null,
            subStats: [{ name: 'attack', value: 200, type: 'flat' }],
        } as unknown as GearPiece;
        const shipWithImplants = makeTestShip({
            implants: { implant_major: implantPiece.id },
        });
        const gearInventory = inventory;

        const lookup = (id: string): GearPiece | undefined =>
            id === implantPiece.id ? implantPiece : gearInventory.find((p) => p.id === id);

        const ctx = buildFastScoringContext({
            ship: shipWithImplants,
            availableInventory: gearInventory,
            priorities: [{ stat: 'attack', weight: 1 }],
            shipRole: 'ATTACKER',
            engineeringStats: engineering,
            arenaModifiers: undefined,
            resolveGearPiece: lookup,
        });

        expect(ctx.optimizingImplants).toBe(false);
        expect(ctx.fixedImplantIds.length).toBe(1);

        const gearIds = ctx.gearSlotOrder.map(() => -1);
        const slow = calculateTotalScore(
            shipWithImplants,
            {},
            [{ stat: 'attack', weight: 1 }],
            lookup,
            getEng,
            'ATTACKER',
            undefined,
            undefined,
            false,
            null
        );
        const fast = fastScore(ctx, gearIds, []);
        expect(scoresEqual(slow, fast.fitness)).toBe(true);
    });

    it('equivalence holds with arena modifiers active', () => {
        const ctx = buildFastScoringContext({
            ship,
            availableInventory: inventory,
            priorities: [{ stat: 'attack', weight: 1 }],
            shipRole: 'ATTACKER',
            engineeringStats: engineering,
            arenaModifiers: { attack: 25, hp: -10 },
            resolveGearPiece: getGearPiece,
        });
        const equipment: Partial<Record<GearSlotName, string>> = { weapon: inventory[0].id };
        const gearIds = ctx.gearSlotOrder.map((slot) =>
            slot === 'weapon' ? ctx.gearRegistry.idOf.get(inventory[0].id)! : -1
        );
        const slowScore = calculateTotalScore(
            ship,
            equipment,
            [{ stat: 'attack', weight: 1 }],
            getGearPiece,
            getEng,
            'ATTACKER',
            undefined,
            undefined,
            false,
            { attack: 25, hp: -10 }
        );
        const fastResult = fastScore(ctx, gearIds, []);
        expect(scoresEqual(slowScore, fastResult.fitness)).toBe(true);
    });
});
