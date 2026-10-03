/**
 * "Removes N charges from the enemy's charged skill" on a pattern skill drains EVERY enemy the skill
 * strikes and nobody else (owner ruling 2026-10-03): Sefuba's charged skill hitting A, B and C takes
 * two charges from each of the three; an enemy outside the pattern keeps its charges, and a
 * single-target pattern drains the target alone. Both sides.
 *
 * Real parsed kits (buildTraceShip on docs/ship-skills.csv) on Pattern-Circle-Range-1 anchored on
 * M4, which strikes M4, M3 and T4; M2 is outside it. Every victim is slower than the caster and
 * seeded with a full charge pool, so the drain is the first thing that touches it.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (reference data that is not committed) — copy them in before running'
        );
    }
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const circle = (): ParsedPattern => parsePattern('Pattern-Circle-Range-1');
const single = (): ParsedPattern => parsePattern('Pattern-Base');

const realSlot = (ship: string, slot: 'active' | 'charged' | 'passive'): Ability[] => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const found = buildShipAbilities(built).slots.find((s) => s.slot === slot);
    if (!found) throw new Error(`${ship} has no ${slot} slot`);
    return found.abilities;
};

const kitOf = (ship: string): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: realSlot(ship, 'active') },
        { slot: 'charged', abilities: realSlot(ship, 'charged') },
    ],
});

const POOL = 5;
const IN_PATTERN: Position[] = ['M4', 'M3', 'T4'];
const OUTSIDE: Position = 'M2';

const slowEnemy = (id: string, position: Position): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 10, security: 0 },
    chargeCount: POOL,
    startCharged: true,
    position,
    target: parseTarget('front'),
    pattern: single(),
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
});

const enemyRow = (outside: Position = OUTSIDE): EnemyAttacker[] => [
    ...IN_PATTERN.map((p, i) => slowEnemy(`enemy-${'abc'[i]}`, p)),
    slowEnemy('enemy-out', outside),
];

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 10_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 1,
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: true,
    startCharged: true,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1e9,
    hacking: 0,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: circle(),
    chargedPattern: circle(),
    speed: 100,
    ...over,
});

/** `actorId → charges removed` by the round-1 manipulation events (a drain is a `manip` drop). */
const drained = (input: CombatEngineInput): Record<string, number> => {
    const bus = createEventBus();
    const out: Record<string, number> = {};
    bus.on('charge-changed', (e: Extract<CombatEvent, { type: 'charge-changed' }>) => {
        if (e.round !== 1 || e.reason !== 'manip' || e.newCharge >= e.oldCharge) return;
        out[e.actorId] = (out[e.actorId] ?? 0) + (e.oldCharge - e.newCharge);
    });
    runCombat({ ...input, bus });
    return out;
};

beforeEach(() => {
    setupKeyedRng(5);
});

describe("Sefuba's charged skill drains charges from the enemies she strikes", () => {
    const sefuba = (pattern: ParsedPattern): Record<string, number> =>
        drained(
            base({
                shipSkills: kitOf('Sefuba'),
                pattern,
                chargedPattern: pattern,
                enemyAttackers: enemyRow(),
            })
        );

    it('A, B and C lose 2 charges each; the enemy outside the pattern keeps its pool', () => {
        expect(sefuba(circle())).toEqual({ 'enemy-a': 2, 'enemy-b': 2, 'enemy-c': 2 });
    });

    it('a single-target pattern drains the target alone', () => {
        expect(sefuba(single())).toEqual({ 'enemy-a': 2 });
    });
});

describe('enemy-side Sefuba drains only the player ships she strikes', () => {
    const teamActor = (id: string, position: Position): TeamActor => ({
        id,
        speed: 10,
        chargeCount: POOL,
        startCharged: true,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parseTarget('front'),
        pattern: single(),
        walk: {
            shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 1e9,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });
    const enemySefuba = (pattern: ParsedPattern): EnemyAttacker => ({
        id: 'enemy-sefuba',
        stats: {
            attack: 10_000,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1e9,
            speed: 150,
            security: 0,
            hacking: 0,
        },
        chargeCount: 1,
        startCharged: true,
        position: 'M4',
        target: parseTarget('front'),
        pattern,
        chargedPattern: pattern,
        shipSkills: kitOf('Sefuba'),
    });
    const run = (pattern: ParsedPattern): Record<string, number> =>
        drained(
            base({
                attack: 0,
                speed: 10,
                chargeCount: POOL,
                teamActors: [
                    teamActor('ally-b', 'M3'),
                    teamActor('ally-c', 'T4'),
                    teamActor('ally-out', OUTSIDE),
                ],
                enemyAttackers: [enemySefuba(pattern)],
            })
        );

    it('three player ships in her pattern → each loses 2 charges; the ship outside keeps its pool', () => {
        expect(run(circle())).toEqual({ attacker: 2, 'ally-b': 2, 'ally-c': 2 });
    });

    it('a single-target pattern drains the target alone', () => {
        expect(run(single())).toEqual({ attacker: 2 });
    });
});

describe('Opal and Provider follow the same footprint rule', () => {
    it("Opal's charged skill (Line-Range-2) drains the enemies on her line only", () => {
        const pattern = parsePattern('Pattern-Line-Range-2');
        const out = drained(
            base({
                shipSkills: kitOf('Opal'),
                pattern,
                chargedPattern: pattern,
                enemyAttackers: enemyRow('B1'),
            })
        );
        expect(Object.keys(out).length).toBeGreaterThan(0);
        expect(out['enemy-out']).toBeUndefined();
    });

    it("Provider's charged skill (Cone-Range-1) never drains the enemy outside the cone", () => {
        const pattern = parsePattern('Pattern-Cone-Range-1');
        const out = drained(
            base({
                shipSkills: kitOf('Provider'),
                pattern,
                chargedPattern: pattern,
                enemyAttackers: enemyRow('B1'),
            })
        );
        expect(Object.keys(out).length).toBeGreaterThan(0);
        expect(out['enemy-out']).toBeUndefined();
    });
});
