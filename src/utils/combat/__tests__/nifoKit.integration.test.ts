/**
 * Nifo (Terran supporter), every clause of his kit, on his real support footprint
 * (`Pattern-Support-Double-Pickaxe-Range-0`, anchored on him at M3: M2, M3, M4, T1, T4, B1, B4).
 *
 *  - Active: Defense Surge ("Increases defense by 20% of the applying Unit's defense") and
 *    Out. Damage Up II, to himself and the allies in his pattern. Defense Surge is a flat grant
 *    snapshotted from Nifo's defence, like Terran Guard.
 *  - Charged: Crit Power Up III and Reflect III ("Reflects 30% of the direct damage when hit as a
 *    primary target").
 *  - Passive: "When an ally gains Taunt, this Unit grants all allies within the active pattern
 *    N stacks of Core Charge I" — the ally may be Nifo himself, and Nifo grants no Taunt.
 *    R2+: "When an ally reflects damage increase that damage by 10/15%."
 *
 * Opponents hit for 10,000 attack, crit 0, against 0-defence attackers, so a 30% reflect of a
 * 100% hit is exactly 3,000. Every case runs with Nifo on the player side and on the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { parsePattern, parseTarget } from '../../targetingParser';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parseReflectAmplification } from '../../skillTextParser';
import {
    boardInput,
    hitKit,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(7));

const NIFO_PATTERN = parsePattern('Pattern-Support-Double-Pickaxe-Range-0');
const NIFO_TARGET = parseTarget('allies');

const slotsOf = (kit: ShipSkills, keep: string[]): ShipSkills => ({
    slots: kit.slots.filter((s) => keep.includes(s.slot)),
});
const abilitiesOf = (kit: ShipSkills, slot: string): Ability[] =>
    kit.slots.find((s) => s.slot === slot)?.abilities ?? [];

const nifo = (over: Partial<BoardUnit> = {}): BoardUnit => ({
    id: 'nifo',
    kit: realKit('Nifo'),
    position: 'M3',
    speed: 300,
    pattern: NIFO_PATTERN,
    target: NIFO_TARGET,
    chargeCount: 99,
    ...over,
});

const plain = (id: string, position: BoardUnit['position'], defence = 0): BoardUnit => ({
    id,
    kit: NO_KIT,
    position,
    speed: 1,
    defence,
});

const opponent = (over: Partial<BoardUnit> = {}): BoardUnit => ({
    id: 'opponent',
    kit: hitKit(),
    position: 'M4',
    speed: 200,
    attack: 10_000,
    chargeCount: 99,
    ...over,
});

const run = (
    placement: Placement,
    carrier: BoardUnit,
    allies: BoardUnit[],
    opponents: BoardUnit[],
    rounds: number
) => {
    const { input, id } = boardInput(placement, carrier, allies, opponents, rounds);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('attacked', (e) => events.push(e));
    bus.on('buff-applied', (e) => events.push(e));
    bus.on('reactive-damage-performed', (e) => events.push(e));
    runCombat({ ...input, bus });
    return { events, id };
};

type Attacked = Extract<CombatEvent, { type: 'attacked' }>;
type BuffApplied = Extract<CombatEvent, { type: 'buff-applied' }>;
type Reflected = Extract<CombatEvent, { type: 'reactive-damage-performed' }>;

/** What `target` took from `attacker` in round 1. */
const takenFrom = (events: CombatEvent[], attackerId: string, targetId: string): number =>
    events
        .filter(
            (e): e is Attacked =>
                e.type === 'attacked' &&
                e.round === 1 &&
                e.attackerId === attackerId &&
                e.targetId === targetId
        )
        .reduce((sum, e) => sum + Math.round(e.takenDamage ?? 0), 0);

/** A unit with `defence` and no status, hit by the same opponent. */
const controlTaken = (placement: Placement, defence: number): number => {
    const target = plain('plain', 'M4', defence);
    const { events, id } = run(placement, target, [], [opponent()], 1);
    return takenFrom(events, id(opponent()), id(target));
};

