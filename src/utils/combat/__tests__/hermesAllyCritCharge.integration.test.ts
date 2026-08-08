/**
 * Hermes on-ally-crit charge gain — "per attack that crits", not "per crit".
 *
 * Hermes (docs/ship-skills.csv, first passive, verbatim): "When an ally critically hits an
 * enemy, this Unit gains 1 charge to its Charged Skill." The rule is ONE charge per ally ATTACK
 * that lands a crit, never one per critting (hit, victim) pair — so an AoE footprint that crits
 * several victims grants exactly 1.
 *
 * "ATTACK" means SUB-ATTACK. A `hits: N` skill is N consecutive FULL-WALK attacks (locked game
 * rule) emitting N `ability-performed` events, so it grants N charges. Both halves are asserted
 * below, and they are what discriminate the two mechanisms: the per-attack collapse lives in the
 * `on-ally-crit` LISTENER (at most one enqueue per event) and is what fixes the original bug,
 * while the executor's `oncePerAttackGuardKey` — which used to hold self riders at one per actor
 * TURN — no longer covers this trigger.
 *
 * The ability is extracted through the REAL production path (buildShipAbilities on verbatim CSV
 * skill text), never a hand-built ability.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}], ...over } as Ship;
}

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const HERMES_P1 =
    'When an ally critically hits an enemy, this Unit <unit-aid>gains 1 charge</unit-aid> to its Charged Skill.';

/** Hermes' on-ally-crit charge ability through the REAL parser/builder. */
function hermesChargeAbility(): Ability {
    const abilities =
        buildShipAbilities(ship({ firstPassiveSkillText: HERMES_P1 })).slots.find(
            (s) => s.slot === 'passive'
        )?.abilities ?? [];
    const charge = abilities.find((a) => a.type === 'charge');
    if (!charge) throw new Error('mutation guard: Hermes on-ally-crit charge not found');
    return charge;
}

describe('Hermes charge ability — extracted shape (mutation guard)', () => {
    it('rides on-ally-crit, self-targeted, +1 charge', () => {
        const c = hermesChargeAbility();
        expect(c.trigger).toBe('on-ally-crit');
        expect(c.target).toBe('self');
        expect(c.config).toMatchObject({ type: 'charge', amount: 1 });
    });
});

/** A dummy enemy target: fat HP, does nothing meaningful. */
const dummyEnemy = (id: string, position: Position): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'noop',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 0 },
                        },
                    ],
                },
            ],
        },
    }) as EnemyAttacker;

/** Hermes observer (team actor): its ONLY ability is the on-ally-crit charge passive. It has a
 *  chargeCount headroom of 6 and acts last (speed 1) so the ally crit precedes it. */
const hermesObserver = (position: Position): TeamActorEngineInput =>
    ({
        id: 'hermes',
        speed: 1,
        chargeCount: 6,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        walk: {
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'noop',
                                type: 'damage',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'damage', multiplier: 0 },
                            },
                        ],
                    },
                    { slot: 'passive', abilities: [hermesChargeAbility()] },
                ],
            },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 20_000,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    }) as TeamActorEngineInput;

/** The focus ally crits, and Hermes counts the ATTACKS. Two shapes are driven through the same
 *  input: `hits: 3` on one enemy (three consecutive full-walk attacks → three charges) and a
 *  single-hit whole-roster AoE critting two victims (ONE attack → one charge). */
function runHermes(opts: { hits: number; pattern: ParsedPattern; enemies: EnemyAttacker[] }) {
    const input: CombatEngineInput = {
        attack: 1000,
        crit: 100, // every hit crits
        critDamage: 100,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'multi-hit',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: {
                                type: 'damage',
                                multiplier: 100,
                                ...(opts.hits > 1 ? { hits: opts.hits } : {}),
                            },
                        },
                    ],
                },
            ],
        },
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds: 1,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: 500, // acts before Hermes
        healTargetId: 'hermes',
        position: 'M1',
        target: parsedTarget('front'),
        pattern: opts.pattern,
        teamActors: [hermesObserver('M3')],
        enemyAttackers: opts.enemies,
    };

    const bus = createEventBus();
    const chargeGains: Extract<CombatEvent, { type: 'charge-changed' }>[] = [];
    const perf: Extract<CombatEvent, { type: 'ability-performed' }>[] = [];
    bus.on('ability-performed', (e) => {
        if (e.actorId === 'attacker') perf.push(e);
    });
    bus.on('charge-changed', (e) => {
        if (e.actorId === 'hermes' && e.reason === 'manip') chargeGains.push(e);
    });
    runCombat({ ...input, bus });
    return {
        totalGained: chargeGains.reduce((s, e) => s + (e.newCharge - e.oldCharge), 0),
        perf,
    };
}

describe('Hermes on-ally-crit charge — one charge per attack that crits, not per crit', () => {
    it('a hits:3 attack that crits every sub-attack grants Hermes three charges', () => {
        const { totalGained, perf } = runHermes({
            hits: 3,
            pattern: basePattern(),
            enemies: [dummyEnemy('enemy-a', 'M4')],
        });
        // Fixture self-check: three attacks, one critting victim each.
        expect(perf).toHaveLength(3);
        expect(perf.map((e) => e.critHits)).toEqual([1, 1, 1]);
        // `hits: 3` is THREE consecutive full-walk attacks (locked game rule), each emitting its
        // own `ability-performed`, so "one charge per attack that crits" is three charges. This
        // read 1 while `on-ally-crit` sat in PER_HIT_REACTIVE_TRIGGERS and the executor collapsed
        // self riders per actor TURN — a user-approved behaviour change, not the per-crit bug.
        expect(totalGained).toBe(3);
    });

    it('a single-hit AoE critting TWO victims still grants exactly one charge', () => {
        const { totalGained, perf } = runHermes({
            hits: 1,
            pattern: { raw: 'all', shape: 'all', range: 'all', modifiers: {} } as ParsedPattern,
            enemies: [dummyEnemy('enemy-a', 'M4'), dummyEnemy('enemy-b', 'M3')],
        });
        // Fixture self-check: ONE attack, TWO critting (hit, victim) pairs — the axis under test.
        expect(perf).toHaveLength(1);
        expect(perf[0].critHits).toBe(2);
        // THE original bug, which must stay fixed: pre-fix this read 2 (one per critting pair).
        // The collapse lives in the listener (at most one enqueue per `ability-performed`), NOT in
        // the executor's per-turn guard, so it survives the behaviour change above.
        expect(totalGained).toBe(1);
    });
});
