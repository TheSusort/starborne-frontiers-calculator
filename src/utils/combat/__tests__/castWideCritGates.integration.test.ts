/**
 * A cast-wide crit clause fires on a crit against ANY enemy the skill strikes, aimed or covered
 * (owner ruling 11, 2026-10-03): Lev's charged "If a critical hit occurs, all hit enemies have
 * their debuffs extended by 1 turn and all allies are granted Crit Power Up II" — a crit on B
 * alone extends A, B and C and grants the buff. The clause needs a REAL crit, in a battle and in
 * the DPS calculator: a cast on which no enemy is crit grants nothing.
 *
 * Observables, per seeded run of one Lev charged cast on Pattern-Cone-Range-1 (A at the anchor,
 * B and C covered, OUT outside the footprint), crit 50:
 *   - the cast's crit identity: the union of `critVictimIds` over the cast's `ability-performed`;
 *   - the extension: every `extendAllDebuffsDuration` call the status engine receives (spied by
 *     wrapping `createStatusEngine`; Lev is the only extender on the board);
 *   - the grant: `buff-applied` 'Crit Power Up II' with Lev as granter.
 * Each must fire iff some struck enemy was crit, on every seed, for a player and an enemy Lev.
 *
 * Lionheart's "If this critically hits, grants Attack Up … to all adjacent allies" is a reactive
 * on-crit grant fed by the same positional `ability-performed`; its arm pins that it already
 * follows the cast's real crits.
 *
 * Asphodel's passive "adds 1 charge to its charged skill after critically damaging an enemy" is
 * counted per struck enemy instead: her charge gain (`charge-changed` reason 'manip') must equal
 * the number of distinct enemies in the cast's `critVictimIds`.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { simulateDPS } from '../../calculators/dpsSimulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';

const extendCalls: { victimId: string }[] = [];

vi.mock('../statusEngine', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../statusEngine')>();
    return {
        ...actual,
        createStatusEngine: (...args: Parameters<typeof actual.createStatusEngine>) => {
            const engine = actual.createStatusEngine(...args);
            const extend = engine.extendAllDebuffsDuration;
            engine.extendAllDebuffsDuration = (victimId, ...rest) => {
                extendCalls.push({ victimId: victimId ?? '' });
                return extend(victimId, ...rest);
            };
            return engine;
        },
    };
});

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const realKit = (ship: string, slot: 'active' | 'charged'): ShipSkills => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const found = buildShipAbilities(built).slots.find((s) => s.slot === slot);
    if (!found) throw new Error(`${ship} has no ${slot} slot`);
    return { slots: [{ slot, abilities: found.abilities }] };
};

/** Every slot of the ship's kit (active, charged, passive), at refit 4 unless named. */
const fullKit = (ship: string, refitLevel: 0 | 2 | 4 = 4): ShipSkills => {
    const built = buildTraceShip(ship, { refitLevel });
    if (!built) throw new Error(`${ship} missing from reference data`);
    return buildShipAbilities(built);
};

const cone = () => parsePattern('Pattern-Cone-Range-1');
const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

const inertEnemy = (id: string, position: Position): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 150, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
});

