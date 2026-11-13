/**
 * General Colosso's passive, Assimilated Armor (#519), on his real parsed kit. Owner rulings
 * 2026-11-13:
 *   - DoT immunity: a DoT is never attempted on him (no roll, no resist, no reaction); a Bomb is
 *     not a DoT and still lands;
 *   - 100% shield penetration: his hit goes past a shield straight to HP;
 *   - +15% outgoing damage per dead ally (live count, additive outgoing channel, uncapped);
 *   - each ally death grants him Defense Up III (+45% defence, which scales his defence-based
 *     damage) and Taunt for 2 turns;
 *   - Enrage Damage III (+6% outgoing, stackable, additive) after each of his attack casts, one
 *     stack per cast however many enemies it hit.
 * Every board runs with Colosso on the player side and on the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { parsePattern, parseTarget } from '../../targetingParser';
import {
    boardInput,
    hitKit,
    NO_KIT,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { bossShip } from '../../../constants/bountyBosses';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { DoTType } from '../../../types/calculator';
import type { Position } from '../../../types/encounters';
import type { PreFightCombatModifiers } from '../preFight';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(519));

const SIDES: Placement[] = ['player', 'enemy'];
const COLOSSO_DEFENCE = 10_000;
/** 175% of his defence against a 0-defence victim. */
const FULL = 17_500;

const colossoKit = (): ShipSkills => buildShipAbilities(bossShip('colosso', 32)!);

const colosso = (
    position: Position,
    kit: ShipSkills = colossoKit(),
    extra: Partial<BoardUnit> = {}
): BoardUnit => ({
    id: 'colosso',
    kit,
    position,
    speed: 300,
    defence: COLOSSO_DEFENCE,
    chargeCount: 2,
    target: parseTarget('marked-or-front'),
    pattern: parsePattern('Pattern-Horseshoe-Range-1'),
    ...extra,
});

const dummy = (id: string, position: Position, extra: Partial<BoardUnit> = {}): BoardUnit => ({
    id,
    kit: NO_KIT,
    position,
    speed: 1,
    ...extra,
});

/** A fast single-target hitter that kills a 1-HP unit and leaves a 1e9-HP one standing. Control
 *  immune, so a Taunt gained by an earlier death never pulls it. */
const killer = (id: string, position: Position): BoardUnit => ({
    id,
    kit: { ...hitKit(100), controlImmune: true },
    position,
    speed: 500,
    attack: 1e6,
});

/** Damage each unit took from `attackerId`, per round. */
const hitsBy = (input: CombatEngineInput, attackerId: string): Map<number, Map<string, number>> => {
    const bus = createEventBus();
    const out = new Map<number, Map<string, number>>();
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.attackerId !== attackerId) return;
        const round = out.get(e.round) ?? new Map<string, number>();
        round.set(e.targetId, (round.get(e.targetId) ?? 0) + (e.takenDamage ?? 0));
        out.set(e.round, round);
    });
    runCombat({ ...input, bus });
    for (const round of out.values())
        for (const [id, taken] of round) round.set(id, Math.round(taken));
    return out;
};

const dotAbility = (
    dotType: DoTType,
    tier: number,
    trigger: Ability['trigger'] = 'on-cast'
): Ability => ({
    id: `dot-${dotType}-${trigger}`,
    type: 'dot',
    target: 'enemy',
    trigger,
    conditions: [],
    config: { type: 'dot', dotType, tier, stacks: 1, duration: 3 },
});

const damageAbility: Ability = {
    id: 'hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
};

/** A fast opponent of Colosso's whose active hits and lands `dots` (a hacking no security
 *  resists). */
const inflicter = (position: Position, dots: Ability[], pattern = 'Pattern-Base'): BoardUnit => ({
    id: 'inflicter',
    kit: { slots: [{ slot: 'active', abilities: [damageAbility, ...dots] }] },
    position,
    speed: 500,
    attack: 1,
    hacking: 1e6,
    pattern: parsePattern(pattern),
});

interface DotLog {
    applied: Map<string, DoTType[]>;
    resisted: Map<string, string[]>;
}

const dotLog = (input: CombatEngineInput): DotLog => {
    const bus = createEventBus();
    const log: DotLog = { applied: new Map(), resisted: new Map() };
    bus.on('dot-applied', (e: Extract<CombatEvent, { type: 'dot-applied' }>) => {
        log.applied.set(e.targetId, [...(log.applied.get(e.targetId) ?? []), e.dotType]);
    });
    bus.on('debuff-resisted', (e: Extract<CombatEvent, { type: 'debuff-resisted' }>) => {
        log.resisted.set(e.targetId, [...(log.resisted.get(e.targetId) ?? []), e.buffName]);
    });
    runCombat({ ...input, bus });
    return log;
};

