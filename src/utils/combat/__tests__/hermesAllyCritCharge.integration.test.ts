/**
 * Hermes on-ally-crit charge gain — "per attack that crits", not "per crit".
 *
 * Hermes (docs/ship-skills.csv, first passive, verbatim): "When an ally critically hits an
 * enemy, this Unit gains 1 charge to its Charged Skill." The intended rule is ONE charge per
 * ally ATTACK that lands a crit — a single AoE (or multi-hit) attack that crits several victims
 * must grant exactly 1 charge, not one per critting (hit, victim) pair.
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

/** The main focus is an ally that lands a 3-hit crit (all hits crit -> critPairs === 3) on a
 *  single enemy. Hermes, its ally, should gain exactly ONE charge from that single attack. */
function runHermes() {
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
                            config: { type: 'damage', multiplier: 100, hits: 3 },
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
        pattern: basePattern(),
        teamActors: [hermesObserver('M3')],
        enemyAttackers: [dummyEnemy('enemy-a', 'M4')],
    };

    const bus = createEventBus();
    const chargeGains: Extract<CombatEvent, { type: 'charge-changed' }>[] = [];
    bus.on('charge-changed', (e) => {
        if (e.actorId === 'hermes' && e.reason === 'manip') chargeGains.push(e);
    });
    runCombat({ ...input, bus });
    return { chargeGains };
}

describe('Hermes on-ally-crit charge — one charge per attack that crits, not per crit', () => {
    it('a single 3-hit attack that crits grants Hermes exactly one charge', () => {
        const { chargeGains } = runHermes();
        // Pre-fix: 3 (one per critting hit). Post-fix: 1 (one per attack that crits).
        const totalGained = chargeGains.reduce((s, e) => s + (e.newCharge - e.oldCharge), 0);
        expect(totalGained).toBe(1);
    });
});