const inertAlly = (id: string, position: Position): TeamActor => ({
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
        shipSkills: { slots: [{ slot: 'active' as const, abilities: [] }] },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: 1e9,
        },
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
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: false,
    startCharged: false,
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

/** A player-side caster on M4 striking enemy A (M4), B (M3), C (T3); OUT (M2) is outside. */
const playerCast = (ship: string, slot: 'active' | 'charged'): CombatEngineInput =>
    base({
        crit: 50,
        shipSkills: realKit(ship, slot),
        ...(slot === 'charged'
            ? { chargeCount: 1, hasChargedSkill: true, startCharged: true }
            : {}),
        enemyAttackers: [
            inertEnemy('enemy-a', 'M4'),
            inertEnemy('enemy-b', 'M3'),
            inertEnemy('enemy-c', 'T3'),
            inertEnemy('enemy-out', 'M2'),
        ],
    });

/** The mirror: an enemy caster on M4 striking the player focus (M4) and allies on M3 / T3. */
const enemyCast = (ship: string, slot: 'active' | 'charged'): CombatEngineInput =>
    base({
        attack: 0,
        speed: 150,
        teamActors: [
            inertAlly('ally-b', 'M3'),
            inertAlly('ally-c', 'T3'),
            inertAlly('ally-out', 'M2'),
        ],
        enemyAttackers: [
            {
                id: 'caster',
                stats: {
                    attack: 1000,
                    crit: 50,
                    critDamage: 0,
                    defence: 0,
                    hp: 1e9,
                    speed: 10,
                    security: 0,
                    hacking: 0,
                },
                chargeCount: slot === 'charged' ? 1 : 0,
                startCharged: slot === 'charged',
                position: 'M4',
                target: parseTarget('front'),
                pattern: cone(),
                shipSkills: realKit(ship, slot),
            },
        ],
    });

interface CastReading {
    critVictims: Set<string>;
    struck: Set<string>;
    extended: Set<string>;
    granted: string[];
    /** The caster's charge gain from charge manipulation (`charge-changed` reason 'manip'). */
    chargeGain: number;
}

const readCast = (input: CombatEngineInput, casterId: string, seed: number): CastReading => {
    setupKeyedRng(seed);
    extendCalls.length = 0;
    const bus = createEventBus();
    const critVictims = new Set<string>();
    const struck = new Set<string>();
    const granted: string[] = [];
    let chargeGain = 0;
    bus.on('charge-changed', (e: Extract<CombatEvent, { type: 'charge-changed' }>) => {
        if (e.actorId === casterId && e.round === 1 && e.reason === 'manip')
            chargeGain += e.newCharge - e.oldCharge;
    });
    bus.on('ability-performed', (e: Extract<CombatEvent, { type: 'ability-performed' }>) => {
        if (e.actorId !== casterId || e.round !== 1) return;
        for (const id of e.critVictimIds ?? []) critVictims.add(id);
    });
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.attackerId === casterId && e.round === 1) struck.add(e.targetId);
    });
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (e.granterId === casterId && e.round === 1) granted.push(`${e.buffName}@${e.actorId}`);
    });
    runCombat({ ...input, bus });
    return {
        critVictims,
        struck,
        extended: new Set(extendCalls.map((c) => c.victimId)),
        granted,
        chargeGain,
    };
};

/** Seeds on which `fired(reading)` disagrees with "some struck enemy was crit". */
const mismatches = (
    input: CombatEngineInput,
    casterId: string,
    fired: (r: CastReading) => boolean
): { seed: number; crit: string[]; fired: boolean }[] => {
    const out: { seed: number; crit: string[]; fired: boolean }[] = [];
    for (const seed of SEEDS) {
        const r = readCast(input, casterId, seed);
        if (fired(r) !== r.critVictims.size > 0)
            out.push({ seed, crit: [...r.critVictims], fired: fired(r) });
    }
    return out;
};

describe("Lev's charged: a crit on any struck enemy extends every struck enemy's debuffs", () => {
    it('player Lev: extends iff some struck enemy was crit, and then reaches A, B and C', () => {
        const input = playerCast('Lev', 'charged');
        expect(mismatches(input, 'attacker', (r) => r.extended.size > 0)).toEqual([]);
        // Non-vacuity: the sweep holds seeds where only a covered enemy was crit.
        const onlyCovered = SEEDS.map((s) => readCast(input, 'attacker', s)).filter(
            (r) => r.critVictims.size > 0 && !r.critVictims.has('enemy-a')
        );
        expect(onlyCovered.length).toBeGreaterThan(10);
        for (const r of onlyCovered) {
            expect([...r.struck].sort()).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
            expect([...r.extended].sort()).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        }
    });

    it('enemy Lev: the same against the player side', () => {
        const input = enemyCast('Lev', 'charged');
        expect(mismatches(input, 'caster', (r) => r.extended.size > 0)).toEqual([]);
        const onlyCovered = SEEDS.map((s) => readCast(input, 'caster', s)).filter(
            (r) => r.critVictims.size > 0 && !r.critVictims.has('attacker')
        );
        expect(onlyCovered.length).toBeGreaterThan(10);
        for (const r of onlyCovered)
            expect([...r.extended].sort()).toEqual(['ally-b', 'ally-c', 'attacker']);
    });
});

