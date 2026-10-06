/**
 * APEX's passive reacts to ANY debuff landing on one of her enemies, whoever inflicted it (owner
 * ruling R16, 2026-10-04): "This Unit gains a shield equal to 3% of their max HP when an enemy gets
 * inflicted with a debuff. If that enemy has 3 or more debuffs on a debuff infliction, this Unit
 * inflicts Block Shield for 1 turn." The text is passive voice with no "this Unit", so an ally's
 * infliction counts as much as her own. Ally Hemlock's Corrosion on B → APEX gains 3%, and (B at
 * 3+, the triggering debuff counted) APEX inflicts Block Shield on B. Both are capped per skill
 * cast that set the landings off (`Ability.oncePerRootCast`): the shield once per cast (owner
 * ruling 2026-10-05) — her 2-debuff AoE over 3 enemies gives ONE — and Block Shield once per
 * enemy per cast (owner ruling 2026-10-06). Block Shield, itself a debuff landing of the same
 * cast, earns no further shield and never re-triggers itself.
 *
 * Real parsed APEX passive (buildTraceShip, refit 4). Hand-built inflictors. Every landing roll
 * lands (hacking dwarfs every security); debuffs are seeded as Corrosion entries.
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
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';
import type { ActiveDoTStack } from '../state';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const realSlot = (ship: string, slot: 'active' | 'passive'): Ability[] => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const found = buildShipAbilities(built).slots.find((s) => s.slot === slot);
    if (!found) throw new Error(`${ship} has no ${slot} slot`);
    return found.abilities;
};
const NO_SKILLS: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };
/** APEX's passive alone: she never casts anything of her own. */
const apexPassiveOnly = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        { slot: 'passive', abilities: realSlot('APEX', 'passive') },
    ],
});

let idc = 0;
const hit = (): Ability => ({
    id: `ax-${++idc}`,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});
/** A single-target inflictor: one hit, then Attack Down II. */
const debuffInflictor = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                hit(),
                {
                    id: `ax-${++idc}`,
                    type: 'debuff',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'debuff',
                        buffName: 'Attack Down II',
                        parsedEffects: { attack: -30 },
                        stacks: 1,
                        isStackable: false,
                        duration: 2,
                        application: 'inflict',
                    },
                },
            ],
        },
    ],
});
/** A single-target DoT inflictor (Hemlock-shaped): one hit, then Corrosion. */
const corrosionInflictor = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                hit(),
                {
                    id: `ax-${++idc}`,
                    type: 'dot',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'dot', dotType: 'corrosion', tier: 3, stacks: 1, duration: 2 },
                },
            ],
        },
    ],
});

const corrosion = (n: number): ActiveDoTStack[] =>
    Array.from({ length: n }, () => ({ stacks: 1, tier: 1, remainingRounds: 9, sourceId: 'seed' }));

const APEX_HP = 100_000;
const SHIELD = 0.03 * APEX_HP;

const enemyAt = (
    id: string,
    position: Position,
    over: Partial<EnemyAttacker> = {}
): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 100, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: NO_SKILLS,
    ...over,
});
const playerShip = (
    id: string,
    position: Position,
    skills: ShipSkills,
    speed: number,
    hp: number
): TeamActor => ({
    id,
    speed,
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
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 1e6,
            defence: 0,
            hp,
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
    hacking: 1e6,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    speed: 200,
    ...over,
});

interface Measured {
    /** APEX's shield grants, in units of 3% of her max HP. */
    shields: number;
    /** Sorted target ids of APEX's Block Shield landings. */
    blockShield: string[];
}

