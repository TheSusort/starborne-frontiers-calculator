/**
 * The Major Grand (#519, Colosso's add) on its real parsed kit. Owner rulings 2026-11-13:
 *   - its active reads its OWN debuff count at cast. Under 2: Hacking Up III to itself for 1 turn,
 *     60% damage on the front target and the hex behind it, and Marked (10 turns) inflicted on
 *     every ship hit with a normal landing roll;
 *   - 2 or more: the whole cast is cleansing 2 debuffs from itself and granting itself Security
 *     Up II for 2 turns — no Hacking Up III, no hit, no Marked;
 *   - its passive: on its death, by any cause, it cleanses 3 debuffs from each living ally.
 * Every board runs with the Major Grand on the player side and on the enemy side.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { buildCombatLog } from '../log/buildCombatLog';
import { LOG_EVENT_TYPES } from '../../calculators/battleSimulator';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { parsePattern, parseTarget } from '../../targetingParser';
import {
    boardInput,
    hitKit,
    NO_KIT,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { npcShip } from '../../../constants/bountyBosses';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';

beforeEach(() => setupKeyedRng(519));

const SIDES: Placement[] = ['player', 'enemy'];

const grandKit = (): ShipSkills => buildShipAbilities(npcShip('major-grand', 124)!);

/** Its kit with an extra `on-attack-cast` probe: a self Attack Up I that lands only after a cast
 *  that attacked. */
const ATTACK_PROBE = 'Attack Up I';
const withAttackProbe = (kit: ShipSkills): ShipSkills => ({
    ...kit,
    slots: kit.slots.map((slot) =>
        slot.slot === 'passive'
            ? {
                  ...slot,
                  abilities: [
                      ...slot.abilities,
                      {
                          id: 'attack-probe',
                          type: 'buff',
                          target: 'self',
                          trigger: 'on-attack-cast',
                          conditions: [],
                          config: {
                              type: 'buff',
                              buffName: ATTACK_PROBE,
                              duration: 2,
                              stacks: 1,
                              isStackable: false,
                              parsedEffects: {},
                          },
                      },
                  ],
              }
            : slot
    ),
});

const grand = (position: Position, extra: Partial<BoardUnit> = {}): BoardUnit => ({
    id: 'grand',
    kit: grandKit(),
    position,
    speed: 300,
    attack: 1000,
    // Marked lands on a 0-security victim whatever the roll.
    hacking: 100_000,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Line-Range-1'),
    ...extra,
});

const dummy = (id: string, position: Position, extra: Partial<BoardUnit> = {}): BoardUnit => ({
    id,
    kit: NO_KIT,
    position,
    speed: 1,
    ...extra,
});

const DEBUFFS = ['Attack Down I', 'Defense Down I', 'Crit Rate Down I', 'Hacking Down I'];

const debuffAbility = (buffName: string): Ability => ({
    id: `hex-${buffName}`,
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName,
        duration: 3,
        stacks: 1,
        isStackable: false,
        parsedEffects: {},
        application: 'apply',
    },
});

/** A fast unit that lands `count` debuffs on the front-most opposing ship of its row. */
const hexer = (id: string, position: Position, count: number): BoardUnit => ({
    id,
    kit: { slots: [{ slot: 'active', abilities: DEBUFFS.slice(0, count).map(debuffAbility) }] },
    position,
    speed: 400,
    hacking: 100_000,
});

interface Round1 {
    /** Who the Major Grand hit in round 1. */
    hit: Set<string>;
    /** Buffs the Major Grand granted in round 1: recipient → names. */
    granted: Map<string, string[]>;
    /** Every actor's debuffs and buffs at the end of round 1. */
    debuffs: Map<string, string[]>;
    buffs: Map<string, string[]>;
    /** The Major Grand cast its active in round 1. */
    cast: boolean;
    /** Debuffs the Major Grand cleansed in round 1. */
    cleansed: number;
}

