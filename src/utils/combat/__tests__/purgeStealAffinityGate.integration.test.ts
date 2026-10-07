/**
 * Purges and buff steals land like an 'apply' debuff: no hacking/security roll, but they do not
 * land at all on a target the caster is at an affinity DISADVANTAGE against (owner ruling, measured
 * in game: a disadvantaged Sefuba removed nothing). The gate is per target, so one skill reaching
 * three enemies purges the two it is not disadvantaged against.
 *
 * A purge that removes nothing wakes nothing: no Sefuba repair, no extra purge.
 *
 * Charge removal and enemy debuff-duration extension follow the same rule and are pinned by
 * chargeRemovalAffinityGate / debuffExtensionAffinityImmunity.
 *
 * Thermal is at disadvantage against electric, at advantage against chemical, neutral against
 * antimatter. Real parsed kits (buildTraceShip, refit 4); both placements.
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
import { boardInput, type BoardUnit, type Placement } from '../__testutils__/realKitBoard';
import type { Ability, ShipSkills, SkillSlot } from '../../../types/abilities';
import type { AffinityName } from '../../../types/ship';
import type { CombatActor } from '../state';
import type { StatusEngine } from '../statusEngine';

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

let idc = 0;
const selfBuff = (name: string): Ability => ({
    id: `sb${++idc}`,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: name,
        parsedEffects: { attack: 10 },
        stacks: 1,
        isStackable: false,
        duration: 99,
    },
});
const BUFF_NAMES = ['Attack Up', 'Defense Up', 'Speed Up', 'Crit Up'];
const buffer = (n: number): ShipSkills => ({
    slots: [{ slot: 'active', abilities: BUFF_NAMES.slice(0, n).map(selfBuff) }],
});

const POSITIONS = ['M4', 'M3', 'T4'] as const;
const victims = (affinities: AffinityName[], buffs = 3): BoardUnit[] =>
    affinities.map((affinity, i) => ({
        id: `victim-${i}`,
        kit: buffer(buffs),
        position: POSITIONS[i],
        speed: 500,
        hp: 100_000,
        affinity,
    }));

const CIRCLE = parsePattern('Pattern-Circle-Range-1');

const run = (placement: Placement, carrier: BoardUnit, opponents: BoardUnit[]) => {
    const { input, id } = boardInput(placement, carrier, [], opponents, 1);
    const purges: Extract<CombatEvent, { type: 'purge-performed' }>[] = [];
    const steals: Extract<CombatEvent, { type: 'steal-performed' }>[] = [];
    const repairs: Extract<CombatEvent, { type: 'reactive-heal-performed' }>[] = [];
    const bus = createEventBus();
    bus.on('purge-performed', (e) => purges.push(e));
    bus.on('steal-performed', (e) => steals.push(e));
    bus.on('reactive-heal-performed', (e) => {
        if (e.casterId === id(carrier)) repairs.push(e);
    });
    let engine: StatusEngine | undefined;
    const actors = new Map<string, CombatActor>();
    runCombat({
        ...input,
        bus,
        __testTapStatusEngine: (e) => {
            engine = e;
        },
        __testTapActors: (all: CombatActor[]) => {
            for (const a of all) {
                actors.set(a.id, a);
                a.currentHp = a.stats.hp * 0.5;
            }
        },
    });
    const buffsLeft = (u: BoardUnit): number => engine!.timedAbilityStatuses('self', id(u)).length;
    return { purges, steals, repairs, buffsLeft, id };
};

describe.each<Placement>(['player', 'enemy'])('cast purge (Sefuba), %s side', (placement) => {
    const sefuba = (): BoardUnit => ({
        id: 'sefuba',
        kit: kit('Sefuba', ['active', 'passive']),
        position: 'M4',
        speed: 100,
        hp: 10_000,
        affinity: 'thermal',
        pattern: CIRCLE,
    });

    it('disadvantaged against every struck enemy: nothing removed, no repair, no extra purge', () => {
        const opponents = victims(['electric', 'electric', 'electric']);
        const { purges, repairs, buffsLeft } = run(placement, sefuba(), opponents);
        expect(purges).toEqual([]);
        expect(repairs).toEqual([]);
        for (const o of opponents) expect(buffsLeft(o)).toBe(3);
    });

    it('per target: the disadvantaged enemy keeps its buffs, the others are purged and the repair counts only them', () => {
        const opponents = victims(['electric', 'chemical', 'antimatter']);
        const { purges, repairs, buffsLeft, id } = run(placement, sefuba(), opponents);
        expect(purges.map((p) => p.targetId).sort()).toEqual(
            [id(opponents[1]), id(opponents[2])].sort()
        );
        expect(repairs).toHaveLength(1);
        expect(buffsLeft(opponents[0])).toBe(3);
        // purge 1 + extra purge 1 on each of the two it reached
        expect(buffsLeft(opponents[1])).toBe(1);
        expect(buffsLeft(opponents[2])).toBe(1);
    });

    it('control: advantage and neutral land (the instrument can report the opposite)', () => {
        const opponents = victims(['chemical', 'antimatter', 'thermal']);
        const { purges } = run(placement, sefuba(), opponents);
        expect(purges).toHaveLength(3);
    });
});

describe.each<Placement>(['player', 'enemy'])('reactive purge (Rhodium), %s side', (placement) => {
    const rhodium = (): BoardUnit => ({
        id: 'rhodium',
        kit: kit('Rhodium', ['passive']),
        position: 'M4',
        speed: 100,
        hp: 100_000,
        affinity: 'thermal',
    });

    it('end-of-round purge from the enemy with the most buffs: nothing when disadvantaged', () => {
        const opponents = victims(['electric'], 4);
        const { purges, buffsLeft } = run(placement, rhodium(), opponents);
        expect(purges).toEqual([]);
        expect(buffsLeft(opponents[0])).toBe(4);
    });

    it('control: a neutral enemy loses its two buffs', () => {
        const opponents = victims(['antimatter'], 4);
        const { purges, buffsLeft } = run(placement, rhodium(), opponents);
        expect(purges.map((p) => p.count)).toEqual([2]);
        expect(buffsLeft(opponents[0])).toBe(2);
    });
});

describe.each<Placement>(['player', 'enemy'])('buff steal (Tithonus), %s side', (placement) => {
    const tithonus = (): BoardUnit => ({
        id: 'tithonus',
        kit: kit('Tithonus', ['active', 'charged']),
        position: 'M4',
        speed: 100,
        hp: 100_000,
        attack: 1000,
        affinity: 'thermal',
        chargeCount: 3,
        startCharged: true,
    });

    it('disadvantaged: no steal and no purge', () => {
        const { steals, purges } = run(placement, tithonus(), victims(['electric']));
        expect(steals).toEqual([]);
        expect(purges).toEqual([]);
    });

    it('control: neutral target — steal and purge both land', () => {
        const { steals, purges } = run(placement, tithonus(), victims(['antimatter']));
        expect(steals).toHaveLength(1);
        expect(purges).toHaveLength(1);
    });

    it('advantaged target — steal and purge both land', () => {
        const { steals, purges } = run(placement, tithonus(), victims(['chemical']));
        expect(steals).toHaveLength(1);
        expect(purges).toHaveLength(1);
    });
});
