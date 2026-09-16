/**
 * Bug: when Voron transforms an incoming direct hit into a DoT (no direct damage lands), the
 * engine still emits an `attacked` event carrying the raw pre-transform damage. Downstream
 * "directly damaged" reactions (Cultivator's on-ally-attacked 8% repair) then fire even though
 * NO direct damage occurred. A fully-transformed hit is not a direct hit, so it must emit no
 * `attacked` event.
 *
 * ⚠️ "When Voron is stasised the transform passive doesn't run" IS THE GAME RULE (owner,
 * 2026-09-15: EVERY passive is disabled while its owner is stasised OR disabled, so the hit
 * connects and takes full damage. A standing STATUS is unaffected — Barrier keeps nullifying hits
 * on a stasised ship because it is a buff consumed on hit, not a passive that fires; a passive
 * that GRANTS Barrier would grant nothing.) AND THE ENGINE DOES NOT IMPLEMENT IT. `incomingAbilitiesOf` filters only dead ally-scoped
 * owners, and Voron's transform condition is `always`, so nothing consults the victim's Stasis.
 * MEASURED by the third arm below. The Orel-gate-closed control is a stand-in for the shape, not
 * evidence that Stasis produces it.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const DIRECT_HIT = 5000;
const HP = 10_000_000;

const voronTransform: Ability = {
    id: 'voron-transform',
    type: 'transform-incoming-to-dot',
    target: 'self',
    trigger: 'on-attacked',
    conditions: [],
    config: { type: 'transform-incoming-to-dot', turns: 3, condition: 'always' },
};
const orelTransform: Ability = {
    id: 'orel-transform',
    type: 'transform-incoming-to-dot',
    target: 'self',
    trigger: 'on-attacked',
    conditions: [],
    // Gate CLOSED (attacker holds no Taunt/Provoke) → no transform → the hit lands as direct
    // damage. Stand-in for "Voron stasised/disabled": transform doesn't run, attacked must fire.
    config: {
        type: 'transform-incoming-to-dot',
        turns: 3,
        condition: 'attacker-taunted-or-provoke',
    },
};

let basicCounter = 0;
const basicAttack = (): Ability => ({
    id: `basic-${++basicCounter}`,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});
const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const victimActor = (id: string, position: Position, passive: Ability | undefined): TeamActor => ({
    id,
    speed: 1000,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    walk: {
        shipSkills: {
            slots: passive ? [{ slot: 'passive', abilities: [passive] }] : [],
        },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: HP,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

const offensiveEnemy = (id: string, position: Position): EnemyAttacker => ({
    id,
    stats: { attack: DIRECT_HIT, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 1 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [{ slot: 'active', abilities: [basicAttack()] }] },
});

/** Fast enemy whose cast lands Stasis(4) on the front player actor before the hitter acts. */
const stasiserEnemy = (id: string, position: Position): EnemyAttacker => ({
    id,
    stats: {
        attack: 1,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: HP,
        speed: 900,
        hacking: 500,
        security: 0,
    },
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
                        id: `${id}-dmg`,
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 0 },
                    },
                    {
                        id: `${id}-stasis`,
                        type: 'debuff',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: {
                            type: 'debuff',
                            buffName: 'Stasis',
                            application: 'inflict',
                            duration: 4,
                            stacks: 1,
                            isStackable: false,
                            parsedEffects: {},
                        },
                    },
                ],
            },
        ],
    },
});

const noopActive: ShipSkills['slots'][number] = {
    slot: 'active',
    abilities: [
        {
            id: 'noop-dmg',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 0 },
        },
    ],
};

const BASE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [noopActive] },
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
    hp: HP,
    healTargetId: 'attacker',
    mode: 'healing',
    ...overrides,
});

function attackedFor(input: CombatEngineInput, targetId: string) {
    const bus = createEventBus();
    const attacked: Extract<CombatEvent, { type: 'attacked' }>[] = [];
    bus.on('attacked', (e) => {
        if (e.targetId === targetId) attacked.push(e);
    });
    runCombat({ ...input, bus });
    return attacked;
}

describe('a fully DoT-transformed hit emits no `attacked` event', () => {
    it('Voron (transform active) is hit → NO attacked event fires', () => {
        const attacked = attackedFor(
            BASE({
                numRounds: 1,
                teamActors: [victimActor('voron', 'M4', voronTransform)],
                enemyAttackers: [offensiveEnemy('enemy-1', 'M1')],
            }),
            'voron'
        );
        expect(attacked).toHaveLength(0);
    });

    it('control: transform gate CLOSED (stasis/disabled analogue) → hit lands, attacked FIRES', () => {
        const attacked = attackedFor(
            BASE({
                numRounds: 1,
                teamActors: [victimActor('orel', 'M4', orelTransform)],
                enemyAttackers: [offensiveEnemy('enemy-1', 'M1')],
            }),
            'orel'
        );
        expect(attacked.length).toBeGreaterThan(0);
    });

    it('KNOWN GAP: a STASISED Voron still transforms, so the hit still emits no attacked', () => {
        // The game rule is that a stasised or disabled owner's passives are all inactive — a
        // stasised Voron should take the hit as ordinary direct damage. Nothing in the funnel reads the victim's Stasis for
        // this ability (its condition is `always`), so the transform fires anyway. Pinned as the
        // CURRENT behaviour, not the correct one: when the general rule lands, this arm flips to
        // `toBeGreaterThan(0)` and the header's warning comes out.
        const stasised = attackedFor(
            BASE({
                numRounds: 2,
                teamActors: [victimActor('voron', 'M4', voronTransform)],
                enemyAttackers: [stasiserEnemy('stasiser', 'M2'), offensiveEnemy('enemy-1', 'M1')],
            }),
            'voron'
        );
        expect(stasised).toHaveLength(0);

        // NON-VACUITY: the same board with NO transform passive DOES emit `attacked`, so the zero
        // above is the transform firing and not the hitter missing.
        const noPassive = attackedFor(
            BASE({
                numRounds: 2,
                teamActors: [victimActor('plain', 'M4', undefined)],
                enemyAttackers: [stasiserEnemy('stasiser', 'M2'), offensiveEnemy('enemy-1', 'M1')],
            }),
            'plain'
        );
        expect(noPassive.length).toBeGreaterThan(0);
    });
});
