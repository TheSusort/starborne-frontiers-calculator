/**
 * "When a debuff is inflicted on an ally" (Hayyan) and "When debuffed" (the Firewall implant) also
 * hear damage-over-time landings: every DoT stack is a separate debuff (rulings 26/28), and an
 * incoming effect rolls once per occurrence, so Firewall's proc chance is drawn per stack.
 *  - Hayyan: Snakeroot's "2 stacks of Corrosion" on her ally → ONE 6% repair, because her repair
 *    is once per (skill cast, debuffed ally) however many debuffs the cast landed on that ally
 *    (`oncePerRootCast: 'per-victim'`). Her clause says "inflicted", so an APPLIED DoT (the
 *    Burner set's Inferno) repairs nothing, as an applied debuff never did.
 *  - Firewall: no verb in its text, so inflicted and applied DoTs both count.
 *
 * Real parsed kits (buildTraceShip, refit 4): Hayyan's passive, Snakeroot's active; Firewall via
 * the real equipment registry. Mounted on both sides; the inflicter is faster and hits the front
 * ship (M4).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilitiesWithEquipment } from '../../abilities/buildShipAbilitiesWithEquipment';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import type { CombatActor } from '../state';
import { mirrorBoard, realSlots, ShipSpec, MirrorTeams } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

type Inflicter = 'snakeroot' | 'named' | 'applied-inferno' | 'none';

const oneClause = (ability: Omit<Ability, 'id'>): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [{ id: 'inflicter-clause', ...ability }] }],
});

const inflicterSkills = (kind: Inflicter): ShipSkills | undefined => {
    switch (kind) {
        case 'snakeroot':
            return { slots: realSlots('Snakeroot', ['active']) };
        case 'named':
            return oneClause({
                type: 'debuff',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [],
                config: {
                    type: 'debuff',
                    buffName: 'Attack Down II',
                    parsedEffects: {},
                    stacks: 1,
                    isStackable: false,
                    application: 'inflict',
                    duration: 2,
                },
            });
        // The Burner set's shape: "Applies Inferno" rides the ship's own damage reactively.
        case 'applied-inferno':
            return {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'inflicter-hit',
                                type: 'damage',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'damage', multiplier: 100 },
                            },
                        ],
                    },
                    {
                        slot: 'passive',
                        abilities: [
                            {
                                id: 'inflicter-burner',
                                type: 'dot',
                                target: 'enemy',
                                trigger: 'on-deal-damage',
                                conditions: [],
                                config: {
                                    type: 'dot',
                                    dotType: 'inferno',
                                    tier: 15,
                                    stacks: 1,
                                    duration: 2,
                                    application: 'apply',
                                },
                            },
                        ],
                    },
                ],
            };
        case 'none':
            return undefined;
    }
};

const inflicter = (kind: Inflicter): ShipSpec => ({
    id: 'inflicter',
    position: 'M4',
    speed: 150,
    attack: 1,
    hacking: 1e6,
    skills: inflicterSkills(kind),
});

describe("Hayyan: 'When a debuff is inflicted on an ally' repairs once per cast, DoT stacks included", () => {
    beforeEach(() => setupKeyedRng(7));
    const hayyan = (position: ShipSpec['position']): ShipSpec => ({
        id: 'hayyan',
        position,
        speed: 1,
        hp: 1e6,
        skills: { slots: [{ slot: 'active', abilities: [] }, ...realSlots('Hayyan', ['passive'])] },
    });
    /** `hit`: who stands at M4 and takes the inflicter's cast — the ally, or Hayyan herself. */
    const teams = (kind: Inflicter, hit: 'ally' | 'hayyan'): MirrorTeams => ({
        caster:
            hit === 'ally'
                ? [hayyan('M3'), { id: 'ally', position: 'M4', speed: 1, hp: 1e6 }]
                : [hayyan('M4'), { id: 'ally', position: 'M3', speed: 1, hp: 1e6 }],
        other: [inflicter(kind)],
    });
    const repairs = (kind: Inflicter, hit: 'ally' | 'hayyan', side: 'player' | 'enemy') => {
        const { input, idOf } = mirrorBoard(teams(kind, hit), side);
        const owner = idOf('hayyan');
        const recipient = idOf(hit);
        const bus = createEventBus();
        let count = 0;
        bus.on('reactive-heal-performed', (e) => {
            if (e.casterId === owner && e.perTarget.some((t) => t.targetId === recipient)) count++;
        });
        runCombat({
            ...input,
            bus,
            __testTapActors: (all: CombatActor[]) => {
                for (const a of all) a.currentHp = a.stats.hp / 2;
            },
        });
        return count;
    };
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: Snakeroot's 2 Corrosion stacks on her ally → 1 repair`, () => {
            expect(repairs('snakeroot', 'ally', side)).toBe(1);
        });
        it(`${side}-side reverse board: Snakeroot's stacks on Hayyan herself → 1 repair`, () => {
            expect(repairs('snakeroot', 'hayyan', side)).toBe(1);
        });
        it(`${side}-side: a named debuff → 1 repair (unchanged)`, () => {
            expect(repairs('named', 'ally', side)).toBe(1);
        });
        it(`${side}-side: an APPLIED Inferno → no repair ("inflicted" only)`, () => {
            expect(repairs('applied-inferno', 'ally', side)).toBe(0);
        });
        it(`${side}-side: nothing inflicted → no repair`, () => {
            expect(repairs('none', 'ally', side)).toBe(0);
        });
    }
});