const runRound1 = (input: Parameters<typeof runCombat>[0], grandId: string): Round1 => {
    const bus = createEventBus();
    const out: Round1 = {
        hit: new Set(),
        granted: new Map(),
        debuffs: new Map(),
        buffs: new Map(),
        cast: false,
        cleansed: 0,
    };
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.attackerId === grandId && e.round === 1) out.hit.add(e.targetId);
    });
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (e.round !== 1 || e.granterId !== grandId) return;
        out.granted.set(e.actorId, [...(out.granted.get(e.actorId) ?? []), e.buffName]);
    });
    bus.on('skill-fired', (e: Extract<CombatEvent, { type: 'skill-fired' }>) => {
        if (e.actorId === grandId && e.round === 1) out.cast = true;
    });
    bus.on('cleanse-performed', (e: Extract<CombatEvent, { type: 'cleanse-performed' }>) => {
        if (e.casterId === grandId && e.round === 1) out.cleansed += e.count;
    });
    bus.on('status-snapshot', (e: Extract<CombatEvent, { type: 'status-snapshot' }>) => {
        if (e.round !== 1) return;
        out.debuffs.set(e.actorId, e.debuffNames);
        out.buffs.set(e.actorId, e.buffNames);
    });
    runCombat({ ...input, bus });
    return out;
};

describe.each(SIDES)('Major Grand with fewer than 2 debuffs, on the %s side', (placement) => {
    // It sits in row M: its front target is m3, and the hex behind is m2. t3 is out of the line.
    it.each([0, 1])(
        'with %i own debuffs: Hacking Up III to itself, hits the target and the hex behind, Marks both',
        (own) => {
            const front = own > 0 ? hexer('m3', 'M3', own) : dummy('m3', 'M3');
            const opp = [front, dummy('m2', 'M2'), dummy('t3', 'T3')];
            const caster = grand('M1');
            const { input, id } = boardInput(placement, caster, [], opp, 1);
            const r = runRound1(input, id(caster));
            expect(r.granted.get(id(caster))).toEqual(['Hacking Up III']);
            expect([...r.hit].sort()).toEqual([id(opp[0]), id(opp[1])].sort());
            expect(r.debuffs.get(id(opp[0]))).toContain('Marked');
            expect(r.debuffs.get(id(opp[1]))).toContain('Marked');
            expect(r.debuffs.get(id(opp[2]))).not.toContain('Marked');
            expect(r.cleansed).toBe(0);
            expect(r.debuffs.get(id(caster))?.length ?? 0).toBe(own);
        }
    );

    it('an attacking cast fires its on-attack-cast reaction', () => {
        const opp = [dummy('m3', 'M3'), dummy('m2', 'M2')];
        const caster = grand('M1', { kit: withAttackProbe(grandKit()) });
        const { input, id } = boardInput(placement, caster, [], opp, 1);
        expect(runRound1(input, id(caster)).buffs.get(id(caster))).toContain(ATTACK_PROBE);
    });

    /** Marked landings and resists over `rounds` rounds of the Major Grand's casts, at 40
     *  hacking against 0-security victims: 40% without Hacking Up III's +60, certain with it. */
    const markedRolls = (kit: ShipSkills, rounds: number) => {
        const opp = [dummy('m3', 'M3'), dummy('m2', 'M2')];
        const caster = grand('M1', { kit, hacking: 40 });
        const { input, id } = boardInput(placement, caster, [], opp, rounds);
        const bus = createEventBus();
        const out = { landed: 0, resisted: 0 };
        bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
            if (e.sourceId === id(caster) && e.buffName === 'Marked') out.landed++;
        });
        bus.on('debuff-resisted', (e: Extract<CombatEvent, { type: 'debuff-resisted' }>) => {
            if (e.sourceId === id(caster) && e.buffName === 'Marked') out.resisted++;
        });
        runCombat({ ...input, bus });
        return out;
    };
    const withoutHackingUp = (kit: ShipSkills): ShipSkills => ({
        ...kit,
        slots: kit.slots.map((slot) => ({
            ...slot,
            abilities: slot.abilities.filter(
                (a) => !(a.config.type === 'buff' && a.config.buffName === 'Hacking Up III')
            ),
        })),
    });

    it('its own Hacking Up III counts toward the Marked roll of the same cast', () => {
        expect(markedRolls(grandKit(), 4)).toEqual({ landed: 8, resisted: 0 });
    });

    it('validity: without Hacking Up III the same Marks are resisted at times', () => {
        const { landed, resisted } = markedRolls(withoutHackingUp(grandKit()), 4);
        expect(landed + resisted).toBe(8);
        expect(resisted).toBeGreaterThan(0);
    });
});

