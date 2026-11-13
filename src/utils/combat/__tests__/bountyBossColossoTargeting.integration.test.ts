/**
 * General Colosso's targeting (#519, `marked-or-front` + `Pattern-Horseshoe-Range-1`), on his real
 * parsed kit. Owner rulings 2026-11-13:
 *   - with at least one living Marked enemy, the cast is one single-target, full-damage, primary
 *     hit on each Marked enemy and nothing else; their Marked is then removed; no Hacking Up;
 *   - with no Marked enemy, all his allies gain Hacking Up II (III on the charged) for 1 turn, then
 *     one hit by normal front targeting with the five surrounding hexes at 50%;
 *   - Taunt never steers him (control immunity);
 *   - both branches carry 50% defence penetration;
 *   - Marked is unremovable: a cleanse skips it.
 * Every board runs with Colosso on the player side and on the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { parsePattern, parseTarget } from '../../targetingParser';
import {
    boardInput,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { bossShip } from '../../../constants/bountyBosses';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(519));

const SIDES: Placement[] = ['player', 'enemy'];
const COLOSSO_DEFENCE = 10_000;
/** 175% of his defence against a 0-defence victim. */
const FULL = 17_500;

/** His real active and charged, and his kit-level control immunity. The passive is left out: its
 *  Defense Up III would scale every number here. */
const colossoKit = (): ShipSkills => {
    const kit = buildShipAbilities(bossShip('colosso', 32)!);
    return { ...kit, slots: kit.slots.filter((s) => s.slot !== 'passive') };
};

const colosso = (position: Position, kit: ShipSkills = colossoKit()): BoardUnit => ({
    id: 'colosso',
    kit,
    position,
    speed: 300,
    defence: COLOSSO_DEFENCE,
    chargeCount: 2,
    target: parseTarget('marked-or-front'),
    pattern: parsePattern('Pattern-Horseshoe-Range-1'),
});

const dummy = (id: string, position: Position, extra: Partial<BoardUnit> = {}): BoardUnit => ({
    id,
    kit: NO_KIT,
    position,
    speed: 1,
    ...extra,
});

const statusAbility = (
    type: 'buff' | 'debuff',
    target: 'self' | 'enemy',
    buffName: string,
    duration: number
): Ability =>
    ({
        id: `${type}-${buffName}`,
        type,
        target,
        trigger: 'on-cast',
        conditions: [],
        config: {
            type,
            buffName,
            duration,
            stacks: 1,
            isStackable: false,
            parsedEffects: {},
            ...(type === 'debuff' ? { application: 'apply' } : {}),
        },
    }) as Ability;

/** A fast ally of Colosso's that Marks the front-most opposing ship of its own row. */
const marker = (id: string, position: Position): BoardUnit => ({
    id,
    kit: {
        slots: [{ slot: 'active', abilities: [statusAbility('debuff', 'enemy', 'Marked', 10)] }],
    },
    position,
    speed: 400,
    hacking: 100_000,
});

/** An opponent that taunts after the markers act and before Colosso does. */
const taunter = (id: string, position: Position): BoardUnit => ({
    id,
    kit: { slots: [{ slot: 'active', abilities: [statusAbility('buff', 'self', 'Taunt', 3)] }] },
    position,
    speed: 350,
});

interface Round1 {
    /** Damage each unit took from Colosso in round 1, and whether each hit was primary. */
    hits: Map<string, { taken: number; primary: boolean[] }>;
    /** Hacking Up grants Colosso made in round 1: recipient → buff name. */
    hackingUp: Map<string, string>;
    /** Every actor's debuffs at the end of round 1. */
    debuffs: Map<string, string[]>;
}

