/**
 * Hayyan R4: "When a debuff is inflicted on an ally, this Unit repairs the ally for 6% of this
 * Unit's max HP." Measured in game: an enemy Curator's active ("60% damage to all enemies, then
 * inflicts Attack Down III and Crit Power Down III") debuffing Lev twice repaired Lev ONCE.
 *
 * The repair fires at most once per (skill cast, debuffed ally) — `oncePerRootCast: 'per-victim'`
 * keyed on the debuffed ally — not once per debuff. Three debuffed allies are three repairs, one
 * each; two casts are two repairs.
 *
 * Real parsed kits (buildTraceShip). Curator's pattern strikes M4, M3 and T4. Hayyan sits in the
 * struck group on the player side and on the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern } from '../../targetingParser';
import { boardInput, NO_KIT, type BoardUnit, type Placement } from '../__testutils__/realKitBoard';
import type { ShipSkills, SkillSlot } from '../../../types/abilities';
import type { CombatActor } from '../state';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(3));

const HP = 100_000;
const START = 0.5;

const kit = (ship: string, slots: SkillSlot[]): ShipSkills => {
    const built = buildTraceShip(ship, { refitLevel: 4 });
    if (!built) throw new Error(`${ship} missing from reference data`);
    const full = buildShipAbilities(built);
    const narrowed = full.slots.filter((s) => slots.includes(s.slot));
    return {
        ...full,
        slots: narrowed.some((s) => s.slot === 'active')
            ? narrowed
            : [{ slot: 'active', abilities: [] }, ...narrowed],
    };
};

const hayyan = (): BoardUnit => ({
    id: 'hayyan',
    kit: kit('Hayyan', ['passive']),
    position: 'M4',
    speed: 1,
    hp: HP,
});
const ally = (id: string, position: 'M3' | 'T4'): BoardUnit => ({
    id,
    kit: NO_KIT,
    position,
    speed: 1,
    hp: HP,
});
/** Curator strikes the three allies; it lands every debuff (huge hacking, 0 security). */
const curator = (): BoardUnit => ({
    id: 'curator',
    kit: kit('Curator', ['active']),
    position: 'M3',
    speed: 200,
    attack: 0,
    hacking: 1e6,
    pattern: parsePattern('Pattern-Circle-Range-1'),
});

const run = (placement: Placement, rounds: number) => {
    const carrier = hayyan();
    const allies = [ally('lev', 'M3'), ally('third', 'T4')];
    const opp = curator();
    const { input, id } = boardInput(placement, carrier, allies, [opp], rounds);
    const debuffs: Record<string, number> = {};
    const bus = createEventBus();
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.sourceId === id(opp)) debuffs[e.targetId] = (debuffs[e.targetId] ?? 0) + 1;
    });
    const actors = new Map<string, CombatActor>();
    runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            for (const a of all) {
                actors.set(a.id, a);
                if (id(opp) !== a.id) a.currentHp = a.stats.hp * START;
            }
        },
    });
    /** Repairs a unit received, in units of one repair (6% of Hayyan's max HP). */
    const repairs = (unit: BoardUnit): number =>
        (actors.get(id(unit))!.currentHp - HP * START) / (HP * 0.06);
    return { debuffs, repairs, id, carrier, allies };
};

describe.each<Placement>(['player', 'enemy'])('Hayyan on the %s side', (placement) => {
    it('two debuffs from one cast on an ally: ONE repair', () => {
        const { debuffs, repairs, id, allies } = run(placement, 1);
        // Instrument: the cast really landed both debuffs on this ally.
        expect(debuffs[id(allies[0])]).toBe(2);
        expect(repairs(allies[0])).toBeCloseTo(1, 5);
    });

    it('three debuffed allies: one repair each (Hayyan herself included)', () => {
        const { repairs, carrier, allies } = run(placement, 1);
        expect(repairs(carrier)).toBeCloseTo(1, 5);
        for (const a of allies) expect(repairs(a)).toBeCloseTo(1, 5);
    });

    it('two casts: two repairs per ally', () => {
        const { debuffs, repairs, id, allies } = run(placement, 2);
        expect(debuffs[id(allies[0])]).toBe(4);
        expect(repairs(allies[0])).toBeCloseTo(2, 5);
    });
});
