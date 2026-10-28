/**
 * #678 (owner's in-game measurements): Nosorog reflects a share of the hit AS THROWN — the skill
 * percentage of the attacker's attack — not of the HP he lost. Crits, the attacker's Out. Damage
 * Up and Nosorog's own shield change nothing; Nosorog's own Out. Damage Up scales the bounce; a
 * Barrier-nullified hit reflects nothing. The rule lives in `damageReflection.ts`.
 *
 * Measured fight: Belladonna (attack 4598, defence 3647) hits a 16% Nosorog with her 140% active;
 * Nosorog reflected 504 in game. Every case runs with Nosorog on the player side and on the enemy
 * side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import {
    boardInput,
    hitKit,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import { buildShipAbilitiesWithEquipment } from '../../abilities/buildShipAbilitiesWithEquipment';
import { getGearSet } from '../../../constants/gearSets';
import { calculateDamageReduction } from '../../autogear/statResolution';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(678));

const SIDES: Placement[] = ['player', 'enemy'];

/** Nosorog's real parsed passives (the reference data carries the patched 16% text). */
const nosorogReflectPassives = (): ShipSkills['slots'] =>
    realKit('Nosorog').slots.filter((s) => s.slot === 'passive');

/** The passive slot the Reflect gear set builds (its damage-reflection ability). */
const reflectSetPassives = (): ShipSkills['slots'] => {
    const slots = ['weapon', 'hull', 'generator', 'sensor'] as const;
    const pieces: GearPiece[] = slots
        .slice(0, getGearSet('REFLECT')?.minPieces ?? 2)
        .map((slot, i) => ({
            id: `reflect-${i}`,
            slot,
            level: 16,
            stars: 6,
            rarity: 'legendary',
            mainStat: null,
            subStats: [],
            setBonus: 'REFLECT',
        }));
    const built = buildShipAbilitiesWithEquipment(
        {
            id: 'wearer-ship',
            name: 'Wearer',
            rarity: 'legendary',
            faction: 'AURELIAN_SOVEREIGNTY',
            type: 'DEFENDER',
            baseStats: {} as Ship['baseStats'],
            equipment: Object.fromEntries(pieces.map((p) => [p.slot, p.id])),
            implants: {},
            refits: [],
        } as Partial<Ship> as Ship,
        (id) => pieces.find((p) => p.id === id)
    );
    return built.slots.filter((s) => s.slot === 'passive');
};

/** The Reflect gear set's percentage, read off the ability it builds. */
const reflectSetPct = (): number => {
    const config = reflectSetPassives()
        .flatMap((s) => s.abilities)
        .find((a) => a.config.type === 'damage-reflection')?.config;
    if (config?.type !== 'damage-reflection') throw new Error('Reflect set built no reflect');
    return config.pct;
};

const selfAbility = (config: Ability['config'], type: Ability['type']): Ability => ({
    id: `self-${type}`,
    type,
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config,
});

const selfBuff = (buffName: string, parsedEffects: Record<string, number> = {}): Ability =>
    selfAbility(
        {
            type: 'buff',
            buffName,
            parsedEffects,
            stacks: 1,
            isStackable: false,
            duration: 5,
        },
        'buff'
    );

/** Nosorog acts first (his active only touches himself), then takes the hitter's hit. His own
 *  defence is high on purpose: the reflect ignores it. */
const nosorog = (
    active: Ability[] = [selfBuff('Inert Buff')],
    reflect: () => ShipSkills['slots'] = nosorogReflectPassives
): BoardUnit => ({
    id: 'nosorog',
    kit: { slots: [{ slot: 'active', abilities: active }, ...reflect()] },
    position: 'M4',
    speed: 1_000,
    attack: 10_000,
    defence: 5_000,
});