const runRound1 = (input: Parameters<typeof runCombat>[0], colossoId: string): Round1 => {
    const bus = createEventBus();
    const out: Round1 = { hits: new Map(), hackingUp: new Map(), debuffs: new Map() };
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.attackerId !== colossoId || e.round !== 1) return;
        const prior = out.hits.get(e.targetId) ?? { taken: 0, primary: [] };
        prior.taken += e.takenDamage ?? 0;
        prior.primary.push(e.isPrimaryTarget === true);
        out.hits.set(e.targetId, prior);
    });
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (e.round !== 1 || e.granterId !== colossoId) return;
        if (e.buffName.startsWith('Hacking Up')) out.hackingUp.set(e.actorId, e.buffName);
    });
    bus.on('status-snapshot', (e: Extract<CombatEvent, { type: 'status-snapshot' }>) => {
        if (e.round === 1) out.debuffs.set(e.actorId, e.debuffNames);
    });
    runCombat({ ...input, bus });
    for (const h of out.hits.values()) h.taken = Math.round(h.taken);
    return out;
};

describe.each(SIDES)('Colosso with Marked enemies, on the %s side', (placement) => {
    // Colosso sits in row M, so unmarked his front hit would land on m3. The markers Mark t4
    // (front of row T) and b3 (front of row B).
    const opponents = () => [
        dummy('t4', 'T4'),
        dummy('m3', 'M3'),
        dummy('m2', 'M2'),
        dummy('b3', 'B3'),
        dummy('b2', 'B2'),
    ];
    const allies = () => [marker('mark-t', 'T1'), marker('mark-b', 'B1')];

    it('hits each Marked enemy once at full damage as a primary target, nobody else', () => {
        const opp = opponents();
        const caster = colosso('M1');
        const { input, id } = boardInput(placement, caster, allies(), opp, 1);
        const { hits } = runRound1(input, id(caster));
        const marked = [id(opp[0]), id(opp[3])];
        expect([...hits.keys()].sort()).toEqual([...marked].sort());
        for (const victim of marked)
            expect(hits.get(victim)).toEqual({ taken: FULL, primary: [true] });
    });

    it('removes Marked from both victims after the hit', () => {
        const opp = opponents();
        const caster = colosso('M1');
        const { input, id } = boardInput(placement, caster, allies(), opp, 1);
        const { debuffs } = runRound1(input, id(caster));
        expect(debuffs.get(id(opp[0]))).not.toContain('Marked');
        expect(debuffs.get(id(opp[3]))).not.toContain('Marked');
    });

    it('validity: without Colosso the Marks stand at the end of the round', () => {
        const opp = opponents();
        const caster = { ...colosso('M1'), kit: NO_KIT };
        const { input, id } = boardInput(placement, caster, allies(), opp, 1);
        const { debuffs } = runRound1(input, id(caster));
        expect(debuffs.get(id(opp[0]))).toContain('Marked');
        expect(debuffs.get(id(opp[3]))).toContain('Marked');
    });

    it('rolls crit separately for each Marked victim', () => {
        // At 50% crit the two victims' rolls must part ways at least once over the rounds; one
        // roll shared by the cast would keep them equal every round.
        const opp = opponents();
        const caster = { ...colosso('M1'), crit: 50, critDamage: 100 };
        const { input, id } = boardInput(placement, caster, allies(), opp, 8);
        const bus = createEventBus();
        const crits = new Map<number, Map<string, boolean>>();
        bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
            if (e.attackerId !== id(caster)) return;
            const round = crits.get(e.round) ?? new Map<string, boolean>();
            round.set(e.targetId, e.didCrit === true);
            crits.set(e.round, round);
        });
        runCombat({ ...input, bus });
        const pairs = [...crits.values()].map((r) => [r.get(id(opp[0])), r.get(id(opp[3]))]);
        expect(pairs.length).toBeGreaterThanOrEqual(6);
        expect(pairs.some(([a, b]) => a !== b)).toBe(true);
    });

    it("an on-cast purge fans over both Marked victims, the cast's own footprint", () => {
        // t4's horseshoe holds nobody else, so a footprint read off the anchor alone reaches t4 only.
        const kit = colossoKit();
        const purge: Ability = {
            id: 'probe-purge',
            type: 'purge',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'purge', count: 1 },
        };
        const withPurge: ShipSkills = {
            ...kit,
            slots: kit.slots.map((slot) =>
                slot.slot === 'active' ? { ...slot, abilities: [...slot.abilities, purge] } : slot
            ),
        };
        const buffed = (id: string, position: Position): BoardUnit => ({
            ...dummy(id, position),
            speed: 350,
            kit: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [statusAbility('buff', 'self', 'Attack Up I', 3)],
                    },
                ],
            },
        });
        const opp = [buffed('t4', 'T4'), dummy('m3', 'M3'), dummy('m2', 'M2'), buffed('b3', 'B3')];
        const caster = colosso('M1', withPurge);
        const { input, id } = boardInput(placement, caster, allies(), opp, 1);
        const bus = createEventBus();
        const buffs = new Map<string, string[]>();
        bus.on('status-snapshot', (e: Extract<CombatEvent, { type: 'status-snapshot' }>) => {
            if (e.round === 1) buffs.set(e.actorId, e.buffNames);
        });
        runCombat({ ...input, bus });
        expect(buffs.get(id(opp[0]))).not.toContain('Attack Up I');
        expect(buffs.get(id(opp[3]))).not.toContain('Attack Up I');
    });

    it('Protection still redirects a Marked hit (30% to Meatshield, who is not Marked)', () => {
        const meatshield: BoardUnit = {
            id: 'meatshield',
            kit: {
                slots: realKit('Meatshield').slots.map((slot) =>
                    slot.slot === 'passive' ? slot : { slot: slot.slot, abilities: [] }
                ),
            },
            position: 'B4',
            speed: 1,
        };
        const victim = dummy('victim', 'M4');
        const opp = [victim, meatshield];
        const caster = colosso('T1');
        const { input, id } = boardInput(placement, caster, [marker('mark-m', 'M1')], opp, 1);
        const { hits, debuffs } = runRound1(input, id(caster));
        expect([...hits.keys()]).toEqual([id(victim)]);
        expect(hits.get(id(victim))).toEqual({ taken: FULL * 0.7, primary: [true] });
        expect(debuffs.get(id(meatshield))).toEqual(['Damage over Time']);
    });

    it('grants no Hacking Up', () => {
        const opp = opponents();
        const caster = colosso('M1');
        const { input, id } = boardInput(placement, caster, allies(), opp, 1);
        expect(runRound1(input, id(caster)).hackingUp.size).toBe(0);
    });

    it('a taunting enemy does not pull the Marked hit', () => {
        const opp = [...opponents(), taunter('taunt', 'M4')];
        const caster = colosso('M1');
        const { input, id } = boardInput(placement, caster, allies(), opp, 1);
        const { hits } = runRound1(input, id(caster));
        expect([...hits.keys()].sort()).toEqual([id(opp[0]), id(opp[3])].sort());
    });
});