/** The carrier's passive slot from the real registry: a legendary Firewall implant (15%). */
const firewallPassive = (procChance?: number): ShipSkills['slots'][number] => {
    const ship = {
        id: 'carrier-ship',
        name: 'Carrier',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'DEFENDER',
        baseStats: {},
        equipment: {},
        implants: { implant_major: 'firewall-legendary' },
        refits: [],
    } as unknown as Ship;
    const piece = {
        id: 'firewall-legendary',
        slot: 'implant_major',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: null,
        subStats: [],
        setBonus: 'FIREWALL',
    } as unknown as GearPiece;
    const passive = buildShipAbilitiesWithEquipment(ship, (id) =>
        id === piece.id ? piece : undefined
    ).slots.find((s) => s.slot === 'passive');
    const fw = passive?.abilities.find((a) => a.trigger === 'on-debuffed');
    if (!fw) throw new Error('Firewall on-debuffed ability missing from the registry build');
    return {
        slot: 'passive',
        abilities: [procChance === undefined ? fw : { ...fw, procChance }],
    };
};

describe("Firewall: 'When debuffed' rolls once per landed DoT stack", () => {
    const teams = (kind: Inflicter, procChance?: number): MirrorTeams => ({
        caster: [
            {
                id: 'carrier',
                position: 'M4',
                speed: 1,
                skills: {
                    slots: [{ slot: 'active', abilities: [] }, firewallPassive(procChance)],
                },
            },
        ],
        other: [inflicter(kind)],
    });
    const grants = (kind: Inflicter, side: 'player' | 'enemy', procChance?: number) => {
        const { input, idOf } = mirrorBoard(teams(kind, procChance), side);
        const carrier = idOf('carrier');
        const bus = createEventBus();
        let count = 0;
        bus.on('buff-applied', (e) => {
            if (e.actorId === carrier && e.buffName === 'Block Debuff') count++;
        });
        runCombat({ ...input, bus });
        return count;
    };
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side, certain proc: Snakeroot's 2 stacks → 2 grants; named → 1; applied Inferno → 1; none → 0`, () => {
            setupKeyedRng(7);
            expect(grants('snakeroot', side, 1)).toBe(2);
            expect(grants('named', side, 1)).toBe(1);
            expect(grants('applied-inferno', side, 1)).toBe(1);
            expect(grants('none', side, 1)).toBe(0);
        });
        it(`${side}-side, legendary 15%: about 15% of 400 Corrosion stacks proc`, () => {
            let total = 0;
            for (let seed = 1; seed <= 200; seed++) {
                setupKeyedRng(seed);
                total += grants('snakeroot', side);
            }
            // 400 stacks at 15% → mean 60, sd ≈ 7.1.
            expect(total).toBeGreaterThan(35);
            expect(total).toBeLessThan(90);
        });
    }
});