/** Belladonna's measured stats behind a plain 140% active. */
const belladonna = (
    opts: { crit?: boolean; outgoing?: number; attackBuff?: number } = {}
): BoardUnit => ({
    id: 'belladonna',
    kit: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    ...(opts.attackBuff
                        ? [selfBuff('Attack Up III', { attack: opts.attackBuff })]
                        : []),
                    ...(opts.outgoing
                        ? [selfBuff('Out. Damage Up III', { outgoingDamage: opts.outgoing })]
                        : []),
                    ...hitKit(140).slots[0].abilities,
                ],
            },
        ],
    },
    position: 'M4',
    speed: 100,
    attack: 4_598,
    defence: 3_647,
    crit: opts.crit ? 100 : 0,
    critDamage: 50,
});

interface Fight {
    /** Every reflect row Nosorog emitted onto the hitter, in log order. */
    rows: number[];
    /** What the hitter's hit put on Nosorog (the funnel's booked intake). */
    hitIncoming: number;
    shieldAbsorbed: number;
    barrierAbsorbed: number;
}

const fight = (placement: Placement, reflector: BoardUnit, hitter: BoardUnit): Fight => {
    const { input, id } = boardInput(placement, reflector, [], [hitter], 1);
    const ref = id(reflector);
    const hit = id(hitter);
    const bus = createEventBus();
    const rows: number[] = [];
    bus.on('reactive-damage-performed', (e) => {
        if (e.sourceId === ref && e.targetId === hit) rows.push(e.amount);
    });
    const { rounds } = runCombat({ ...input, bus });
    const intake = rounds[0].perActorIncoming?.[ref];
    return {
        rows,
        hitIncoming: intake?.incoming ?? 0,
        shieldAbsorbed: intake?.shieldAbsorbed ?? 0,
        barrierAbsorbed: intake?.barrierAbsorbed ?? 0,
    };
};

/** 16% of Belladonna's 140% hit as thrown, through her own defence. In game Nosorog reflected
 *  504; the model gives 504.4 (#678). */
const MEASURED_REFLECT = 0.16 * 1.4 * 4_598 * (1 - calculateDamageReduction(3_647) / 100);

describe('the Nosorog kit under test', () => {
    it('builds a 16% primary-target reflect from the patch text', () => {
        const reflect = nosorogReflectPassives()
            .flatMap((s) => s.abilities)
            .filter((a) => a.config.type === 'damage-reflection');
        expect(reflect).toHaveLength(1);
        const config = reflect[0].config;
        expect(config.type === 'damage-reflection' && config.pct).toBe(16);
        expect(config.type === 'damage-reflection' && config.requirePrimaryTarget).toBe(true);
    });
});

describe.each(SIDES)('Nosorog on the %s side reflects the hit as thrown (#678)', (placement) => {
    const plain = () => fight(placement, nosorog(), belladonna());

    it("reflects 16% of Belladonna's 140% hit, through her defence", () => {
        const f = plain();
        expect(f.rows).toHaveLength(1);
        expect(f.rows[0]).toBeCloseTo(MEASURED_REFLECT, 0);
    });

    it('a crit grows the hit but not the reflect', () => {
        const base = plain();
        const crit = fight(placement, nosorog(), belladonna({ crit: true }));
        expect(crit.hitIncoming).toBeCloseTo(base.hitIncoming * 1.5, 6);
        expect(crit.rows).toHaveLength(1);
        expect(crit.rows[0]).toBeGreaterThan(0);
        expect(crit.rows[0]).toBeCloseTo(base.rows[0], 6);
    });

    it("the attacker's Out. Damage Up grows the hit but not the reflect", () => {
        const base = plain();
        const buffed = fight(placement, nosorog(), belladonna({ outgoing: 45 }));
        expect(buffed.hitIncoming).toBeCloseTo(base.hitIncoming * 1.45, 6);
        expect(buffed.rows).toHaveLength(1);
        expect(buffed.rows[0]).toBeGreaterThan(0);
        expect(buffed.rows[0]).toBeCloseTo(base.rows[0], 6);
    });

    it("the attacker's Attack Up III plus Legion Discipline III (+65%) scales the reflect by 1.65", () => {
        const base = plain();
        const buffed = fight(placement, nosorog(), belladonna({ attackBuff: 65 }));
        expect(base.rows[0]).toBeGreaterThan(0);
        expect(buffed.rows).toHaveLength(1);
        expect(buffed.rows[0]).toBeGreaterThan(0);
        expect(buffed.rows[0]).toBeCloseTo(base.rows[0] * 1.65, 6);
    });

    it('a shield that soaks the whole hit still reflects in full', () => {
        const base = plain();
        const shielded = fight(
            placement,
            nosorog([selfAbility({ type: 'shield', pct: 50, basis: 'hp' }, 'shield')]),
            belladonna()
        );
        expect(shielded.hitIncoming).toBeGreaterThan(0);
        expect(shielded.shieldAbsorbed).toBeCloseTo(shielded.hitIncoming, 6);
        expect(shielded.rows).toHaveLength(1);
        expect(shielded.rows[0]).toBeGreaterThan(0);
        expect(shielded.rows[0]).toBeCloseTo(base.rows[0], 6);
    });

    it("Nosorog's own Out. Damage Up III scales the reflect by 1.45", () => {
        const base = plain();
        const buffed = fight(
            placement,
            nosorog([selfBuff('Out. Damage Up III', { outgoingDamage: 45 })]),
            belladonna()
        );
        expect(base.rows[0]).toBeGreaterThan(0);
        expect(buffed.rows).toHaveLength(1);
        expect(buffed.rows[0]).toBeCloseTo(base.rows[0] * 1.45, 6);
    });

    it('a Barrier-nullified hit reflects nothing', () => {
        const barriered = fight(placement, nosorog([selfBuff('Barrier')]), belladonna());
        expect(barriered.barrierAbsorbed).toBeGreaterThan(0);
        expect(barriered.rows).toEqual([]);
    });
});