const measure = (input: CombatEngineInput, apexId: string, seeds: Record<string, number>) => {
    const bus = createEventBus();
    const out: Measured = { shields: 0, blockShield: [] };
    bus.on('shield-applied', (e: Extract<CombatEvent, { type: 'shield-applied' }>) => {
        if (e.granterId !== apexId || e.round !== 1) return;
        const gross = e.amount + (e.overshield ?? 0);
        out.shields += gross / SHIELD;
    });
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.sourceId === apexId && e.buffName === 'Block Shield' && e.round === 1)
            out.blockShield.push(e.targetId);
    });
    runCombat({
        ...input,
        bus,
        __testTapActors: (all) => {
            for (const a of all) {
                const n = seeds[a.id];
                if (n) a.corrosionEntries.push(...corrosion(n));
            }
        },
    });
    out.shields = Math.round(out.shields * 1000) / 1000;
    out.blockShield.sort();
    return out;
};

/** Player side: the fast focus inflicts on enemy X (M4); APEX is a slow team ship at M3 that
 *  never casts. */
const playerAllyBoard = (inflictor: ShipSkills): CombatEngineInput =>
    base({
        shipSkills: inflictor,
        teamActors: [playerShip('apex', 'M3', apexPassiveOnly(), 50, APEX_HP)],
        enemyAttackers: [enemyAt('enemy-x', 'M4')],
    });

/** Enemy side: a fast enemy inflictor and a slow enemy APEX; the player focus is X (M4). */
const enemyAllyBoard = (inflictor: ShipSkills): CombatEngineInput =>
    base({
        attack: 0,
        hacking: 0,
        speed: 100,
        enemyAttackers: [
            enemyAt('e-inflictor', 'M4', {
                stats: {
                    attack: 1000,
                    crit: 0,
                    critDamage: 0,
                    defence: 0,
                    hp: 1e9,
                    speed: 200,
                    security: 0,
                    hacking: 1e6,
                },
                shipSkills: inflictor,
            }),
            enemyAt('e-apex', 'M3', {
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    defence: 0,
                    hp: APEX_HP,
                    speed: 50,
                    security: 0,
                    hacking: 1e6,
                },
                shipSkills: apexPassiveOnly(),
            }),
        ],
    });

beforeEach(() => {
    idc = 0;
    setupKeyedRng(5);
});

describe('parse: both passive clauses ride the any-source enemy-debuffed trigger', () => {
    it('the 3% shield and Block Shield react to a debuff landing on an enemy', () => {
        const passive = realSlot('APEX', 'passive');
        const shield = passive.find((a) => a.type === 'shield');
        const block = passive.find(
            (a) => a.config.type === 'debuff' && a.config.buffName === 'Block Shield'
        );
        expect(shield?.trigger).toBe('on-enemy-debuff-inflicted');
        expect(block?.trigger).toBe('on-enemy-debuff-inflicted');
        expect(block?.target).toBe('enemy');
        expect(block?.conditions).toEqual([
            { subject: 'enemy-debuff', derivable: true, countComparator: 'gte', countThreshold: 3 },
        ]);
    });
});

describe("an ALLY's infliction wakes APEX's passive", () => {
    it('player: X at 0, ally lands Attack Down II → one shield, no Block Shield', () => {
        expect(measure(playerAllyBoard(debuffInflictor()), 'apex', {})).toEqual({
            shields: 1,
            blockShield: [],
        });
    });

    it('player: X at 2, ally lands its 3rd debuff → Block Shield on X, no 2nd shield for the same cast', () => {
        expect(measure(playerAllyBoard(debuffInflictor()), 'apex', { 'enemy-x': 2 })).toEqual({
            shields: 1,
            blockShield: ['enemy-x'],
        });
    });

    it('player: X at 1, ally lands its 2nd debuff → one shield, no Block Shield', () => {
        expect(measure(playerAllyBoard(debuffInflictor()), 'apex', { 'enemy-x': 1 })).toEqual({
            shields: 1,
            blockShield: [],
        });
    });

    it("player: an ally's Corrosion counts as a debuff infliction — X at 2 → Block Shield", () => {
        expect(measure(playerAllyBoard(corrosionInflictor()), 'apex', { 'enemy-x': 2 })).toEqual({
            shields: 1,
            blockShield: ['enemy-x'],
        });
    });

    it('enemy-side: the player focus at 2, enemy ally lands its 3rd debuff → Block Shield on it', () => {
        expect(measure(enemyAllyBoard(debuffInflictor()), 'e-apex', { attacker: 2 })).toEqual({
            shields: 1,
            blockShield: ['attacker'],
        });
    });

    it('enemy-side: focus at 0 → one shield, no Block Shield', () => {
        expect(measure(enemyAllyBoard(debuffInflictor()), 'e-apex', {})).toEqual({
            shields: 1,
            blockShield: [],
        });
    });
});

