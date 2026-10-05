/**
 * Pallas's passive is a reaction: "This Unit gains Attack Up II and Leech II for 1 turn after an
 * ally is critically repaired." The passive voice names no repairer, so any repair counts, and "an
 * ally" includes Pallas herself (ally-includes-self ruling). A critting repair on any ship of her
 * side, cast by anyone on it, grants both; a non-crit repair grants nothing, and nothing is granted
 * at combat start. An opposing healer critting its own side wakes nothing.
 *
 * Real parsed Pallas passive (buildTraceShip, refit 4) behind a plain 100% active, beside a
 * hand-built healer ally that acts first. Attack Up II is +30% attack, so Pallas's hit reads 1300
 * with it and 1000 without.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const pallasPassive = (): Ability[] => {
    const built = buildTraceShip('Pallas');
    if (!built) throw new Error('Pallas missing from reference data');
    const found = buildShipAbilities(built).slots.find((s) => s.slot === 'passive');
    if (!found) throw new Error('Pallas has no passive slot');
    return found.abilities;
};

let idc = 0;
const hit = (): Ability => ({
    id: `pa-${++idc}`,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});
const pallas = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [hit()] },
        { slot: 'passive', abilities: pallasPassive() },
    ],
});
/** A healer whose only cast is a 10%-of-max-HP repair on `target`. */
const healer = (target: Ability['target']): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: `pa-${++idc}`,
                    type: 'heal',
                    target,
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'heal', pct: 10, basis: 'hp' },
                },
            ],
        },
    ],
});
const NONE: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };

const ROUNDS = 3;
const HP = 1e9;

const enemyAt = (
    id: string,
    position: Position,
    over: Partial<EnemyAttacker> = {}
): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 50, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: NONE,
    ...over,
});
const playerShip = (
    id: string,
    position: Position,
    skills: ShipSkills,
    stats: { attack: number; crit: number; speed: number }
): TeamActor => ({
    id,
    speed: stats.speed,
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
            attack: stats.attack,
            crit: stats.crit,
            critDamage: 50,
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

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: NONE,
    numRounds: ROUNDS,
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
    hacking: 0,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    speed: 100,
    ...over,
});

/** Pallas's hit per round, and the rounds she gained each buff in. */
const measure = (input: CombatEngineInput, pallasId: string) => {
    const bus = createEventBus();
    const hits: number[] = [];
    const attackUp: number[] = [];
    const leech: number[] = [];
    bus.on('attacked', (e) => {
        if (e.attackerId === pallasId) hits.push(Math.round(e.damage ?? NaN));
    });
    bus.on('buff-applied', (e) => {
        if (e.actorId !== pallasId) return;
        if (e.buffName === 'Attack Up II') attackUp.push(e.round);
        if (e.buffName === 'Leech II') leech.push(e.round);
    });
    runCombat({ ...input, bus });
    return { hits, attackUp, leech };
};

/** Player side: the focus is Pallas (M4); `mate` is a faster ally healer at M3. */
const playerBoard = (mate?: TeamActor, enemies: EnemyAttacker[] = []): CombatEngineInput =>
    base({
        shipSkills: pallas(),
        teamActors: mate ? [mate] : [],
        enemyAttackers: [enemyAt('e-dummy', 'M4'), ...enemies],
    });

/** Enemy side: an enemy Pallas (M4) beside a faster enemy healer (M3); the player focus is a
 *  passive dummy. */
const enemyBoard = (healerSkills?: ShipSkills, healerCrit = 100): CombatEngineInput =>
    base({
        attack: 0,
        enemyAttackers: [
            enemyAt('e-pallas', 'M4', {
                stats: {
                    attack: 1000,
                    crit: 0,
                    critDamage: 0,
                    defence: 0,
                    hp: HP,
                    speed: 100,
                    security: 0,
                },
                shipSkills: pallas(),
            }),
            ...(healerSkills
                ? [
                      enemyAt('e-healer', 'M3', {
                          stats: {
                              attack: 1000,
                              crit: healerCrit,
                              critDamage: 50,
                              defence: 0,
                              hp: HP,
                              speed: 200,
                              security: 0,
                          },
                          shipSkills: healerSkills,
                      }),
                  ]
                : []),
        ],
    });

const critHealer = (target: Ability['target'] = 'all-allies') =>
    playerShip('mender', 'M3', healer(target), { attack: 1000, crit: 100, speed: 200 });
const plainHealer = () =>
    playerShip('mender', 'M3', healer('all-allies'), { attack: 1000, crit: 0, speed: 200 });

beforeEach(() => {
    idc = 0;
    setupKeyedRng(11);
});

describe('parse: the passive rides a live crit-repair trigger', () => {
    it('both grants react to an ally being critically repaired, ungated', () => {
        for (const a of pallasPassive()) {
            expect(a.trigger).toBe('on-any-ally-critically-repaired');
            expect(a.conditions).toEqual([]);
        }
    });
});

describe('player Pallas', () => {
    it('no healer: no grant at combat start, every hit is plain', () => {
        expect(measure(playerBoard(), 'attacker')).toEqual({
            hits: [1000, 1000, 1000],
            attackUp: [],
            leech: [],
        });
    });

    it('an ally crit-repairs the team every round: both buffs every round, every hit boosted', () => {
        expect(measure(playerBoard(critHealer()), 'attacker')).toEqual({
            hits: [1300, 1300, 1300],
            attackUp: [1, 2, 3],
            leech: [1, 2, 3],
        });
    });

    it('the ally crit-repairs only itself: still "an ally critically repaired"', () => {
        expect(measure(playerBoard(critHealer('self')), 'attacker').attackUp).toEqual([1, 2, 3]);
    });

    it('a non-crit repair grants nothing', () => {
        expect(measure(playerBoard(plainHealer()), 'attacker')).toEqual({
            hits: [1000, 1000, 1000],
            attackUp: [],
            leech: [],
        });
    });

    it('an enemy healer critting its own side wakes nothing', () => {
        const enemyHealer = enemyAt('e-healer', 'M3', {
            stats: {
                attack: 1000,
                crit: 100,
                critDamage: 50,
                defence: 0,
                hp: HP,
                speed: 200,
                security: 0,
            },
            shipSkills: healer('all-allies'),
        });
        expect(measure(playerBoard(undefined, [enemyHealer]), 'attacker').attackUp).toEqual([]);
    });
});

describe('enemy Pallas', () => {
    it('no healer: no grant at combat start', () => {
        expect(measure(enemyBoard(), 'e-pallas')).toEqual({
            hits: [1000, 1000, 1000],
            attackUp: [],
            leech: [],
        });
    });

    it('an enemy ally crit-repairs its team every round: both buffs every round', () => {
        expect(measure(enemyBoard(healer('all-allies')), 'e-pallas')).toEqual({
            hits: [1300, 1300, 1300],
            attackUp: [1, 2, 3],
            leech: [1, 2, 3],
        });
    });

    it('a non-crit repair grants nothing', () => {
        expect(measure(enemyBoard(healer('all-allies'), 0), 'e-pallas').attackUp).toEqual([]);
    });

    it('a player healer critting the player side wakes nothing', () => {
        const input = enemyBoard();
        input.teamActors = [critHealer()];
        expect(measure(input, 'e-pallas').attackUp).toEqual([]);
    });
});