describe('Nifo parses to his kit', () => {
    const kit = realKit('Nifo');

    it('active: Defense Surge (applier-defence flat grant) and Out. Damage Up II', () => {
        const buffs = abilitiesOf(kit, 'active').map((a) => a.config);
        expect(buffs).toEqual([
            expect.objectContaining({
                type: 'buff',
                buffName: 'Defense Surge',
                parsedEffects: { defenceFlatPctOfCaster: 20 },
                duration: 2,
            }),
            expect.objectContaining({ type: 'buff', buffName: 'Out. Damage Up II', duration: 2 }),
        ]);
    });

    it('charged: Crit Power Up III and Reflect III', () => {
        const buffs = abilitiesOf(kit, 'charged').map((a) => a.config);
        expect(buffs).toEqual([
            expect.objectContaining({ type: 'buff', buffName: 'Crit Power Up III' }),
            expect.objectContaining({
                type: 'buff',
                buffName: 'Reflect III',
                parsedEffects: { reflectPct: 30 },
                duration: 2,
            }),
        ]);
    });

    it('passive: Core Charge on an ally gaining Taunt, pattern-scoped, and no Taunt of his own', () => {
        const passive = abilitiesOf(kit, 'passive');
        expect(passive.some((a) => a.config.type === 'control')).toBe(false);
        expect(passive.some((a) => a.config.type === 'buff' && a.config.buffName === 'Taunt')).toBe(
            false
        );
        const coreCharge = passive.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Core Charge I'
        );
        expect(coreCharge).toMatchObject({
            trigger: 'on-ally-taunt-gained',
            target: 'all-allies',
            patternScoped: true,
            conditions: [],
            config: { stacks: 2, maxStacks: 10, duration: 'recurring' },
        });
        expect(passive.find((a) => a.config.type === 'reflect-amplification')).toMatchObject({
            target: 'all-allies',
            config: { type: 'reflect-amplification', pct: 15 },
        });
    });

    it('R1 has one stack and no reflect amplification; R2 amplifies by 10%', () => {
        const passiveOf = (text: string) =>
            abilitiesOf(
                buildShipAbilities({ refits: [], activeSkillText: text } as unknown as Ship),
                'active'
            );
        const r1 =
            'When an ally gains <unit-skill>Taunt</unit-skill>, this Unit grants all allies within the active pattern 1 stack of <unit-skill>Core Charge I</unit-skill>.';
        const r2 = `${r1}<br /><br />When an ally reflects damage increase that damage by 10%.`;
        const r1Abilities = passiveOf(r1);
        expect(r1Abilities.map((a) => a.config.type)).toEqual(['buff']);
        expect(r1Abilities[0]).toMatchObject({
            trigger: 'on-ally-taunt-gained',
            config: { buffName: 'Core Charge I', stacks: 1 },
        });
        expect(parseReflectAmplification(r1)).toBeNull();
        expect(parseReflectAmplification(r2)).toBe(10);
    });
});