describe("APEX's own AoE: one shield, and at most one Block Shield per enemy, for the cast", () => {
    /** Player APEX (real active + passive) on Circle from M4: strikes M4 (A), M3 (B), T4 (C). */
    const board = (): CombatEngineInput =>
        base({
            hp: APEX_HP,
            pattern: parsePattern('Pattern-Circle-Range-1'),
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: realSlot('APEX', 'active') },
                    { slot: 'passive', abilities: realSlot('APEX', 'passive') },
                ],
            },
            enemyAttackers: [
                enemyAt('enemy-a', 'M4', { stats: { ...enemyAt('x', 'M4').stats, speed: 10 } }),
                enemyAt('enemy-b', 'M3', { stats: { ...enemyAt('x', 'M4').stats, speed: 10 } }),
                enemyAt('enemy-c', 'T4', { stats: { ...enemyAt('x', 'M4').stats, speed: 10 } }),
            ],
        });

    it('2 debuffs on each of 3 clean enemies → one shield, no Block Shield', () => {
        expect(measure(board(), 'attacker', {})).toEqual({ shields: 1, blockShield: [] });
    });

    it('B at 1: its 2nd new debuff takes it to 3 → one Block Shield on B, one shield', () => {
        expect(measure(board(), 'attacker', { 'enemy-b': 1 })).toEqual({
            shields: 1,
            blockShield: ['enemy-b'],
        });
    });

    it('all three at 2: both new debuffs qualify on each — one Block Shield on each enemy', () => {
        const m = measure(board(), 'attacker', { 'enemy-a': 2, 'enemy-b': 2, 'enemy-c': 2 });
        expect(m.blockShield).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        expect(m.shields).toBe(1);
    });
});

describe('DPS calculator: one shield per cast that lands a debuff on the one enemy', () => {
    it("APEX's shields equal her casts that land a debuff", () => {
        const built = buildTraceShip('APEX');
        if (!built) throw new Error('APEX missing');
        const bus = createEventBus();
        let shields = 0;
        let landed = 0;
        // APEX is the only caster and casts once per round, so a round is one cast.
        const roundsWithALanding = new Set<number>();
        bus.on('shield-applied', (e: Extract<CombatEvent, { type: 'shield-applied' }>) => {
            if (e.granterId === 'attacker' && !e.uncast) shields++;
        });
        bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
            if (e.targetId === 'attacker') return;
            landed++;
            roundsWithALanding.add(e.round);
        });
        simulateDPS({
            attack: 15000,
            crit: 0,
            critDamage: 150,
            defensePenetration: 0,
            chargeCount: 99,
            enemyDefense: 8000,
            enemyHp: 1e12,
            rounds: 3,
            selfBuffs: [],
            enemyDebuffs: [],
            hacking: 1e6,
            enemySecurity: 0,
            defence: 6000,
            hp: APEX_HP,
            shipSkills: buildShipAbilities(built),
            bus,
        });
        // Instrument: more debuffs landed than casts, so a per-debuff shield would read higher.
        expect(landed).toBeGreaterThan(roundsWithALanding.size);
        expect(roundsWithALanding.size).toBe(3);
        expect(shields).toBe(roundsWithALanding.size);
    });
});
