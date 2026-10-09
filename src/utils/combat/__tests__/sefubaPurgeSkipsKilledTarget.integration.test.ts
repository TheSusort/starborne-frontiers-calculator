/**
 * Sefuba's purge is written after her damage, so it lands after a hit that may have destroyed its
 * victim. A victim the hit KILLED is not purged and wakes no repair; a surviving victim is purged
 * and repairs her as usual.
 *
 * Real parsed Sefuba kit (buildTraceShip, refit 4). Her pattern strikes M4 and M3. The enemy side's
 * buffers act first and hold removable self-buffs. Run on both sides.
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
import type { CombatActor } from '../state';
import type { StatusEngine } from '../statusEngine';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(3));

const SEFUBA_HP = 10_000;
const SURVIVOR_HP = 1_000_000_000;
const DOOMED_HP = 1;

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
/** An active skill that only grants its caster four removable buffs. */
const buffer = (): ShipSkills => ({
    slots: [{ slot: 'active', abilities: BUFF_NAMES.map(selfBuff) }],
});

const POSITIONS = ['M4', 'M3'] as const;
const victims = (hps: number[]): BoardUnit[] =>
    hps.map((hp, i) => ({
        id: `victim-${i}`,
        kit: buffer(),
        position: POSITIONS[i],
        speed: 500,
        hp,
    }));

const sefuba = (): BoardUnit => ({
    id: 'sefuba',
    kit: kit('Sefuba', ['active', 'passive']),
    position: 'M4',
    speed: 100,
    hp: SEFUBA_HP,
    attack: 20_000,
    pattern: parsePattern('Pattern-Circle-Range-1'),
});

const run = (placement: Placement, opponents: BoardUnit[]) => {
    const carrier = sefuba();
    const { input, id } = boardInput(placement, carrier, [], opponents, 1);
    const purges: Extract<CombatEvent, { type: 'purge-performed' }>[] = [];
    const repairs: Extract<CombatEvent, { type: 'reactive-heal-performed' }>[] = [];
    const bus = createEventBus();
    bus.on('purge-performed', (e) => purges.push(e));
    bus.on('reactive-heal-performed', (e) => {
        if (e.casterId === id(carrier)) repairs.push(e);
    });
    const actors = new Map<string, CombatActor>();
    let engine: StatusEngine | undefined;
    runCombat({
        ...input,
        bus,
        __testTapStatusEngine: (e) => {
            engine = e;
        },
        __testTapActors: (all: CombatActor[]) => {
            for (const a of all) {
                actors.set(a.id, a);
                if (a.id === id(carrier)) a.currentHp = a.stats.hp * 0.5;
            }
        },
    });
    const buffsLeft = (u: BoardUnit): number => engine!.timedAbilityStatuses('self', id(u)).length;
    const hpPct = (u: BoardUnit): number => {
        const a = actors.get(id(u))!;
        return (100 * a.currentHp) / a.stats.hp;
    };
    return { purges, repairs, buffsLeft, hpPct, carrier, id };
};

describe.each<Placement>(['player', 'enemy'])('Sefuba on the %s side', (placement) => {
    it('control: when every struck enemy survives, each is purged and she repairs 12% per buff', () => {
        const opponents = victims([SURVIVOR_HP, SURVIVOR_HP]);
        const { purges, repairs, hpPct, carrier, buffsLeft } = run(placement, opponents);
        expect(purges.map((p) => p.count)).toEqual([1, 1]);
        for (const o of opponents) expect(buffsLeft(o)).toBe(4 - 1 - 1);
        expect(repairs).toHaveLength(1);
        expect(hpPct(carrier)).toBeCloseTo(50 + 24, 5);
    });

    it('an enemy the hit kills is not purged and adds nothing to the repair', () => {
        const opponents = victims([DOOMED_HP, SURVIVOR_HP]);
        const {
            purges,
            repairs,
            hpPct,
            carrier,
            buffsLeft,
            id,
            hpPct: pct,
        } = run(placement, opponents);
        // Instrument: the doomed enemy really was struck dead, holding the buffs it gave itself.
        expect(pct(opponents[0])).toBe(0);
        expect(buffsLeft(opponents[0])).toBe(4);
        expect(purges.map((p) => p.targetId)).toEqual([id(opponents[1])]);
        expect(buffsLeft(opponents[1])).toBe(4 - 1 - 1);
        expect(repairs).toHaveLength(1);
        expect(hpPct(carrier)).toBeCloseTo(50 + 12, 5);
    });

    it('every struck enemy killed: no purge, no repair', () => {
        const opponents = victims([DOOMED_HP, DOOMED_HP]);
        const { purges, repairs, hpPct, carrier } = run(placement, opponents);
        expect(purges).toEqual([]);
        expect(repairs).toEqual([]);
        expect(hpPct(carrier)).toBeCloseTo(50, 5);
    });
});