const withoutDotImmunity = (kit: ShipSkills): ShipSkills => ({ ...kit, dotImmune: false });

describe.each(SIDES)('Colosso is immune to damage over time, on the %s side', (placement) => {
    it("a cast's Inferno is never attempted on him; its Bomb lands", () => {
        const caster = colosso('M1', colossoKit(), { speed: 1 });
        const opp = [inflicter('M1', [dotAbility('inferno', 15), dotAbility('bomb', 100)])];
        const { input, id } = boardInput(placement, caster, [], opp, 1);
        const log = dotLog(input);
        expect(log.applied.get(id(caster))).toEqual(['bomb']);
        expect(log.resisted.get(id(caster))).toBeUndefined();
    });

    it('validity: without the immunity the same Inferno lands on him', () => {
        const caster = colosso('M1', withoutDotImmunity(colossoKit()), { speed: 1 });
        const opp = [inflicter('M1', [dotAbility('inferno', 15), dotAbility('bomb', 100)])];
        const { input, id } = boardInput(placement, caster, [], opp, 1);
        expect(dotLog(input).applied.get(id(caster))?.sort()).toEqual(['bomb', 'inferno']);
    });

    it('an area cast skips him as a covered enemy and still lands on the primary', () => {
        // Front target m2 (front of row M); the circle around it covers Colosso at M1.
        const caster = colosso('M1', colossoKit(), { speed: 1 });
        const front = dummy('front', 'M2');
        const opp = [inflicter('M1', [dotAbility('inferno', 15)], 'Pattern-Circle-Range-1')];
        const { input, id } = boardInput(placement, caster, [front], opp, 1);
        const log = dotLog(input);
        expect(log.applied.get(id(front))).toEqual(['inferno']);
        expect(log.applied.get(id(caster))).toBeUndefined();
        expect(log.resisted.get(id(caster))).toBeUndefined();
    });

    it('validity: without the immunity the same area cast lands on him as a covered enemy', () => {
        const caster = colosso('M1', withoutDotImmunity(colossoKit()), { speed: 1 });
        const front = dummy('front', 'M2');
        const opp = [inflicter('M1', [dotAbility('inferno', 15)], 'Pattern-Circle-Range-1')];
        const { input, id } = boardInput(placement, caster, [front], opp, 1);
        expect(dotLog(input).applied.get(id(caster))).toEqual(['inferno']);
    });

    /** An ally of Colosso's that grants Block Debuff to its whole side before anyone else acts. */
    const blocker = (): BoardUnit => ({
        id: 'blocker',
        kit: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'block',
                            type: 'buff',
                            target: 'all-allies',
                            trigger: 'on-cast',
                            conditions: [],
                            config: {
                                type: 'buff',
                                buffName: 'Block Debuff',
                                duration: 3,
                                stacks: 1,
                                isStackable: false,
                                parsedEffects: {},
                            },
                        },
                    ],
                },
            ],
        },
        position: 'B1',
        speed: 600,
    });

    it('under Block Debuff only the Bomb is resisted: the Inferno is never attempted', () => {
        const caster = colosso('M1', colossoKit(), { speed: 1 });
        const opp = [inflicter('M1', [dotAbility('inferno', 15), dotAbility('bomb', 100)])];
        const { input, id } = boardInput(placement, caster, [blocker()], opp, 1);
        expect(dotLog(input).resisted.get(id(caster))).toEqual(['Bomb']);
    });

    it('validity: without the immunity Block Debuff resists the Inferno too', () => {
        const caster = colosso('M1', withoutDotImmunity(colossoKit()), { speed: 1 });
        const opp = [inflicter('M1', [dotAbility('inferno', 15), dotAbility('bomb', 100)])];
        const { input, id } = boardInput(placement, caster, [blocker()], opp, 1);
        expect(dotLog(input).resisted.get(id(caster))?.sort()).toEqual(['Bomb', 'Inferno I']);
    });

    /** "Inflicts Inferno I. If the enemy has 1 or more debuffs, inflicts Defense Down I": the
     *  gate counts the Inferno the same cast landed before it (written order). */
    const writtenOrderKit = (): Ability[] => [
        dotAbility('inferno', 15),
        {
            id: 'gated-defense-down',
            type: 'debuff',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [
                {
                    subject: 'enemy-debuff',
                    derivable: true,
                    countComparator: 'gte',
                    countThreshold: 1,
                },
            ],
            config: {
                type: 'debuff',
                buffName: 'Defense Down I',
                duration: 2,
                stacks: 1,
                isStackable: false,
                parsedEffects: {},
            },
        } as Ability,
    ];

    const landedDebuffs = (input: CombatEngineInput): Map<string, string[]> => {
        const bus = createEventBus();
        const out = new Map<string, string[]>();
        bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
            out.set(e.targetId, [...(out.get(e.targetId) ?? []), e.buffName]);
        });
        runCombat({ ...input, bus });
        return out;
    };

    it("a later clause's debuff count does not count an Inferno he never received", () => {
        const caster = colosso('M1', colossoKit(), { speed: 1 });
        const opp = [inflicter('M1', writtenOrderKit())];
        const { input, id } = boardInput(placement, caster, [], opp, 1);
        expect(landedDebuffs(input).get(id(caster)) ?? []).not.toContain('Defense Down I');
    });

    it('validity: without the immunity the landed Inferno opens that gate', () => {
        const caster = colosso('M1', withoutDotImmunity(colossoKit()), { speed: 1 });
        const opp = [inflicter('M1', writtenOrderKit())];
        const { input, id } = boardInput(placement, caster, [], opp, 1);
        expect(landedDebuffs(input).get(id(caster))).toContain('Defense Down I');
    });

    /** Corrosion and Toxic Overflow on the front ship at M2, beside Colosso at M1: the holder
     *  spreads Corrosion I to its adjacent allies. */
    const spreadBoard = (kit: ShipSkills) => {
        const caster = colosso('M1', kit, { speed: 1 });
        const holder = dummy('holder', 'M2');
        const toxicOverflow = {
            id: 'toxic-overflow',
            type: 'debuff',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'debuff',
                buffName: 'Toxic Overflow',
                duration: 10,
                stacks: 1,
                isStackable: false,
                parsedEffects: {},
                application: 'apply',
            },
        } as Ability;
        const opp = [inflicter('M1', [dotAbility('corrosion', 3), toxicOverflow])];
        return { caster, ...boardInput(placement, caster, [holder], opp, 1) };
    };

    it("a Toxic Overflow holder's Corrosion spread skips him", () => {
        const { caster, input, id } = spreadBoard(colossoKit());
        const log = dotLog(input);
        expect(log.applied.get(id(caster))).toBeUndefined();
        expect(log.resisted.get(id(caster))).toBeUndefined();
    });

    it('validity: without the immunity the spread reaches him', () => {
        const { caster, input, id } = spreadBoard(withoutDotImmunity(colossoKit()));
        expect(dotLog(input).applied.get(id(caster))).toEqual(['corrosion']);
    });

    it('a reactive Inferno (on dealing damage) is never attempted on him', () => {
        const caster = colosso('M1', colossoKit(), { speed: 1 });
        const opp = [inflicter('M1', [dotAbility('inferno', 15, 'on-deal-damage')])];
        const { input, id } = boardInput(placement, caster, [], opp, 1);
        const log = dotLog(input);
        expect(log.applied.get(id(caster))).toBeUndefined();
        expect(log.resisted.get(id(caster))).toBeUndefined();
    });

    it('validity: without the immunity the same reactive Inferno lands on him', () => {
        const caster = colosso('M1', withoutDotImmunity(colossoKit()), { speed: 1 });
        const opp = [inflicter('M1', [dotAbility('inferno', 15, 'on-deal-damage')])];
        const { input, id } = boardInput(placement, caster, [], opp, 1);
        expect(dotLog(input).applied.get(id(caster))).toEqual(['inferno']);
    });
});

