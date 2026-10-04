/**
 * A damage bonus that counts something on the enemy reads EACH struck enemy's own count (owner
 * ruling 3, 2026-10-03), as it stood before the cast: Ravager's charged ("an additional 25% damage
 * for each debuff on the enemy") on a cone striking A (3 debuffs), B (none) and C (1) deals 265%
 * to A, 190% to B and 215% to C. Same for a named gate (Wrecker's "if the target is affected by
 * Inferno, deals an additional 50% damage") and for a count of units next to the enemy (Panguan's
 * "increasing by 30% for each Unit adjacent to the enemy").
 *
 * Real parsed kits; the caster's pattern is Pattern-Cone-Range-1 anchored on M4 (covers M4, M3,
 * T3, B3). Debuffs are DoT entries seeded on the actors before round 1 (each entry is one debuff
 * on its holder). Crit 0, defence 0, huge HP.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { simulateDPS } from '../../calculators/dpsSimulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import { neighbors } from '../../targeting/board';
import type { ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';
import type { ActiveDoTStack, CombatActor } from '../state';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];
type Slot = 'active' | 'charged';

const ATTACK = 1000;

const realKit = (ship: string, slot: Slot): ShipSkills => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const found = buildShipAbilities(built).slots.find((s) => s.slot === slot);
    if (!found) throw new Error(`${ship} has no ${slot} slot`);
    return { slots: [{ slot, abilities: found.abilities }] };
};

const cone = () => parsePattern('Pattern-Cone-Range-1');

const enemy = (id: string, position: Position): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 150, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
});

const ally = (id: string, position: Position): TeamActor => ({
    id,
    speed: 150,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
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

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: ATTACK,
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
    pattern: cone(),
    speed: 100,
    ...over,
});

const entries = (n: number): ActiveDoTStack[] =>
    Array.from({ length: n }, () => ({ stacks: 1, tier: 1, remainingRounds: 9, sourceId: 'seed' }));

type Seed = Record<string, { corrosion?: number; inferno?: number }>;

/** `casterId`'s round-1 direct damage per struck victim, as a % of `ATTACK`, a covered cell's
 *  half-damage hit doubled back (`roleScaleFor` in positionalApply.ts). */
const percentByVictim = (
    input: CombatEngineInput,
    casterId: string,
    seed: Seed = {}
): Record<string, number> => {
    const bus = createEventBus();
    const out: Record<string, number> = {};
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.attackerId !== casterId || e.round !== 1 || e.damage === undefined) return;
        out[e.targetId] = (out[e.targetId] ?? 0) + (e.isPrimaryTarget ? e.damage : 2 * e.damage);
    });
    runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            for (const a of all) {
                const s = seed[a.id];
                if (s?.corrosion) a.corrosionEntries.push(...entries(s.corrosion));
                if (s?.inferno) a.infernoEntries.push(...entries(s.inferno));
            }
        },
    });
    for (const k of Object.keys(out)) out[k] = Math.round((100 * out[k]) / ATTACK);
    return out;
};

const board = (): EnemyAttacker[] => [
    enemy('enemy-a', 'M4'),
    enemy('enemy-b', 'M3'),
    enemy('enemy-c', 'T3'),
];

beforeEach(() => {
    setupKeyedRng(13);
});

describe('a per-debuff damage bonus counts each struck enemy', () => {
    it('Ravager charged: A 3 debuffs, B none, C 1 → 265 / 190 / 215', () => {
        expect(
            percentByVictim(
                base({ shipSkills: realKit('Ravager', 'charged'), enemyAttackers: board() }),
                'attacker',
                { 'enemy-a': { corrosion: 3 }, 'enemy-c': { corrosion: 1 } }
            )
        ).toEqual({ 'enemy-a': 265, 'enemy-b': 190, 'enemy-c': 215 });
    });

    it('Ravager charged: A none, B 2 → 190 / 240 / 190', () => {
        expect(
            percentByVictim(
                base({ shipSkills: realKit('Ravager', 'charged'), enemyAttackers: board() }),
                'attacker',
                { 'enemy-b': { corrosion: 2 } }
            )
        ).toEqual({ 'enemy-a': 190, 'enemy-b': 240, 'enemy-c': 190 });
    });

    it('Wrecker charged: only C is affected by Inferno → 155 / 155 / 205', () => {
        expect(
            percentByVictim(
                base({ shipSkills: realKit('Wrecker', 'charged'), enemyAttackers: board() }),
                'attacker',
                { 'enemy-c': { inferno: 1 } }
            )
        ).toEqual({ 'enemy-a': 155, 'enemy-b': 155, 'enemy-c': 205 });
    });

    it('enemy Ravager: focus 1 debuff, B 3, C none → 215 / 265 / 190', () => {
        expect(
            percentByVictim(
                base({
                    attack: 0,
                    chargeCount: 0,
                    hasChargedSkill: false,
                    startCharged: false,
                    speed: 150,
                    teamActors: [ally('ally-b', 'M3'), ally('ally-c', 'T3')],
                    enemyAttackers: [
                        {
                            id: 'enemy-ravager',
                            stats: {
                                attack: ATTACK,
                                crit: 0,
                                critDamage: 0,
                                defence: 0,
                                hp: 1e9,
                                speed: 10,
                                security: 0,
                            },
                            chargeCount: 1,
                            startCharged: true,
                            position: 'M4',
                            target: parseTarget('front'),
                            pattern: cone(),
                            shipSkills: realKit('Ravager', 'charged'),
                        },
                    ],
                }),
                'enemy-ravager',
                { attacker: { corrosion: 1 }, 'ally-b': { corrosion: 3 } }
            )
        ).toEqual({ attacker: 215, 'ally-b': 265, 'ally-c': 190 });
    });
});

describe('a per-adjacent-unit damage bonus counts each struck enemy', () => {
    it("Panguan active on a cone: each victim's own board neighbours set its bonus", () => {
        const positions: Record<string, Position> = {
            'enemy-a': 'M4',
            'enemy-b': 'M3',
            'enemy-c': 'T3',
            'enemy-b2': 'B2',
            'enemy-m2': 'M2',
        };
        const occupied = new Set(Object.values(positions));
        const expected = (id: string): number =>
            145 + 30 * neighbors(positions[id]).filter((p) => occupied.has(p)).length;
        const got = percentByVictim(
            base({
                chargeCount: 0,
                hasChargedSkill: false,
                startCharged: false,
                shipSkills: realKit('Panguan', 'active'),
                enemyAttackers: Object.entries(positions).map(([id, p]) => enemy(id, p)),
            }),
            'attacker'
        );
        // The board makes the three counts differ, so one shared reading cannot pass.
        expect(new Set(['enemy-a', 'enemy-b', 'enemy-c'].map(expected)).size).toBeGreaterThan(1);
        for (const id of ['enemy-a', 'enemy-b', 'enemy-c']) expect(got[id]).toBe(expected(id));
    });
});

describe('DPS calculator: one enemy, its configured debuffs decide', () => {
    it('Ravager charged with no enemy debuffs → 1900', () => {
        const result = simulateDPS({
            attack: ATTACK,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 1,
            startCharged: true,
            enemyDefense: 0,
            enemyHp: 1e9,
            rounds: 1,
            selfBuffs: [],
            enemyDebuffs: [],
            hacking: 0,
            enemySecurity: 0,
            shipSkills: realKit('Ravager', 'charged'),
        });
        expect(result.rounds[0].directDamage).toBe(1900);
    });
});
