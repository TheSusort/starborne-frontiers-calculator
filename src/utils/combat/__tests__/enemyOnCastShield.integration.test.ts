/**
 * enemyOnCastShield.integration.test.ts — enemy on-cast self-shields (positional two-team sim).
 *
 * Symmetric counterpart to E5's enemy HEAL lift: an enemy ship's on-cast SHIELD ability now grants
 * a real shieldPool (capped at the recipient's own max HP), absorbs player damage, and emits
 * shield-applied — previously the shield branch bailed for enemy casters (healEventOnly continue).
 *
 * Proves: (1) enemy gains a pool + emits ONE shield-applied keyed on the enemy granter; (2) the
 * pool absorbs player damage AND chains to the enemy Nyxen shield-hit counter end-to-end (real
 * registry); (3) the enemy shield-applied drives a downstream on-shield-applied reactive
 * (Resonating-Fury-style buff → buff-applied keyed on the enemy).
 *
 * PRE-FIX every positive case here fails: no enemy pool is granted, no shield-applied is emitted,
 * so nothing absorbs, no counter gates true, and no on-shield-applied reactive wakes.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { CombatActor } from '../state';
import { Ship } from '../../../types/ship';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// Verbatim CSV-derived Nyxen text (docs/ship-skills.csv): active grants a 15%-Max-HP self-shield;
// first passive parses to an on-attacked counter with requireShieldHit:true.
const NYXEN_ACTIVE =
    'This Unit <unit-aid>Cleanses 2 bombs</unit-aid>, Grants a <unit-damage>Shield equal to 15%</unit-damage> of its Max HP, and Grants <unit-skill>Atlas Readiness II</unit-skill> for 1 turn.';
const NYXEN_P1 =
    'This Unit deals <unit-damage>100% damage</unit-damage> when its Shield is directly damaged.';

function nyxenShip(withActiveShield = true): Ship {
    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}],
        ...(withActiveShield ? { activeSkillText: NYXEN_ACTIVE } : {}),
        firstPassiveSkillText: NYXEN_P1,
    } as Ship;
}

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'eocs-basic',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 100 },
        },
    ],
});

// A POSITIONED enemy carrying the given parsed shipSkills (its active is what it casts each turn).
const enemyAt = (
    id: string,
    position: Position,
    shipSkills: ShipSkills,
    attack: number,
    hp: number,
    speed: number
): EnemyAttacker => ({
    id,
    stats: { attack, crit: 0, critDamage: 0, defence: 0, hp, speed },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills,
});

// Player FOCUS at M4 fires `front` (anchors the enemy) with a 100% damage active, acts FIRST
// (speed 200), immortal so enemy counters never kill it (counters read via perTargetDamage).
const playerAttacksEnemy = (
    enemies: EnemyAttacker[],
    overrides: Partial<CombatEngineInput> = {}
): CombatEngineInput => ({
    attack: 10_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicAttack()] },
    numRounds: 3,
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
    speed: 200,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    enemyAttackers: enemies,
    ...overrides,
});

const totalPerTargetDamage = (result: ReturnType<typeof runCombat>, actorId: string): number => {
    let sum = 0;
    for (const rd of result.rounds) sum += rd.perTargetDamage?.[actorId] ?? 0;
    return sum;
};

// An enemy whose ACTIVE grants a self-shield (no damage); plus an optional extra passive ability.
const selfShieldActiveSkills = (pct: number, extraPassive?: Ability): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'enemy-oncast-shield',
                    type: 'shield',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'shield', pct, basis: 'hp' },
                },
            ],
        },
        ...(extraPassive ? [{ slot: 'passive' as const, abilities: [extraPassive] }] : []),
    ],
});

describe('enemy on-cast self-shield: pool grant + shield-applied emission', () => {
    it('an enemy self-shield active grants a pool and emits ONE shield-applied keyed on the enemy', () => {
        const bus = createEventBus();
        const events: Extract<CombatEvent, { type: 'shield-applied' }>[] = [];
        bus.on('shield-applied', (e) => {
            if (e.type === 'shield-applied') events.push(e);
        });
        let captured: CombatActor[] = [];
        runCombat(
            playerAttacksEnemy(
                // enemy hp 40_000 → 50% self-shield = 20_000; player 10_000 only dents it.
                [enemyAt('foe', 'M4', selfShieldActiveSkills(50), 1_000, 40_000, 50)],
                {
                    bus,
                    __testTapActors: (actors) => {
                        captured = actors;
                    },
                }
            )
        );
        const foe = captured.find((a) => a.id === 'foe');
        expect(foe?.shieldPool ?? 0).toBeGreaterThan(0); // enemy gained a real pool
        const enemyEvents = events.filter((e) => e.granterId === 'foe');
        expect(enemyEvents.length).toBeGreaterThan(0);
        expect(enemyEvents[0].recipientIds).toEqual(['foe']); // self-shield → self recipient
        expect(enemyEvents[0].amount).toBeGreaterThan(0);
    });

    it('NEGATIVE control: a 0% enemy shield grants nothing and emits no shield-applied', () => {
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        bus.on('shield-applied', (e) => events.push(e));
        let captured: CombatActor[] = [];
        runCombat(
            playerAttacksEnemy(
                [enemyAt('foe', 'M4', selfShieldActiveSkills(0), 1_000, 40_000, 50)],
                {
                    bus,
                    __testTapActors: (actors) => {
                        captured = actors;
                    },
                }
            )
        );
        const foe = captured.find((a) => a.id === 'foe');
        expect(foe?.shieldPool ?? 0).toBe(0);
        expect(
            events.filter((e) => e.type === 'shield-applied' && e.granterId === 'foe')
        ).toHaveLength(0);
    });
});

describe('enemy on-cast self-shield: chains to the enemy Nyxen shield-hit counter', () => {
    it('enemy NYXEN gains its REAL active 15%-Max-HP shield and counters when the player dents it', () => {
        // Real registry → active self-shield + passive shield-hit counter. The player (speed 200)
        // hits FIRST each round; the enemy (speed 50) casts its shield on its turn. So round 1 the
        // player hits an UNSHIELDED enemy (no counter); from round 2 the player dents the LIVE shield
        // → player→enemy attacked emit carries shieldWasHit:true → Nyxen counters (enemy attack × 100%).
        const nyxen = buildShipAbilities(nyxenShip(/* withActiveShield */ true));
        const result = runCombat(
            playerAttacksEnemy([enemyAt('foe', 'M4', nyxen, 9_000, 40_000, 50)])
        );
        const counterRounds = result.rounds
            .map((rd) => rd.perTargetDamage?.['attacker'] ?? 0)
            .filter((d) => d > 0);
        expect(counterRounds.length).toBeGreaterThan(0);
        for (const dealt of counterRounds) expect(dealt).toBeCloseTo(9_000, 6);
        // Round 1: enemy has not cast its shield yet → no shield dent → no counter.
        expect(result.rounds[0].perTargetDamage?.['attacker'] ?? 0).toBe(0);
    });

    it('NEGATIVE control: enemy Nyxen WITHOUT its active shield never counters (no pool exists)', () => {
        const nyxenNoShield = buildShipAbilities(nyxenShip(/* withActiveShield */ false));
        const result = runCombat(
            playerAttacksEnemy([enemyAt('foe', 'M4', nyxenNoShield, 9_000, 40_000, 50)])
        );
        expect(totalPerTargetDamage(result, 'attacker')).toBe(0);
    });
});