/** A shield pool of `pct`% of max HP from the start of the fight. */
const startingShield = (pct: number): PreFightCombatModifiers => ({
    attackPct: 0,
    attackPctPerOtherFactionAlly: 0,
    outgoingDamage: 0,
    incomingDamage: 0,
    outgoingCritDamage: 0,
    outgoingCritDamageInStealth: 0,
    outgoingDamageSecondaryTargets: 0,
    incomingCritDamage: 0,
    outgoingHeal: 0,
    incomingHeal: 0,
    startingShieldPctOfHp: pct,
});

describe.each(SIDES)('Colosso has 100% shield penetration, on the %s side', (placement) => {
    /** Whether Colosso's round-1 hit reached the victim's shield, with his level-32 shield
     *  penetration overridden to `pen` when given. */
    const shieldWasHit = (pen?: number): boolean | undefined => {
        const caster = colosso('M1');
        const victim = dummy('victim', 'M1', { hp: 1e6, preFight: startingShield(10) });
        const { input, id } = boardInput(placement, caster, [], [victim], 1);
        const shieldPenetration = pen ?? bossShip('colosso', 32)!.baseStats.shieldPenetration;
        const withPen: CombatEngineInput =
            placement === 'player'
                ? { ...input, shieldPenetration }
                : {
                      ...input,
                      enemyAttackers: input.enemyAttackers.map((e) =>
                          e.id === caster.id
                              ? { ...e, stats: { ...e.stats, shieldPenetration } }
                              : e
                      ),
                  };
        const bus = createEventBus();
        let reached: boolean | undefined;
        bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
            if (e.attackerId === id(caster) && e.round === 1) reached = e.shieldWasHit === true;
        });
        runCombat({ ...withPen, bus });
        return reached;
    };

    it('his hit on a shielded victim goes straight to HP', () => {
        expect(shieldWasHit()).toBe(false);
    });

    it('validity: at 0 shield penetration the same hit drains the shield', () => {
        expect(shieldWasHit(0)).toBe(true);
    });
});