describe.each(SIDES)('Colosso with no Marked enemy, on the %s side', (placement) => {
    // Front target m3 (front of Colosso's row M); its horseshoe covers M2, T2, T3, B2, B3. T1 and
    // B1 lie outside it.
    const opponents = () => [
        dummy('m3', 'M3'),
        dummy('m2', 'M2'),
        dummy('t3', 'T3'),
        dummy('t2', 'T2'),
        dummy('b3', 'B3'),
        dummy('b2', 'B2'),
        dummy('t1', 'T1'),
        dummy('b1', 'B1'),
    ];
    const ally = () => dummy('ally', 'T2');

    it('hits the front target at full damage and its five surrounding hexes at 50%', () => {
        const opp = opponents();
        const caster = colosso('M1');
        const { input, id } = boardInput(placement, caster, [ally()], opp, 1);
        const { hits } = runRound1(input, id(caster));
        expect(hits.get(id(opp[0]))).toEqual({ taken: FULL, primary: [true] });
        for (const covered of opp.slice(1, 6))
            expect(hits.get(id(covered))).toEqual({ taken: FULL / 2, primary: [false] });
        expect(hits.has(id(opp[6]))).toBe(false);
        expect(hits.has(id(opp[7]))).toBe(false);
    });

    it('grants Hacking Up II to every ally, himself included, on the active', () => {
        const opp = opponents();
        const caster = colosso('M1');
        const friend = ally();
        const { input, id } = boardInput(placement, caster, [friend], opp, 1);
        const { hackingUp } = runRound1(input, id(caster));
        expect(hackingUp).toEqual(
            new Map([
                [id(caster), 'Hacking Up II'],
                [id(friend), 'Hacking Up II'],
            ])
        );
    });

    it('grants the Hacking Up before his hit lands', () => {
        const opp = opponents();
        const caster = colosso('M1');
        const { input, id } = boardInput(placement, caster, [ally()], opp, 1);
        const bus = createEventBus();
        const order: string[] = [];
        bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
            if (e.round === 1 && e.granterId === id(caster)) order.push('grant');
        });
        bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
            if (e.round === 1 && e.attackerId === id(caster)) order.push('hit');
        });
        runCombat({ ...input, bus });
        expect(order.indexOf('grant')).toBeGreaterThanOrEqual(0);
        expect(order.indexOf('grant')).toBeLessThan(order.indexOf('hit'));
    });

    it('grants Hacking Up III on the charged', () => {
        const opp = opponents();
        const caster = { ...colosso('M1'), startCharged: true };
        const friend = ally();
        const { input, id } = boardInput(placement, caster, [friend], opp, 1);
        const { hackingUp } = runRound1(input, id(caster));
        expect(hackingUp).toEqual(
            new Map([
                [id(caster), 'Hacking Up III'],
                [id(friend), 'Hacking Up III'],
            ])
        );
    });

    it('a taunting enemy does not pull his front hit', () => {
        const opp = [...opponents(), taunter('taunt', 'T4')];
        const caster = colosso('M1');
        const { input, id } = boardInput(placement, caster, [ally()], opp, 1);
        const { hits } = runRound1(input, id(caster));
        expect(hits.get(id(opp[0]))).toEqual({ taken: FULL, primary: [true] });
        expect(hits.has(id(opp[8]))).toBe(false);
    });

    it('validity: a front attacker without control immunity is pulled by the same Taunt', () => {
        const opp = [...opponents(), taunter('taunt', 'T4')];
        const kit = colossoKit();
        const caster = { ...colosso('M1'), kit: { ...kit, controlImmune: false } };
        const { input, id } = boardInput(placement, caster, [ally()], opp, 1);
        const { hits } = runRound1(input, id(caster));
        expect(hits.get(id(opp[8]))?.primary).toEqual([true]);
    });

    it('the 50% defence penetration reaches the hit', () => {
        // 3,500 defence is 50% damage reduction (def / (def + 3500)); halved to 1,750 it is 1/3.
        const opp = [dummy('m3', 'M3', { defence: 3_500 })];
        const caster = colosso('M1');
        const { input, id } = boardInput(placement, caster, [], opp, 1);
        const { hits } = runRound1(input, id(caster));
        expect(hits.get(id(opp[0]))?.taken).toBe(Math.round((FULL * 2) / 3));
    });
});