/** The rule is a property of reflect itself, so the gear set's bounce follows it too. */
describe.each(SIDES)(
    'a Reflect gear set wearer on the %s side reflects the hit as thrown',
    (placement) => {
        const wearer = (active?: Ability[]) => nosorog(active, reflectSetPassives);
        const plain = () => fight(placement, wearer(), belladonna());

        it("reflects the set's percentage of Belladonna's 140% hit, through her defence", () => {
            const f = plain();
            expect(f.rows).toHaveLength(1);
            expect(f.rows[0]).toBeCloseTo(
                (reflectSetPct() / 100) * 1.4 * 4_598 * (1 - calculateDamageReduction(3_647) / 100),
                6
            );
        });

        it('a shield that soaks the whole hit still reflects in full', () => {
            const base = plain();
            const shielded = fight(
                placement,
                wearer([selfAbility({ type: 'shield', pct: 50, basis: 'hp' }, 'shield')]),
                belladonna()
            );
            expect(shielded.shieldAbsorbed).toBeCloseTo(shielded.hitIncoming, 6);
            expect(shielded.rows).toHaveLength(1);
            expect(shielded.rows[0]).toBeGreaterThan(0);
            expect(shielded.rows[0]).toBeCloseTo(base.rows[0], 6);
        });

        it("the wearer's own Out. Damage Up III scales the reflect by 1.45", () => {
            const base = plain();
            const buffed = fight(
                placement,
                wearer([selfBuff('Out. Damage Up III', { outgoingDamage: 45 })]),
                belladonna()
            );
            expect(base.rows[0]).toBeGreaterThan(0);
            expect(buffed.rows[0]).toBeCloseTo(base.rows[0] * 1.45, 6);
        });

        it('a crit grows the hit but not the reflect', () => {
            const base = plain();
            const crit = fight(placement, wearer(), belladonna({ crit: true }));
            expect(crit.hitIncoming).toBeCloseTo(base.hitIncoming * 1.5, 6);
            expect(crit.rows).toHaveLength(1);
            expect(crit.rows[0]).toBeGreaterThan(0);
            expect(crit.rows[0]).toBeCloseTo(base.rows[0], 6);
        });

        it("the attacker's Out. Damage Up grows the hit but not the reflect", () => {
            const base = plain();
            const buffed = fight(placement, wearer(), belladonna({ outgoing: 45 }));
            expect(buffed.hitIncoming).toBeCloseTo(base.hitIncoming * 1.45, 6);
            expect(buffed.rows[0]).toBeCloseTo(base.rows[0], 6);
        });
    }
);
