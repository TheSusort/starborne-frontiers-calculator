/**
 * Sefuba R4: "When this Unit purges a buff from an enemy, it repairs 8% of its max HP for each
 * buff removed and also purges 1 extra buff from the enemy." Measured in game: her active hitting
 * three enemies purged one buff from EACH, then repaired her ONCE, then the extra purge removed one
 * more buff from each of the three.
 *
 * Model: one repair per purge cast, 8% of the buffs the cast's purges removed across every struck
 * enemy, resolved after the first purge wave and before the extra purges. The extra purges add
 * nothing to the repair and wake nothing (no Sefuba repair, no Salvation repair).
 * Salvation's "When a buff is purged from an ally, repairs that ally 5%" still repairs each victim
 * of the first wave once.
 *
 * Real parsed Sefuba kit (buildTraceShip, refit 4). Her pattern strikes M4, M3 and T4. The enemy
 * side's buffers act first and hold removable self-buffs. Run on both sides.
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
const VICTIM_HP = 100_000;

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
/** An active skill that only grants its caster `n` removable buffs. */
const buffer = (n: number): ShipSkills => ({
    slots: [{ slot: 'active', abilities: BUFF_NAMES.slice(0, n).map(selfBuff) }],
});

const POSITIONS = ['M4', 'M3', 'T4'] as const;
const victims = (buffs: number[], extra: Partial<BoardUnit> = {}): BoardUnit[] =>
    buffs.map((n, i) => ({
        id: `victim-${i}`,
        kit: buffer(n),
        position: POSITIONS[i],
        speed: 500,
        hp: VICTIM_HP,
        ...extra,
    }));

const sefuba = (): BoardUnit => ({
    id: 'sefuba',
    kit: kit('Sefuba', ['active', 'passive']),
    position: 'M4',
    speed: 100,
    hp: SEFUBA_HP,
    attack: 0,
    pattern: parsePattern('Pattern-Circle-Range-1'),
});

const run = (placement: Placement, opponents: BoardUnit[], rounds = 1) => {
    const carrier = sefuba();
    const { input, id } = boardInput(placement, carrier, [], opponents, rounds);
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
                a.currentHp = a.stats.hp * 0.5;
            }
        },
    });
    const buffsLeft = (u: BoardUnit): number => engine!.timedAbilityStatuses('self', id(u)).length;
    const hpPct = (u: BoardUnit): number => {
        const a = actors.get(id(u))!;
        return (100 * a.currentHp) / a.stats.hp;
    };
    return { purges, repairs, buffsLeft, hpPct, carrier };
};

describe.each<Placement>(['player', 'enemy'])('Sefuba on the %s side', (placement) => {
    it('three struck enemies: one purge each, then ONE repair of 8% per buff removed', () => {
        const opponents = victims([4, 4, 4]);
        const { purges, repairs, hpPct, carrier } = run(placement, opponents);
        // Instrument: the first wave really purged one buff from each of the three.
        expect(purges.map((p) => p.count)).toEqual([1, 1, 1]);
        expect(repairs).toHaveLength(1);
        expect(hpPct(carrier)).toBeCloseTo(50 + 24, 5);
    });

    it('the extra purge then removes one more buff from each of the three', () => {
        const opponents = victims([4, 4, 4]);
        const { buffsLeft } = run(placement, opponents);
        for (const o of opponents) expect(buffsLeft(o)).toBe(4 - 1 - 1);
    });

    it('the extra purges do not add to the repair', () => {
        // Positive control on this board: the extra purges really fire (above), and the repair
        // is still 8% x 2 buffs removed by the first wave when only two enemies hold buffs.
        const opponents = victims([4, 4, 0]);
        const { purges, repairs, hpPct, carrier } = run(placement, opponents);
        expect(purges.map((p) => p.count)).toEqual([1, 1]);
        expect(repairs).toHaveLength(1);
        expect(hpPct(carrier)).toBeCloseTo(50 + 16, 5);
    });

    it('one struck enemy: one repair of 8% (unchanged)', () => {
        const { repairs, hpPct, carrier } = run(placement, victims([4]));
        expect(repairs).toHaveLength(1);
        expect(hpPct(carrier)).toBeCloseTo(58, 5);
    });

    it('no struck enemy holds a buff: nothing purged, no repair', () => {
        const { purges, repairs, hpPct, carrier } = run(placement, victims([0, 0, 0]));
        expect(purges).toEqual([]);
        expect(repairs).toEqual([]);
        expect(hpPct(carrier)).toBeCloseTo(50, 5);
    });

    it('two casts: one repair each', () => {
        // A 1-buff victim re-buffs on its turn each round, so both of her casts purge.
        const { repairs } = run(placement, victims([2, 2, 2]), 2);
        expect(repairs).toHaveLength(2);
    });
});

describe.each<Placement>(['player', 'enemy'])(
    "Salvation beside Sefuba's victims, %s-side Sefuba",
    (placement) => {
        const HP = 1_000_000;
        const salvation = (): BoardUnit => ({
            id: 'salvation',
            kit: {
                slots: [
                    ...buffer(4).slots,
                    ...kit('Salvation', ['passive']).slots.filter((s) => s.slot === 'passive'),
                ],
            },
            position: 'M4',
            speed: 500,
            hp: HP,
        });

        it('repairs each victim of the first wave once (5%), not again for the extra purge', () => {
            const opponents = [
                salvation(),
                ...victims([4, 4], { hp: HP }).map((v, i) => ({
                    ...v,
                    position: POSITIONS[i + 1],
                })),
            ];
            const { purges, hpPct, buffsLeft } = run(placement, opponents);
            // Instrument: the first wave struck all three, and the extra purge really removed more.
            expect(purges.map((p) => p.count)).toEqual([1, 1, 1]);
            for (const o of opponents) expect(buffsLeft(o)).toBe(4 - 1 - 1);
            // Each victim starts at 50% and is repaired 5% of Salvation's max HP once.
            for (const o of opponents) expect(hpPct(o)).toBeCloseTo(55, 5);
        });
    }
);
