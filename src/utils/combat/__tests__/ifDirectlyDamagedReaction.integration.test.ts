/**
 * Panon's "If this Unit is directly damaged …" passive — end-to-end, from the verbatim CSV text.
 *
 * The reaction detector (`DR_DIRECT_DAMAGE_RE`, skillTextParser.ts) used to match only the "when"
 * phrasing and deliberately excluded "if" as out of scope. Panon's whole defensive identity is
 * written with "if", so his Barrier grant fell through to the generic `on-cast` default and armed
 * on HIS OWN TURN — every third turn (the Barrier Recharging lockout is what spaces it), whether
 * or not anything had touched him — instead of the instant he is hit.
 *
 * PRE-FIX the first case here fails: an untouched Panon still gains Barrier on his own cast.
 *
 * The lockout itself is NOT what this file tests — `holdsBarrierRecharging` already gates every
 * grant site (playerTurn.ts, triggers.ts, engine.ts) and barrierRechargingLockout.integration.test.ts
 * owns that. What is under test is WHEN the grant is attempted at all.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';
import type { ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// Verbatim docs/ship-skills.csv, Panon second_passive_skill_text (the refit-active row at R4).
const PANON_P2 =
    'If this Unit is directly damaged and does not have <unit-skill>Barrier Recharging</unit-skill>, ' +
    'it gains <unit-skill>Barrier</unit-skill> for 1 turn and applies <unit-skill>Barrier Recharging</unit-skill> ' +
    'to itself for 3 turns.<br /><br />This Unit reduces all incoming damage by 20% when affected by ' +
    '<unit-skill>Barrier Recharging</unit-skill>.';

const panonSkills = (): ShipSkills =>
    buildShipAbilities({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}],
        activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
        firstPassiveSkillText: PANON_P2,
        secondPassiveSkillText: PANON_P2,
    } as Ship);

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

/** An enemy that attacks (attack > 0 + a damage active) or is entirely inert (attack 0, no
 *  abilities). Slower than Panon so his own cast always comes first in the round — which is
 *  precisely what makes the two cases distinguishable: under the old `on-cast` trigger the
 *  Barrier landed on that cast, BEFORE any enemy could have hit him. */
const enemyAt = (id: string, position: Position, attacks: boolean): EnemyAttacker => ({
    id,
    stats: { attack: attacks ? 50_000 : 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 1 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: attacks
                    ? [
                          {
                              id: 'iddr-enemy-hit',
                              type: 'damage',
                              target: 'enemy',
                              trigger: 'on-cast',
                              conditions: [],
                              config: { type: 'damage', multiplier: 100 },
                          },
                      ]
                    : [],
            },
        ],
    },
});

const panonRun = (attacks: boolean): CombatEngineInput => ({
    attack: 1_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: panonSkills(),
    numRounds: 2,
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
    hp: 1_000_000_000, // survives the incoming hits, so round 2 still happens
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    speed: 200, // Panon acts FIRST each round
    enemyAttackers: [enemyAt('foe', 'M4', attacks)],
});

/** Rounds in which Panon was granted Barrier. */
const barrierRounds = (attacks: boolean): number[] => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('buff-applied', (e) => events.push(e as CombatEvent));
    runCombat({ ...panonRun(attacks), bus });
    return events
        .filter(
            (e): e is Extract<CombatEvent, { type: 'buff-applied' }> =>
                e.type === 'buff-applied' && e.actorId === 'attacker' && e.buffName === 'Barrier'
        )
        .map((e) => e.round);
};

describe('Panon R2 — "If … directly damaged" is a reaction, not an own-turn grant', () => {
    it('an untouched Panon never gains Barrier', () => {
        // The enemy is inert, so nothing ever damages Panon. Under the pre-fix `on-cast` trigger
        // his own R1 cast granted Barrier here regardless.
        expect(barrierRounds(false)).toEqual([]);
    });

    it('a Panon that IS directly damaged gains Barrier', () => {
        // Panon casts first (nothing has hit him yet), the enemy strikes, and the reaction fires.
        expect(barrierRounds(true).length).toBeGreaterThan(0);
    });
});