describe.each(SIDES)('Colosso on an ally death, on the %s side', (placement) => {
    // Colosso at M1 hits the front of row M: the 0-defence victim at M1. Each Major (Colosso's
    // ally) is the front of its own row and dies to the opponent of that row before Colosso acts.
    const victim = () => dummy('victim', 'M1');
    const major = (id: string, position: Position, hp = 1) => dummy(id, position, { hp });

    it('one dead ally: Defense Up III (+45% defence) and +15% outgoing', () => {
        const caster = colosso('M1');
        const v = victim();
        const { input, id } = boardInput(
            placement,
            caster,
            [major('major-t', 'T2')],
            [v, killer('killer-t', 'T1')],
            1
        );
        expect(hitsBy(input, id(caster)).get(1)?.get(id(v))).toBe(Math.round(FULL * 1.45 * 1.15));
    });

    it('validity: with nobody dead the same hit is his plain 175%', () => {
        const caster = colosso('M1');
        const v = victim();
        const { input, id } = boardInput(
            placement,
            caster,
            [major('major-t', 'T2', 1e9)],
            [v, killer('killer-t', 'T1')],
            1
        );
        expect(hitsBy(input, id(caster)).get(1)?.get(id(v))).toBe(FULL);
    });

    it('two dead allies: +30% outgoing, and Defense Up III does not stack', () => {
        const caster = colosso('M1');
        const v = victim();
        const { input, id } = boardInput(
            placement,
            caster,
            [major('major-t', 'T2'), major('major-b', 'B2')],
            [v, killer('killer-t', 'T1'), killer('killer-b', 'B1')],
            1
        );
        expect(hitsBy(input, id(caster)).get(1)?.get(id(v))).toBe(Math.round(FULL * 1.45 * 1.3));
    });

    it('the death makes him Taunt: a single-target attacker turns from its front target to him', () => {
        // The striker (row M) faces the Major at M2, the front of row M. Once the Major at T2
        // dies, Colosso's Taunt pulls the striker's hit.
        const caster = colosso('M1', colossoKit(), { speed: 1 });
        const striker: BoardUnit = {
            id: 'striker',
            kit: hitKit(100),
            position: 'M1',
            speed: 400,
            attack: 1,
        };
        const front = major('major-m', 'M2', 1e9);
        const { input, id } = boardInput(
            placement,
            caster,
            [major('major-t', 'T2'), front],
            [striker, killer('killer-t', 'T1')],
            1
        );
        expect([...(hitsBy(input, id(striker)).get(1)?.keys() ?? [])]).toEqual([id(caster)]);
    });

    it('validity: with nobody dead the same attacker hits its front target', () => {
        const caster = colosso('M1', colossoKit(), { speed: 1 });
        const striker: BoardUnit = {
            id: 'striker',
            kit: hitKit(100),
            position: 'M1',
            speed: 400,
            attack: 1,
        };
        const front = major('major-m', 'M2', 1e9);
        const { input, id } = boardInput(
            placement,
            caster,
            [major('major-t', 'T2', 1e9), front],
            [striker, killer('killer-t', 'T1')],
            1
        );
        expect([...(hitsBy(input, id(striker)).get(1)?.keys() ?? [])]).toEqual([id(front)]);
    });
});