describe.each<Placement>(['player', 'enemy'])('Nifo on the %s side', (placement) => {
    describe('Defense Surge adds 20% of NIFO’s defence', () => {
        it('Nifo at 5000 defence: an ally at 1000 takes a 2000-defence hit', () => {
            const ally = plain('ally', 'M4', 1000);
            const { events, id } = run(
                placement,
                nifo({ kit: slotsOf(realKit('Nifo'), ['active']), defence: 5000 }),
                [ally],
                [opponent()],
                1
            );
            expect(takenFrom(events, id(opponent()), id(ally))).toBe(controlTaken(placement, 2000));
        });

        it('Nifo on himself, recasting every round: 6000 both rounds (no compounding)', () => {
            const self = nifo({
                kit: slotsOf(realKit('Nifo'), ['active']),
                position: 'M4',
                defence: 5000,
            });
            const { events, id } = run(placement, self, [], [opponent()], 2);
            const perRound = (round: number) =>
                events
                    .filter(
                        (e): e is Attacked =>
                            e.type === 'attacked' &&
                            e.round === round &&
                            e.targetId === id(self) &&
                            e.attackerId === id(opponent())
                    )
                    .reduce((sum, e) => sum + Math.round(e.takenDamage ?? 0), 0);
            const control = controlTaken(placement, 6000);
            expect([perRound(1), perRound(2)]).toEqual([control, control]);
        });
    });

    describe('Core Charge I when an ally gains Taunt', () => {
        // Madax gains Taunt on his active. Nifo moves first and casts nothing that matters here.
        const madax = (position: BoardUnit['position']): BoardUnit => ({
            id: 'madax',
            kit: slotsOf(realKit('Madax'), ['active']),
            position,
            speed: 250,
            chargeCount: 99,
        });
        const coreChargeGrants = (events: CombatEvent[]) =>
            events.filter(
                (e): e is BuffApplied => e.type === 'buff-applied' && e.buffName === 'Core Charge I'
            );

        it('reaches Nifo and the allies in his pattern, not an ally outside it', () => {
            const outside = plain('outside', 'T2');
            const inside = plain('inside', 'M2');
            const taunter = madax('M4');
            const carrier = nifo({ kit: slotsOf(realKit('Nifo'), ['passive']) });
            const { events, id } = run(
                placement,
                carrier,
                [taunter, inside, outside],
                [opponent({ kit: NO_KIT, speed: 1 })],
                1
            );
            const recipients = coreChargeGrants(events).map((e) => e.actorId);
            expect(new Set(recipients)).toEqual(new Set([id(carrier), id(taunter), id(inside)]));
            // One Taunt gain → one firing → one grant per recipient.
            expect(recipients).toHaveLength(3);
            expect(
                events.some(
                    (e) =>
                        e.type === 'buff-applied' &&
                        e.buffName === 'Taunt' &&
                        e.granterId === id(carrier)
                )
            ).toBe(false);
        });

        it('banks 2 stacks: the ally’s next hit carries +8% outgoing damage', () => {
            const hitter: BoardUnit = {
                id: 'hitter',
                kit: hitKit(),
                position: 'M2',
                speed: 100,
                attack: 10_000,
                chargeCount: 99,
            };
            const target = plain('target', 'M4');
            const hitOf = (withTaunter: boolean) => {
                const carrier = nifo({ kit: slotsOf(realKit('Nifo'), ['passive']) });
                const { events, id } = run(
                    placement,
                    carrier,
                    withTaunter ? [madax('M4'), hitter] : [plain('filler', 'M4'), hitter],
                    [target],
                    1
                );
                return takenFrom(events, id(hitter), id(target));
            };
            const base = hitOf(false);
            expect(base).toBeGreaterThan(0);
            expect(hitOf(true)).toBe(Math.round(base * 1.08));
        });

        it('fires when Nifo himself gains Taunt (an ally includes self)', () => {
            // A copy of Madax's Taunt self-grant spliced into Nifo's passive kit as an active.
            const madaxTaunt = abilitiesOf(realKit('Madax'), 'active').filter(
                (a) => a.config.type === 'buff' || a.config.type === 'control'
            );
            const nifoKit = realKit('Nifo');
            const carrier = nifo({
                kit: {
                    slots: [
                        { slot: 'active', abilities: madaxTaunt },
                        ...nifoKit.slots.filter((s) => s.slot === 'passive'),
                    ],
                },
            });
            const ally = plain('ally', 'M4');
            const { events, id } = run(
                placement,
                carrier,
                [ally],
                [opponent({ kit: NO_KIT, speed: 1 })],
                1
            );
            expect(new Set(coreChargeGrants(events).map((e) => e.actorId))).toEqual(
                new Set([id(carrier), id(ally)])
            );
        });

        it('fires on Iridium’s start-of-combat Taunt', () => {
            const iridium: BoardUnit = {
                id: 'iridium',
                kit: realKit('Iridium'),
                position: 'M4',
                speed: 1,
                chargeCount: 99,
            };
            const carrier = nifo({ kit: slotsOf(realKit('Nifo'), ['passive']) });
            const { events, id } = run(
                placement,
                carrier,
                [iridium],
                [opponent({ kit: NO_KIT, speed: 1 })],
                1
            );
            expect(
                events.some(
                    (e) =>
                        e.type === 'buff-applied' &&
                        e.buffName === 'Taunt' &&
                        e.actorId === id(iridium)
                )
            ).toBe(true);
            expect(new Set(coreChargeGrants(events).map((e) => e.actorId))).toEqual(
                new Set([id(carrier), id(iridium)])
            );
        });

        it('does not fire when an ENEMY gains Taunt', () => {
            const carrier = nifo({ kit: slotsOf(realKit('Nifo'), ['passive']) });
            const { events } = run(placement, carrier, [plain('ally', 'M4')], [madax('M4')], 1);
            expect(events.some((e) => e.type === 'buff-applied' && e.buffName === 'Taunt')).toBe(
                true
            );
            expect(coreChargeGrants(events)).toHaveLength(0);
        });
    });

    describe('Reflect III and the reflect amplification', () => {
        /** Nifo opens with his charged skill; the opponent then hits `struck` once. */
        const reflected = (opts: {
            passive: boolean;
            struck: 'nifo' | 'ally';
            opponentKit?: ShipSkills;
        }) => {
            const kit = slotsOf(
                realKit('Nifo'),
                opts.passive ? ['charged', 'passive'] : ['charged']
            );
            const ally = plain('ally', 'M4');
            const carrier = nifo({
                kit: { slots: [{ slot: 'active', abilities: [] }, ...kit.slots] },
                startCharged: true,
                chargeCount: 3,
                position: opts.struck === 'nifo' ? 'M4' : 'M3',
            });
            const allies = opts.struck === 'nifo' ? [] : [ally];
            const opp = opponent(opts.opponentKit ? { kit: opts.opponentKit } : {});
            const { events, id } = run(placement, carrier, allies, [opp], 1);
            const struckId = opts.struck === 'nifo' ? id(carrier) : id(ally);
            expect(takenFrom(events, id(opp), struckId)).toBeGreaterThan(0);
            return events
                .filter(
                    (e): e is Reflected =>
                        e.type === 'reactive-damage-performed' &&
                        e.sourceId === struckId &&
                        e.targetId === id(opp)
                )
                .reduce((sum, e) => sum + Math.round(e.amount), 0);
        };

        it('an ally holding Reflect III reflects 30% of the hit as thrown', () => {
            expect(reflected({ passive: false, struck: 'ally' })).toBe(3000);
        });

        it('Nifo holding it reflects the same', () => {
            expect(reflected({ passive: false, struck: 'nifo' })).toBe(3000);
        });

        it('his R4 passive increases an ally’s reflected damage by 15%', () => {
            expect(reflected({ passive: true, struck: 'ally' })).toBe(3450);
        });

        it('and his own reflected damage too (an ally includes self)', () => {
            expect(reflected({ passive: true, struck: 'nifo' })).toBe(3450);
        });

        it('a Nosorog ally’s own reflect grows by 15% under the R4 passive', () => {
            // No Reflect status here: Nifo carries only his passive, so the bounce is Nosorog's
            // own 16% reflect.
            const bounce = (withPassive: boolean) => {
                const carrier = nifo({
                    kit: withPassive ? slotsOf(realKit('Nifo'), ['passive']) : NO_KIT,
                });
                const nosorog: BoardUnit = {
                    id: 'nosorog',
                    kit: {
                        slots: [
                            { slot: 'active', abilities: [] },
                            ...realKit('Nosorog').slots.filter((sl) => sl.slot === 'passive'),
                        ],
                    },
                    position: 'M4',
                    speed: 1,
                };
                const opp = opponent();
                const { events, id } = run(placement, carrier, [nosorog], [opp], 1);
                expect(takenFrom(events, id(opp), id(nosorog))).toBeGreaterThan(0);
                return events
                    .filter(
                        (e): e is Reflected =>
                            e.type === 'reactive-damage-performed' &&
                            e.sourceId === id(nosorog) &&
                            e.targetId === id(opp)
                    )
                    .reduce((sum, e) => sum + Math.round(e.amount), 0);
            };
            expect(bounce(false)).toBe(1600);
            expect(bounce(true)).toBe(1840);
        });

        it('only a primary-target hit is reflected: a cone’s splash onto Nifo is not', () => {
            // Both hold Reflect III. The cone strikes the M4 ally as its primary target and
            // covers Nifo at M3 as a splash victim.
            const kit = slotsOf(realKit('Nifo'), ['charged']);
            const carrier = nifo({
                kit: { slots: [{ slot: 'active', abilities: [] }, ...kit.slots] },
                startCharged: true,
                chargeCount: 3,
            });
            const front = plain('front', 'M4');
            const opp = opponent({ pattern: parsePattern('Pattern-Cone-Range-1') });
            const { events, id } = run(placement, carrier, [front], [opp], 1);
            const reflectedBy = (sourceId: string) =>
                events
                    .filter(
                        (e): e is Reflected =>
                            e.type === 'reactive-damage-performed' &&
                            e.sourceId === sourceId &&
                            e.targetId === id(opp)
                    )
                    .reduce((sum, e) => sum + Math.round(e.amount), 0);
            expect(takenFrom(events, id(opp), id(carrier))).toBeGreaterThan(0);
            expect(reflectedBy(id(front))).toBe(3000);
            expect(reflectedBy(id(carrier))).toBe(0);
        });
    });
});