describe("Lev's charged Crit Power Up II needs a real crit", () => {
    const grantsCritPower = (r: CastReading) =>
        r.granted.some((g) => g.startsWith('Crit Power Up II@'));

    it('player Lev: granted iff some struck enemy was crit', () => {
        const input = playerCast('Lev', 'charged');
        expect(mismatches(input, 'attacker', grantsCritPower)).toEqual([]);
        // Both outcomes occur in the sweep.
        const readings = SEEDS.map((s) => readCast(input, 'attacker', s));
        expect(readings.some((r) => r.critVictims.size === 0)).toBe(true);
        expect(readings.some((r) => r.critVictims.size > 0 && grantsCritPower(r))).toBe(true);
    });

    it('enemy Lev: granted iff some struck player ship was crit', () => {
        const input = enemyCast('Lev', 'charged');
        expect(mismatches(input, 'caster', grantsCritPower)).toEqual([]);
        const readings = SEEDS.map((s) => readCast(input, 'caster', s));
        expect(readings.some((r) => r.critVictims.size === 0)).toBe(true);
    });

    /** One seeded DPS-calculator run with crit 50 and no base crit power, recording the rounds
     *  Crit Power Up II is granted on. */
    const dpsRun = (shipSkills: ShipSkills) => {
        setupKeyedRng(1);
        const bus = createEventBus();
        const grantRounds: number[] = [];
        bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
            if (e.buffName === 'Crit Power Up II') grantRounds.push(e.round);
        });
        const result = simulateDPS({
            attack: 1000,
            crit: 50,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 1,
            startCharged: true,
            enemyDefense: 0,
            enemyHp: 1e9,
            rounds: 12,
            selfBuffs: [],
            enemyDebuffs: [],
            hacking: 0,
            enemySecurity: 0,
            shipSkills,
            bus,
        });
        return { rounds: result.rounds, grantRounds };
    };

    it('DPS calculator: granted only on a charged cast that crits', () => {
        const { rounds, grantRounds } = dpsRun(realKit('Lev', 'charged'));
        const charged = rounds.filter((r) => r.action === 'charged');
        // Non-vacuity: the run holds charged casts that crit and ones that do not.
        expect(charged.some((r) => r.didCrit)).toBe(true);
        expect(charged.some((r) => !r.didCrit)).toBe(true);
        expect(grantRounds).toEqual(charged.filter((r) => r.didCrit).map((r) => r.round));
    });

    it('DPS calculator: a crit-gated grant written before the damage still waits for the hit', () => {
        // Lev's charged clauses with the grant moved ahead of the damage: its crit does not exist
        // until the hit, so it is decided after it, on crit casts only, and never boosts the hit
        // that earned it — that round's damage equals a run whose kit has no grant at all.
        const [lev] = realKit('Lev', 'charged').slots;
        const grant = lev.abilities.filter((ab) => ab.type === 'buff');
        const rest = lev.abilities.filter((ab) => ab.type !== 'buff');
        expect(grant).toHaveLength(1);
        const { rounds, grantRounds } = dpsRun({
            slots: [{ slot: 'charged', abilities: [...grant, ...rest] }],
        });
        const without = dpsRun({ slots: [{ slot: 'charged', abilities: rest }] });
        const charged = rounds.filter((r) => r.action === 'charged');
        expect(charged.some((r) => !r.didCrit)).toBe(true);
        expect(grantRounds.length).toBeGreaterThan(0);
        const boosted = grantRounds.filter(
            (round) => rounds[round - 1].directDamage !== without.rounds[round - 1].directDamage
        );
        expect(boosted).toEqual([]);
        expect(grantRounds).toEqual(charged.filter((r) => r.didCrit).map((r) => r.round));
    });
});

describe("Lionheart's crit grant already follows the cast's real crits", () => {
    // "If this critically hits, this Unit grants Attack Up II to all adjacent allies" — a
    // reactive on-crit grant, fed by the positional ability-performed's crit identity.
    const grantsAttackUp = (r: CastReading) => r.granted.some((g) => g.startsWith('Attack Up II@'));
    const withAdjacentAlly = (input: CombatEngineInput): CombatEngineInput => ({
        ...input,
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Line-from-centre-Range-1'),
        teamActors: [inertAlly('ally-adj', 'T4')],
    });

    it('player Lionheart: granted iff some struck enemy was crit', () => {
        const input = withAdjacentAlly(playerCast('Lionheart', 'active'));
        expect(mismatches(input, 'attacker', grantsAttackUp)).toEqual([]);
        expect(SEEDS.some((s) => grantsAttackUp(readCast(input, 'attacker', s)))).toBe(true);
    });
});