describe('enemy on-cast self-shield: drives a downstream on-shield-applied reactive', () => {
    it('enemy self-shield active wakes an on-shield-applied reactive buff (buff-applied keyed on the enemy)', () => {
        // Resonating-Fury-style: an on-shield-applied reactive buff owned by the enemy. The enemy's
        // own on-cast shield emits shield-applied → the team-agnostic listener enqueues the buff →
        // buff-applied fires keyed on the enemy. (Buff target 'self' to keep recipient routing trivial.)
        const resonatingFury: Ability = {
            id: 'enemy-resonating-fury',
            type: 'buff',
            target: 'self',
            trigger: 'on-shield-applied',
            conditions: [],
            config: {
                type: 'buff',
                buffName: 'Crit Power Up',
                stacks: 3,
                duration: 1,
                parsedEffects: {},
            },
        } as unknown as Ability;
        const bus = createEventBus();
        const buffEvents: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
        bus.on('buff-applied', (e) => {
            if (e.type === 'buff-applied') buffEvents.push(e);
        });
        runCombat(
            playerAttacksEnemy(
                [
                    enemyAt(
                        'foe',
                        'M4',
                        selfShieldActiveSkills(50, resonatingFury),
                        1_000,
                        40_000,
                        50
                    ),
                ],
                { bus }
            )
        );
        // buff-applied carries the carrier id on `actorId` (events.ts ~line 61) — NOT `targetId`.
        // Mirrors the sibling harness (enemySideAttacked.integration.test.ts ~472: e.actorId === 'foe').
        expect(buffEvents.some((e) => e.actorId === 'foe' && e.buffName === 'Crit Power Up')).toBe(
            true
        );
    });
});