describe.each(SIDES)(
    'Colosso gains Enrage Damage III after attacking, on the %s side',
    (placement) => {
        it('his second attack carries one stack: +6%', () => {
            const caster = colosso('M1');
            const v = dummy('victim', 'M1');
            const { input, id } = boardInput(placement, caster, [], [v], 2);
            const hits = hitsBy(input, id(caster));
            expect(hits.get(1)?.get(id(v))).toBe(FULL);
            expect(hits.get(2)?.get(id(v))).toBe(Math.round(FULL * 1.06));
        });

        it('one stack per cast, however many Marked enemies the cast hit', () => {
            // Two markers Mark the front of rows T and B every round; Colosso hits both each round.
            const markerAbility = {
                id: 'mark',
                type: 'debuff',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [],
                config: {
                    type: 'debuff',
                    buffName: 'Marked',
                    duration: 10,
                    stacks: 1,
                    isStackable: false,
                    parsedEffects: {},
                    application: 'apply',
                },
            } as Ability;
            const marker = (id: string, position: Position): BoardUnit => ({
                id,
                kit: { slots: [{ slot: 'active', abilities: [markerAbility] }] },
                position,
                speed: 400,
                hacking: 100_000,
            });
            const caster = colosso('M1');
            const opp = [dummy('t2', 'T2'), dummy('b2', 'B2')];
            const { input, id } = boardInput(
                placement,
                caster,
                [marker('mark-t', 'T1'), marker('mark-b', 'B1')],
                opp,
                2
            );
            const hits = hitsBy(input, id(caster));
            for (const u of opp) {
                expect(hits.get(1)?.get(id(u))).toBe(FULL);
                expect(hits.get(2)?.get(id(u))).toBe(Math.round(FULL * 1.06));
            }
        });

        it('stacks add to the dead-ally bonus rather than multiplying it', () => {
            // One Major dies in round 1: round 2 carries +15% and one Enrage stack, 1.21 together
            // (1.15 × 1.06 would be 1.219).
            const caster = colosso('M1');
            const v = dummy('victim', 'M1');
            const { input, id } = boardInput(
                placement,
                caster,
                [dummy('major-t', 'T2', { hp: 1 })],
                [v, killer('killer-t', 'T1')],
                2
            );
            const hits = hitsBy(input, id(caster));
            const r1 = hits.get(1)?.get(id(v)) ?? 0;
            const r2 = hits.get(2)?.get(id(v)) ?? 0;
            expect(r1).toBe(Math.round(FULL * 1.45 * 1.15));
            expect(r2 / r1).toBeCloseTo(1.21 / 1.15, 3);
        });
    }
);

describe.each(SIDES)('the Pestilence cleanse fan-out, Colosso on the %s side', (placement) => {
    // Pestilence-shaped opponent: its active debuffs Colosso's whole side; when an enemy cleanses
    // a debuff, it inflicts Corrosion II on every cleansed enemy. Colosso's ally then cleanses
    // one debuff from its whole side, Colosso included.
    const pestilence = (): BoardUnit => ({
        id: 'pestilence',
        kit: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'attack-down-all',
                            type: 'debuff',
                            target: 'all-enemies',
                            trigger: 'on-cast',
                            conditions: [],
                            config: {
                                type: 'debuff',
                                buffName: 'Attack Down',
                                parsedEffects: { attack: -30 },
                                stacks: 1,
                                isStackable: false,
                                application: 'apply',
                                duration: 9,
                            },
                        },
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        {
                            id: 'corrosion-on-cleanse',
                            type: 'dot',
                            target: 'all-enemies',
                            trigger: 'on-enemy-cleansed',
                            conditions: [],
                            config: {
                                type: 'dot',
                                dotType: 'corrosion',
                                tier: 6,
                                stacks: 1,
                                duration: 2,
                            },
                        },
                    ],
                },
            ],
        },
        position: 'M1',
        speed: 500,
        hacking: 1e6,
        pattern: { raw: 'all', shape: 'all', range: 0, modifiers: {} },
    });
    const cleanser = (): BoardUnit => ({
        id: 'cleanser',
        kit: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'cleanse-all',
                            type: 'cleanse',
                            target: 'all-allies',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'cleanse', count: 1 },
                        },
                    ],
                },
            ],
        },
        position: 'T1',
        speed: 400,
    });

    it('lands its Corrosion on the cleansed ally and never attempts it on Colosso', () => {
        const caster = colosso('M1', colossoKit(), { speed: 1 });
        const helper = cleanser();
        const { input, id } = boardInput(placement, caster, [helper], [pestilence()], 1);
        const log = dotLog(input);
        expect(log.applied.get(id(helper))).toEqual(['corrosion']);
        expect(log.applied.get(id(caster))).toBeUndefined();
        expect(log.resisted.get(id(caster))).toBeUndefined();
    });

    it('validity: without the immunity the same fan-out reaches Colosso', () => {
        const caster = colosso('M1', withoutDotImmunity(colossoKit()), { speed: 1 });
        const helper = cleanser();
        const { input, id } = boardInput(placement, caster, [helper], [pestilence()], 1);
        expect(dotLog(input).applied.get(id(caster))).toEqual(['corrosion']);
    });
});

