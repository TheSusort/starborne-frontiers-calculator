/**
 * The Stasis an enemy is left with after a cast that hits it and also inflicts Stasis on it
 * (owner ruling 2026-10-03): the hit shortens the Stasis the enemy already held by one turn, and
 * the cast's own Stasis then contests that shortened one on duration —
 *
 *     standing Stasis = max(held − 1, new)
 *
 * A Stasis the cast lands on an enemy holding none (or a shorter one) is never shortened by that
 * cast's own hit. The rule is the same on the aimed enemy and on every covered one, and for a
 * Stasis clause written before or after the damage. Example: B holds Stasis 4, Defiant hits B
 * (damage, then Stasis 1) → B ends with 3.
 *
 * Reader: each enemy's Stasis turns after round 1. A fast teammate lands Stasis(held) on A (M4),
 * B (M3) and C (T4) first; the caster fires Pattern-Circle-Range-1 anchored on M4; the enemies act
 * last, skip their turn while stasised and lose one turn to their own Post-Turn decrement. So a
 * held 4 nobody hits reads 3, and a held 4 that is hit reads 2.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { parsePattern, parseTarget } from '../../targetingParser';
import { isStasis } from '../stasisBuffs';
import type { Ability, AbilityTarget, ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';
import type { StatusEngine } from '../statusEngine';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

let idc = 0;
const stasis = (target: AbilityTarget, duration: number): Ability => ({
    id: `sd-${++idc}`,
    type: 'debuff',
    target,
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Stasis',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration,
        application: 'apply',
    },
});
const damage = (): Ability => ({
    id: `sd-${++idc}`,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 1 },
});
const NO_SKILLS: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };
const active = (abilities: Ability[]): ShipSkills => ({ slots: [{ slot: 'active', abilities }] });

/** The caster's kits. */
const KITS = {
    noCast: (): ShipSkills => NO_SKILLS,
    hitOnly: (): ShipSkills => active([damage()]),
    damageThenStasis: (n: number): ShipSkills => active([damage(), stasis('enemy', n)]),
    stasisThenDamage: (n: number): ShipSkills => active([stasis('enemy', n), damage()]),
};

/** A charged-slot Stasis(n) on every enemy, fired once on round 1 ahead of the caster. */
const heldStasisKit = (n: number): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        { slot: 'charged', abilities: [stasis('all-enemies', n)] },
    ],
});

const enemyAt = (
    id: string,
    position: Position,
    skills: ShipSkills = NO_SKILLS
): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 1, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: skills,
});