describe.each(SIDES)('Major Grand counting DoT stacks as debuffs, on the %s side', (placement) => {
    const dot = (id: string, dotType: 'corrosion' | 'inferno', tier: number): Ability => ({
        id,
        type: 'dot',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'dot', dotType, tier, stacks: 1, duration: 3 },
    });
    /** A fast unit that lands `abilities` on the Major Grand (its row's front-most ship). */
    const burner = (abilities: Ability[]): BoardUnit => ({
        id: 'm3',
        kit: { slots: [{ slot: 'active', abilities }] },
        position: 'M3',
        speed: 400,
        attack: 1,
        hacking: 100_000,
    });

    it.each([
        ['two DoT stacks', [dot('c', 'corrosion', 3), dot('i', 'inferno', 15)]],
        [
            'a stat debuff and a DoT stack',
            [debuffAbility('Attack Down I'), dot('c', 'corrosion', 3)],
        ],
    ])('with %s it takes the 2+ branch and cleanses both', (_what, abilities) => {
        const opp = [burner(abilities), dummy('m2', 'M2')];
        const caster = grand('M1');
        const { input, id } = boardInput(placement, caster, [], opp, 1);
        const r = runRound1(input, id(caster));
        expect(r.hit.size).toBe(0);
        expect(r.granted.get(id(caster))).toEqual(['Security Up II']);
        expect(r.cleansed).toBe(2);
    });
});

describe.each(SIDES)('Major Grand with 2 or more debuffs, on the %s side', (placement) => {
    it.each([
        [2, 0],
        [3, 1],
    ])(
        'with %i own debuffs: cleanses 2 from itself (%i left) and gains Security Up II; nothing else',
        (own, left) => {
            const opp = [hexer('m3', 'M3', own), dummy('m2', 'M2')];
            const caster = grand('M1', { kit: withAttackProbe(grandKit()) });
            // An ally of its own, to show Security Up II stays on the Major Grand.
            const ally = dummy('ally', 'T1');
            const { input, id } = boardInput(placement, caster, [ally], opp, 1);
            const r = runRound1(input, id(caster));
            expect(r.cast).toBe(true);
            expect(r.cleansed).toBe(2);
            expect(r.debuffs.get(id(caster))).toHaveLength(left);
            expect(r.granted.get(id(caster))).toEqual(['Security Up II']);
            expect(r.granted.has(id(ally))).toBe(false);
            expect(r.granted.size).toBe(1);
            expect(r.hit.size).toBe(0);
            for (const o of opp) expect(r.debuffs.get(id(o)) ?? []).not.toContain('Marked');
            // A cast that dealt no damage is not an attack.
            expect(r.buffs.get(id(caster))).not.toContain(ATTACK_PROBE);
        }
    );

    it('its turn logs the cleanse and Security Up II, no attack entry', () => {
        const opp = [hexer('m3', 'M3', 2), dummy('m2', 'M2')];
        const caster = grand('M1');
        const { input, id } = boardInput(placement, caster, [], opp, 1);
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        for (const t of LOG_EVENT_TYPES) bus.on(t, (e) => events.push(e as CombatEvent));
        runCombat({ ...input, bus });
        const roster = [caster, ...opp].map((u) => ({
            actorId: id(u),
            side:
                (u === caster) === (placement === 'player')
                    ? ('player' as const)
                    : ('enemy' as const),
            name: u.id,
        }));
        const turns = buildCombatLog(events, roster, new Map())
            .flatMap((r) => r.turns)
            .filter((t) => t.actorId === id(caster));
        expect(turns).toHaveLength(1);
        expect(turns[0].entries.map((e) => [e.kind, e.note])).toEqual([
            ['cleanse', 'cleansed 2'],
            ['buff', 'Security Up II'],
        ]);
    });

    it('the damage-less cast still gains a charge, as any cast does', () => {
        // The Major Grand has no charged skill; a stand-in charged slot makes it bank charges.
        const kit = grandKit();
        const withCharged: ShipSkills = {
            ...kit,
            slots: [
                ...kit.slots,
                {
                    slot: 'charged',
                    abilities: [{ ...debuffAbility('Speed Down I'), id: 'stand-in' }],
                },
            ],
        };
        const opp = [hexer('m3', 'M3', 2), dummy('m2', 'M2')];
        const caster = grand('M1', { kit: withCharged, chargeCount: 3 });
        const { input, id } = boardInput(placement, caster, [], opp, 1);
        const bus = createEventBus();
        const gains: number[] = [];
        let hit = false;
        bus.on('charge-changed', (e: Extract<CombatEvent, { type: 'charge-changed' }>) => {
            if (e.actorId === id(caster) && e.reason === 'gen') gains.push(e.newCharge);
        });
        bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
            if (e.attackerId === id(caster)) hit = true;
        });
        runCombat({ ...input, bus });
        expect(hit).toBe(false);
        expect(gains).toEqual([1]);
    });
});

