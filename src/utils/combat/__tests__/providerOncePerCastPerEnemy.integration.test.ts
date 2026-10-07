/**
 * Provider R2: "When another ally inflicts a debuff onto an enemy, this unit deals 50% damage to
 * that enemy that cannot critically hit and inflicts Crit Rate Down II for 1 turn." Measured in
 * game: an ally Curator's active landing Attack Down III and Crit Power Down III on each of three
 * enemies gave three Provider hits, one per enemy.
 *
 * Both halves are `oncePerRootCast: 'per-victim'`: one hit and one Crit Rate Down II per (ally skill
 * cast, debuffed enemy), however many debuffs the cast landed on that enemy; a second cast is a
 * second hit.
 *
 * Real parsed kits (buildTraceShip, refit 4). Curator fires Pattern-Circle-Range-1, striking M4,
 * M3 and T4. Run with Provider on the player side and on the enemy side.
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

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(3));

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

const provider = (): BoardUnit => ({
    id: 'provider',
    kit: kit('Provider', ['passive']),
    position: 'M4',
    speed: 1,
    attack: 1000,
    hacking: 1e6,
});
const curator = (): BoardUnit => ({
    id: 'curator',
    kit: kit('Curator', ['active']),
    position: 'M3',
    speed: 200,
    attack: 1000,
    hacking: 1e6,
    pattern: parsePattern('Pattern-Circle-Range-1'),
});
const enemies = (): BoardUnit[] =>
    (['M4', 'M3', 'T4'] as const).map((position, i) => ({
        id: `enemy-${'abc'[i]}`,
        kit: NO_KIT,
        position,
        speed: 1,
    }));

const run = (placement: Placement, rounds: number) => {
    const carrier = provider();
    const opponents = enemies();
    const { input, id } = boardInput(placement, carrier, [curator()], opponents, rounds);
    const hits: Record<string, number> = {};
    const crd: Record<string, number> = {};
    let landed = 0;
    const bus = createEventBus();
    bus.on(
        'reactive-damage-performed',
        (e: Extract<CombatEvent, { type: 'reactive-damage-performed' }>) => {
            if (e.sourceId === id(carrier)) hits[e.targetId] = (hits[e.targetId] ?? 0) + 1;
        }
    );
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.sourceId === 'curator') landed++;
        if (e.sourceId === id(carrier) && e.buffName.startsWith('Crit Rate Down'))
            crd[e.targetId] = (crd[e.targetId] ?? 0) + 1;
    });
    runCombat({ ...input, bus });
    return { hits, crd, landed, ids: opponents.map(id) };
};

describe.each<Placement>(['player', 'enemy'])('Provider on the %s side', (placement) => {
    it("an ally's cast landing two debuffs on each of three enemies: one hit and one Crit Rate Down per enemy", () => {
        const { hits, crd, landed, ids } = run(placement, 1);
        // Instrument: six debuffs really landed.
        expect(landed).toBe(6);
        expect(hits).toEqual(Object.fromEntries(ids.map((i) => [i, 1])));
        expect(crd).toEqual(Object.fromEntries(ids.map((i) => [i, 1])));
    });

    it('two casts: two hits per enemy', () => {
        const { hits, landed, ids } = run(placement, 2);
        expect(landed).toBe(12);
        expect(hits).toEqual(Object.fromEntries(ids.map((i) => [i, 2])));
    });
});