const playerShip = (
    id: string,
    position: Position,
    skills: ShipSkills = NO_SKILLS,
    over: Partial<TeamActor> = {}
): TeamActor => ({
    id,
    speed: 1,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    walk: {
        shipSkills: skills,
        stats: {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 1e4,
            defence: 0,
            hp: 1e9,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: skills.slots.some((s) => s.slot === 'charged'),
    },
    ...over,
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: NO_SKILLS,
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
    hp: 1e9,
    hacking: 1e4,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Circle-Range-1'),
    speed: 100,
    ...over,
});

/** Each id's Stasis turns after the run (0 = none). */
const stasisTurns = (input: CombatEngineInput, ids: string[]): Record<string, number | string> => {
    let engine: StatusEngine | undefined;
    runCombat({
        ...input,
        __testTapStatusEngine: (e) => {
            engine = e;
        },
    });
    return Object.fromEntries(
        ids.map((id) => [
            id,
            engine!
                .timedAbilityStatuses('enemy', undefined, id)
                .find((s) => isStasis(s.active.buffName))?.active.turnsRemaining ?? 0,
        ])
    );
};
const all = (ids: string[], n: number) => Object.fromEntries(ids.map((id) => [id, n]));

beforeEach(() => {
    idc = 0;
    setupKeyedRng(5);
});

describe('player caster on Circle: standing Stasis = max(held − 1, new) on every struck enemy', () => {
    const ENEMIES = ['enemy-a', 'enemy-b', 'enemy-c'];
    /** `held` (0 = none) lands first via a fast teammate; then the caster fires `kit`. */
    const run = (held: number, kit: ShipSkills): Record<string, number | string> =>
        stasisTurns(
            base({
                shipSkills: kit,
                teamActors:
                    held > 0
                        ? [
                              playerShip('mate', 'M3', heldStasisKit(held), {
                                  speed: 300,
                                  chargeCount: 99,
                                  startCharged: true,
                                  pattern: parsePattern('Pattern-Circle-Range-1'),
                              }),
                          ]
                        : [],
                enemyAttackers: [
                    enemyAt('enemy-a', 'M4'),
                    enemyAt('enemy-b', 'M3'),
                    enemyAt('enemy-c', 'T4'),
                ],
            }),
            ENEMIES
        );

    it('control — held 4, no cast → 3 each (the decrement alone)', () => {
        expect(run(4, KITS.noCast())).toEqual(all(ENEMIES, 3));
    });

    it('control — held 4, a hit with no Stasis clause → 2 each', () => {
        expect(run(4, KITS.hitOnly())).toEqual(all(ENEMIES, 2));
    });

    it('held 4, damage then Stasis 2 → the hit leaves 3, the 2 loses → 2 each, the aimed A included', () => {
        expect(run(4, KITS.damageThenStasis(2))).toEqual(all(ENEMIES, 2));
    });

    it('held 4, Stasis 2 then damage → the 2 loses to the 4, the hit leaves 3 → 2 each', () => {
        expect(run(4, KITS.stasisThenDamage(2))).toEqual(all(ENEMIES, 2));
    });

    it('held 2, damage then Stasis 4 → the longer new Stasis stands → 3 each', () => {
        expect(run(2, KITS.damageThenStasis(4))).toEqual(all(ENEMIES, 3));
    });

    it('held 2, Stasis 4 then damage → the longer new Stasis stands, unshortened → 3 each', () => {
        expect(run(2, KITS.stasisThenDamage(4))).toEqual(all(ENEMIES, 3));
    });

    it('none held, Stasis 2 then damage → the fresh Stasis is not shortened → 1 each', () => {
        expect(run(0, KITS.stasisThenDamage(2))).toEqual(all(ENEMIES, 1));
    });

    it('none held, damage then Stasis 2 → 1 each', () => {
        expect(run(0, KITS.damageThenStasis(2))).toEqual(all(ENEMIES, 1));
    });
});

describe('enemy caster on Circle: the same rule on the player ships it strikes', () => {
    const PLAYERS = ['attacker', 'ally-b', 'ally-c'];
    const enemyShip = (
        id: string,
        skills: ShipSkills,
        over: Partial<EnemyAttacker> = {}
    ): EnemyAttacker => ({
        ...enemyAt(id, 'M4', skills),
        stats: {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1e9,
            speed: 100,
            security: 0,
            hacking: 1e4,
        },
        pattern: parsePattern('Pattern-Circle-Range-1'),
        ...over,
    });
    const run = (held: number, kit: ShipSkills): Record<string, number | string> =>
        stasisTurns(
            base({
                attack: 0,
                hacking: 0,
                speed: 1,
                pattern: parsePattern('Pattern-Base'),
                teamActors: [playerShip('ally-b', 'M3'), playerShip('ally-c', 'T4')],
                enemyAttackers: [
                    enemyShip('enemy-caster', kit),
                    ...(held > 0
                        ? [
                              enemyShip('enemy-mate', heldStasisKit(held), {
                                  position: 'M3',
                                  chargeCount: 99,
                                  startCharged: true,
                                  stats: {
                                      attack: 0,
                                      crit: 0,
                                      critDamage: 0,
                                      defence: 0,
                                      hp: 1e9,
                                      speed: 300,
                                      security: 0,
                                      hacking: 1e4,
                                  },
                              }),
                          ]
                        : []),
                ],
            }),
            PLAYERS
        );

    it('held 4, damage then Stasis 2 → 2 each, the aimed ship included', () => {
        expect(run(4, KITS.damageThenStasis(2))).toEqual(all(PLAYERS, 2));
    });

    it('held 4, Stasis 2 then damage → 2 each', () => {
        expect(run(4, KITS.stasisThenDamage(2))).toEqual(all(PLAYERS, 2));
    });

    it('held 2, damage then Stasis 4 → 3 each', () => {
        expect(run(2, KITS.damageThenStasis(4))).toEqual(all(PLAYERS, 3));
    });

    it('none held, Stasis 2 then damage → 1 each (not shortened)', () => {
        expect(run(0, KITS.stasisThenDamage(2))).toEqual(all(PLAYERS, 1));
    });
});

describe('a walked TEAM actor follows the same reach and rule', () => {
    const ENEMIES = ['enemy-a', 'enemy-b', 'enemy-c'];
    /** The focus casts nothing; a team actor at M3 fires `kit` on Circle anchored on M4. */
    const run = (kit: ShipSkills): Record<string, number | string> =>
        stasisTurns(
            base({
                attack: 0,
                speed: 1,
                pattern: parsePattern('Pattern-Base'),
                teamActors: [
                    playerShip('caster-mate', 'M3', kit, {
                        speed: 100,
                        pattern: parsePattern('Pattern-Circle-Range-1'),
                    }),
                ],
                enemyAttackers: [
                    enemyAt('enemy-a', 'M4'),
                    enemyAt('enemy-b', 'M3'),
                    enemyAt('enemy-c', 'T4'),
                ],
            }),
            ENEMIES
        );

    it('Stasis 2 then damage → reaches A, B and C and is not shortened by its own hit → 1 each', () => {
        expect(run(KITS.stasisThenDamage(2))).toEqual(all(ENEMIES, 1));
    });
});