describe.each(SIDES)('Major Grand dying, on the %s side', (placement) => {
    /** Two allies of the Major Grand's, each carrying four debuffs from a hexer in its row. */
    const allies = () => [dummy('ally-t', 'T1'), dummy('ally-b', 'B1')];
    const hexers = () => [hexer('hex-t', 'T3', 4), hexer('hex-b', 'B3', 4)];

    const killer = (kit: ShipSkills, attack: number): BoardUnit => ({
        id: 'killer',
        kit: { ...kit, controlImmune: true },
        position: 'M3',
        speed: 350,
        attack,
        hacking: 100_000,
    });

    const inferno: Ability = {
        id: 'inferno',
        type: 'dot',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'dot', dotType: 'inferno', tier: 45, stacks: 1, duration: 3 },
    };
    /** A 1% hit that cannot kill it, carrying an Inferno whose turn-start tick does. */
    const burnKit: ShipSkills = {
        slots: [
            {
                slot: 'active',
                abilities: [{ ...hitKit(1).slots[0].abilities[0] }, inferno],
            },
        ],
    };

    it.each([
        ['a direct hit', hitKit(100), true],
        ['a DoT', burnKit, false],
    ] as const)('killed by %s, it cleanses 3 debuffs from each ally', (_how, killKit, direct) => {
        const al = allies();
        const caster = grand('M1', { speed: 1, hp: 1000 });
        const { input, id } = boardInput(
            placement,
            caster,
            al,
            [...hexers(), killer(killKit, 10_000)],
            1
        );
        const bus = createEventBus();
        let death: Extract<CombatEvent, { type: 'ship-destroyed' }> | undefined;
        const debuffs = new Map<string, string[]>();
        bus.on('ship-destroyed', (e: Extract<CombatEvent, { type: 'ship-destroyed' }>) => {
            if (e.actorId === id(caster)) death = e;
        });
        bus.on('status-snapshot', (e: Extract<CombatEvent, { type: 'status-snapshot' }>) => {
            if (e.round === 1) debuffs.set(e.actorId, e.debuffNames);
        });
        runCombat({ ...input, bus });
        expect(death?.round).toBe(1);
        expect(death?.byDirectDamage === true).toBe(direct);
        for (const ally of al) expect(debuffs.get(id(ally))).toHaveLength(1);
    });

    it('validity: alive, its allies keep all four debuffs', () => {
        const al = allies();
        const caster = grand('M1', { speed: 1 });
        const { input, id } = boardInput(placement, caster, al, hexers(), 1);
        const bus = createEventBus();
        const debuffs = new Map<string, string[]>();
        bus.on('status-snapshot', (e: Extract<CombatEvent, { type: 'status-snapshot' }>) => {
            if (e.round === 1) debuffs.set(e.actorId, e.debuffNames);
        });
        runCombat({ ...input, bus });
        for (const ally of al) expect(debuffs.get(id(ally))).toHaveLength(4);
    });
});