describe.each(SIDES)('Marked is unremovable, holder on the %s side', (placement) => {
    it("a holder's 1-debuff cleanse skips the newer Marked and spends itself on the other debuff", () => {
        // Cleanse removes newest first, and Marked lands last: a cleanse that counted Marked as
        // removed would leave Speed Down I in place.
        const cleanse: Ability = {
            id: 'cleanse-self',
            type: 'cleanse',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'cleanse', count: 1 },
        };
        const holder = dummy('holder', 'M4', {
            speed: 350,
            kit: { slots: [{ slot: 'active', abilities: [cleanse] }] },
        });
        const markerUnit: BoardUnit = {
            ...marker('marker', 'M1'),
            kit: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            statusAbility('debuff', 'enemy', 'Speed Down I', 10),
                            statusAbility('debuff', 'enemy', 'Marked', 10),
                        ],
                    },
                ],
            },
        };
        const { input, id } = boardInput(placement, markerUnit, [], [holder], 1);
        const bus = createEventBus();
        const debuffs = new Map<string, string[]>();
        bus.on('status-snapshot', (e: Extract<CombatEvent, { type: 'status-snapshot' }>) => {
            if (e.round === 1) debuffs.set(e.actorId, e.debuffNames);
        });
        runCombat({ ...input, bus });
        expect(debuffs.get(id(holder))).toContain('Marked');
        expect(debuffs.get(id(holder))).not.toContain('Speed Down I');
    });
});