describe.each(SIDES)('an ally death by DoT or Bomb, Colosso on the %s side', (placement) => {
    // The opponent of row T leaves only a DoT (or a Bomb) on the Major at T2; its hit deals
    // nothing. The Major dies to the tick (or the detonation), not to a direct hit.
    const dotKiller = (dotType: DoTType, tier: number, duration: number): BoardUnit => ({
        id: 'dot-killer',
        kit: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        { ...damageAbility, config: { type: 'damage', multiplier: 0 } },
                        {
                            ...dotAbility(dotType, tier),
                            config: { type: 'dot', dotType, tier, stacks: 1, duration },
                        },
                    ],
                },
            ],
        },
        position: 'T1',
        speed: 500,
        attack: 1e6,
        hacking: 1e6,
    });

    interface DeathRun {
        majorDeath?: Extract<CombatEvent, { type: 'ship-destroyed' }>;
        colossoGrants: string[];
        hits: Map<number, number>;
    }

    const run = (opponent: BoardUnit, majorHp: number): DeathRun => {
        const caster = colosso('M1');
        const v = dummy('victim', 'M1');
        const major = dummy('major-t', 'T2', { hp: majorHp });
        const { input, id } = boardInput(placement, caster, [major], [v, opponent], 3);
        const bus = createEventBus();
        const out: DeathRun = { colossoGrants: [], hits: new Map() };
        bus.on('ship-destroyed', (e: Extract<CombatEvent, { type: 'ship-destroyed' }>) => {
            if (e.actorId === id(major)) out.majorDeath = e;
        });
        bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
            if (e.actorId === id(caster) && e.granterId === id(caster))
                out.colossoGrants.push(e.buffName);
        });
        bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
            if (e.attackerId === id(caster) && e.targetId === id(v))
                out.hits.set(e.round, Math.round(e.takenDamage ?? 0));
        });
        runCombat({ ...input, bus });
        return out;
    };

    /** His hit in the round after the death: Defense Up III, +15% and the Enrage stacks of
     *  his earlier casts. */
    const expectBoostedAfterDeath = (r: DeathRun) => {
        const death = r.majorDeath!;
        // Not a direct-hit death (`isDirectDeath`, triggers.ts): a tick, or a detonation.
        expect(death.byDirectDamage === true && death.byDetonation !== true).toBe(false);
        expect(r.colossoGrants).toEqual(expect.arrayContaining(['Defense Up III', 'Taunt']));
        const next = death.round + 1;
        const enrageStacks = next - 1;
        expect(r.hits.get(next)).toBe(Math.round(FULL * 1.45 * (1 + 0.15 + 0.06 * enrageStacks)));
    };

    it('an Inferno tick kills the Major: Defense Up III, Taunt and +15%', () => {
        const r = run(dotKiller('inferno', 45, 3), 1_000);
        expect(r.majorDeath).toBeDefined();
        expectBoostedAfterDeath(r);
    });

    it('a Bomb detonation kills the Major: Defense Up III, Taunt and +15%', () => {
        const r = run(dotKiller('bomb', 100, 1), 1_000);
        expect(r.majorDeath?.byDetonation).toBe(true);
        expectBoostedAfterDeath(r);
    });

    it('validity: a Major that survives the same Inferno grants nothing', () => {
        const r = run(dotKiller('inferno', 45, 3), 1e12);
        expect(r.majorDeath).toBeUndefined();
        expect(r.colossoGrants).not.toContain('Defense Up III');
        expect(r.hits.get(2)).toBe(Math.round(FULL * 1.06));
    });
});