describe("Asphodel's passive adds 1 charge per cast that crits", () => {
    // "This Unit adds 1 charge to its charged skill after critically damaging an enemy" (R128):
    // an area cast critting A and C adds 1, however many enemies it crits. Charge count 4 so the
    // cap (her real count is 2) cannot hide a +2 or +3; round 1 is an active cast on every seed.
    // Refit 0: the clause is her first passive, and her refit-2 "attacks always critically hit"
    // would crit every enemy on every seed, leaving no cast that crits only some.
    const playerAsphodel = (): CombatEngineInput => ({
        ...playerCast('Asphodel', 'active'),
        shipSkills: fullKit('Asphodel', 0),
        chargeCount: 4,
        hasChargedSkill: true,
        startCharged: false,
    });
    const enemyAsphodel = (): CombatEngineInput => {
        const input = enemyCast('Asphodel', 'active');
        const [caster] = input.enemyAttackers;
        return {
            ...input,
            enemyAttackers: [
                {
                    ...caster,
                    shipSkills: fullKit('Asphodel', 0),
                    chargeCount: 4,
                    startCharged: false,
                },
            ],
        };
    };

    const expectPerCritCharge = (input: CombatEngineInput, casterId: string, aimedId: string) => {
        const readings = SEEDS.map((seed) => ({ seed, ...readCast(input, casterId, seed) }));
        const wrong = readings
            .filter((r) => r.chargeGain !== (r.critVictims.size > 0 ? 1 : 0))
            .map((r) => ({ seed: r.seed, crit: [...r.critVictims], gain: r.chargeGain }));
        expect(wrong).toEqual([]);
        const covered = (r: CastReading) => [...r.critVictims].filter((id) => id !== aimedId);
        // Crits on the aimed enemy and one covered enemy: still +1.
        expect(
            readings.some(
                (r) => r.critVictims.has(aimedId) && covered(r).length === 1 && r.chargeGain === 1
            )
        ).toBe(true);
        // A crit on a covered enemy alone: +1.
        expect(
            readings.some(
                (r) => !r.critVictims.has(aimedId) && covered(r).length === 1 && r.chargeGain === 1
            )
        ).toBe(true);
        // No crit: nothing.
        expect(readings.some((r) => r.critVictims.size === 0 && r.chargeGain === 0)).toBe(true);
        // Every struck enemy crit: still +1.
        expect(readings.some((r) => r.critVictims.size === 3 && r.chargeGain === 1)).toBe(true);
    };

    it('player Asphodel: +1 per cast that crits', () => {
        expectPerCritCharge(playerAsphodel(), 'attacker', 'enemy-a');
    });

    it('enemy Asphodel: +1 per cast that crits', () => {
        expectPerCritCharge(enemyAsphodel(), 'caster', 'attacker');
    });

    it('DPS calculator: one enemy, so +1 on a critting active cast and nothing otherwise', () => {
        const bus = createEventBus();
        const gainByRound = new Map<number, number>();
        bus.on('charge-changed', (e: Extract<CombatEvent, { type: 'charge-changed' }>) => {
            if (e.reason !== 'manip') return;
            gainByRound.set(e.round, (gainByRound.get(e.round) ?? 0) + e.newCharge - e.oldCharge);
        });
        const result = simulateDPS({
            attack: 1000,
            crit: 50,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 50,
            startCharged: false,
            enemyDefense: 0,
            enemyHp: 1e9,
            rounds: 12,
            selfBuffs: [],
            enemyDebuffs: [],
            hacking: 0,
            enemySecurity: 0,
            shipSkills: fullKit('Asphodel', 0),
            bus,
        });
        const active = result.rounds.filter((r) => r.action === 'active');
        expect(active.some((r) => r.didCrit)).toBe(true);
        expect(active.some((r) => !r.didCrit)).toBe(true);
        for (const r of active) expect(gainByRound.get(r.round) ?? 0).toBe(r.didCrit ? 1 : 0);
    });
});