describe.each(SIDES)('multi-hex Colosso aims from his centre, on the %s side', (placement) => {
    // His real footprint T3/M3/M4/B3: anchor T3, centre M3. Enemies hold rows T and M. Scanning
    // from his anchor row T would hit t4; from his centre row M he hits m4, and the horseshoe
    // around M4 covers M3, T3 and T4.
    const FOOTPRINT = ['T3', 'M3', 'M4', 'B3'] as const;

    it('hits the M-row front with the horseshoe around it, nobody Marked', () => {
        const opp = [
            dummy('t4', 'T4'),
            dummy('t3', 'T3'),
            dummy('t2', 'T2'),
            dummy('m4', 'M4'),
            dummy('m3', 'M3'),
            dummy('m2', 'M2'),
        ];
        const caster = colosso('T3');
        const { input, id } = boardInput(placement, caster, [], opp, 1);
        const withFootprint =
            placement === 'player'
                ? { ...input, footprint: FOOTPRINT }
                : {
                      ...input,
                      enemyAttackers: input.enemyAttackers.map((e) =>
                          e.id === caster.id ? { ...e, footprint: FOOTPRINT } : e
                      ),
                  };
        const { hits } = runRound1(withFootprint, id(caster));
        const byId = (unitId: string) => id(opp.find((u) => u.id === unitId)!);
        expect(hits.get(byId('m4'))).toEqual({ taken: FULL, primary: [true] });
        for (const covered of ['m3', 't3', 't4'])
            expect(hits.get(byId(covered))).toEqual({ taken: FULL / 2, primary: [false] });
        expect(hits.has(byId('m2'))).toBe(false);
        expect(hits.has(byId('t2'))).toBe(false);
    });

    it('every hit of a multi-hit cast re-resolves from his centre too', () => {
        // Two hits: the second re-resolves its anchor from the live board.
        const kit = colossoKit();
        const twoHits: ShipSkills = {
            ...kit,
            slots: kit.slots.map((slot) => ({
                ...slot,
                abilities: slot.abilities.map((a) =>
                    a.config.type === 'damage' ? { ...a, config: { ...a.config, hits: 2 } } : a
                ),
            })),
        };
        const opp = [dummy('t4', 'T4'), dummy('m4', 'M4')];
        const caster = colosso('T3', twoHits);
        const { input, id } = boardInput(placement, caster, [], opp, 1);
        const withFootprint =
            placement === 'player'
                ? { ...input, footprint: FOOTPRINT }
                : {
                      ...input,
                      enemyAttackers: input.enemyAttackers.map((e) =>
                          e.id === caster.id ? { ...e, footprint: FOOTPRINT } : e
                      ),
                  };
        const { hits } = runRound1(withFootprint, id(caster));
        expect(hits.get(id(opp[1]))?.primary).toEqual([true, true]);
        expect(hits.get(id(opp[0]))?.primary).toEqual([false, false]);
    });
});
