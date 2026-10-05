/**
 * A direct hit on a stasised ship lowers its Stasis by one turn straight away, and every hit
 * counts, whoever lands it (owner rulings 40 and 67, 2026-10-05):
 *   - Razi lands a 1-turn Stasis on Lev; Bedrock hits Lev before Lev's turn → Stasis 1 → 0, and
 *     Lev takes his turn that same round.
 *   - Medved lands a 2-turn Stasis; two different Bedrocks hit before the victim's turn →
 *     2 → 0, and it acts that round. One Bedrock → 2 → 1: it skips this round and acts next.
 *
 * Observable: the rounds in which the victim fires a skill (`ability-performed`). Real kits:
 * Razi's and Medved's charged skills (Stasis 1 / Stasis 2), Bedrock's active (90% damage),
 * Akula's active (her "attacks do not reduce Stasis" passive is the negative).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data)'
        );
    }
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** One slot of a real kit, plus the ship-level flags (Akula's `doesntBreakStasis`). */
const slotKit = (ship: string, slot: 'active' | 'charged'): ShipSkills => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const full = buildShipAbilities(built);
    return { ...full, slots: full.slots.filter((s) => s.slot === slot) };
};

const APPLIER_SPEED = 300;
const VICTIM_SPEED = 100;
const BEFORE_VICTIM = [200, 190];
const AFTER_VICTIM = [50, 40];

/** A player-side hitter walked as a team actor. */
const teamHitter = (
    id: string,
    ship: string,
    position: Position,
    speed: number
): TeamActorEngineInput => {
    const kit = slotKit(ship, 'active');
    return {
        id,
        speed,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        doesntBreakStasis: kit.doesntBreakStasis,
        walk: {
            shipSkills: kit,
            stats: {
                attack: 100,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 1e12,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    };
};

const enemyShip = (
    id: string,
    kit: ShipSkills,
    position: Position,
    speed: number,
    charged = false
): EnemyAttacker => ({
    id,
    stats: {
        attack: 100,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1e12,
        speed,
        security: 0,
        hacking: 1e6,
    },
    // Charged once, at round 1: a 10-charge cost is not met again inside the run.
    chargeCount: charged ? 10 : 0,
    startCharged: charged,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: kit,
    doesntBreakStasis: kit.doesntBreakStasis,
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 100,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
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
    hp: 1e12,
    hacking: 1e6,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    speed: APPLIER_SPEED,
    ...over,
});

interface Board {
    /** The Stasis applier: Razi (1 turn) or Medved (2 turns), firing its charged skill once. */
    applier: 'Razi' | 'Medved';
    /** Hitters' ships, one per entry. */
    hitters: string[];
    hitterSpeeds: number[];
}

const HITTER_CELLS: Position[] = ['T4', 'B4'];

/** Player applier + player hitters against an enemy victim. */
const playerBoard = ({ applier, hitters, hitterSpeeds }: Board): CombatEngineInput =>
    base({
        shipSkills: slotKit(applier, 'charged'),
        chargeCount: 10,
        startCharged: true,
        hasChargedSkill: true,
        teamActors: hitters.map((ship, i) =>
            teamHitter(`hitter-${i}`, ship, HITTER_CELLS[i], hitterSpeeds[i])
        ),
        enemyAttackers: [enemyShip('victim', slotKit('Bedrock', 'active'), 'M4', VICTIM_SPEED)],
    });

/** The mirror: an enemy applier + enemy hitters against the player focus. */
const enemyBoard = ({ applier, hitters, hitterSpeeds }: Board): CombatEngineInput =>
    base({
        shipSkills: slotKit('Bedrock', 'active'),
        speed: VICTIM_SPEED,
        hacking: 0,
        enemyAttackers: [
            enemyShip('applier', slotKit(applier, 'charged'), 'M4', APPLIER_SPEED, true),
            ...hitters.map((ship, i) =>
                enemyShip(`hitter-${i}`, slotKit(ship, 'active'), HITTER_CELLS[i], hitterSpeeds[i])
            ),
        ],
    });

interface Reading {
    /** Rounds the victim fired a skill. */
    acted: number[];
    /** Did the Stasis land in round 1? (Instrument.) */
    stasisLanded: boolean;
    /** Hits the hitters landed on the victim in round 1. (Instrument.) */
    round1Hits: number;
}

const read = (input: CombatEngineInput, victimId: string): Reading => {
    setupKeyedRng(1);
    const bus = createEventBus();
    const acted: number[] = [];
    let stasisLanded = false;
    let round1Hits = 0;
    bus.on('ability-performed', (e: Extract<CombatEvent, { type: 'ability-performed' }>) => {
        if (e.actorId === victimId) acted.push(e.round);
    });
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.targetId === victimId && e.buffName === 'Stasis' && e.round === 1)
            stasisLanded = true;
    });
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.targetId === victimId && e.round === 1 && e.attackerId.includes('hitter'))
            round1Hits += 1;
    });
    runCombat({ ...input, bus });
    return { acted, stasisLanded, round1Hits };
};

const SIDES = [
    { side: 'player', board: playerBoard, victim: 'victim' },
    { side: 'enemy', board: enemyBoard, victim: 'attacker' },
] as const;

describe.each(SIDES)(
    'a hit lowers Stasis immediately ($side side applier)',
    ({ board, victim }) => {
        it("Razi's 1-turn Stasis, Bedrock hits before the victim's turn → it acts that round", () => {
            const r = read(
                board({ applier: 'Razi', hitters: ['Bedrock'], hitterSpeeds: BEFORE_VICTIM }),
                victim
            );
            expect(r.stasisLanded).toBe(true);
            expect(r.round1Hits).toBe(1);
            expect(r.acted).toEqual([1, 2, 3]);
        });

        it('control: no hitter → the 1-turn Stasis costs it round 1', () => {
            const r = read(board({ applier: 'Razi', hitters: [], hitterSpeeds: [] }), victim);
            expect(r.stasisLanded).toBe(true);
            expect(r.acted).toEqual([2, 3]);
        });

        it("Medved's 2-turn Stasis, two different ships hit before its turn → 2 → 0, it acts", () => {
            const r = read(
                board({
                    applier: 'Medved',
                    hitters: ['Bedrock', 'Bedrock'],
                    hitterSpeeds: BEFORE_VICTIM,
                }),
                victim
            );
            expect(r.stasisLanded).toBe(true);
            expect(r.round1Hits).toBe(2);
            expect(r.acted).toEqual([1, 2, 3]);
        });

        it("Medved's 2-turn Stasis, one hit before its turn → 2 → 1: skips round 1, acts in round 2", () => {
            const r = read(
                board({ applier: 'Medved', hitters: ['Bedrock'], hitterSpeeds: BEFORE_VICTIM }),
                victim
            );
            expect(r.round1Hits).toBe(1);
            expect(r.acted).toEqual([2, 3]);
        });

        it("control: Medved's 2-turn Stasis with no hitter skips rounds 1 and 2", () => {
            const r = read(board({ applier: 'Medved', hitters: [], hitterSpeeds: [] }), victim);
            expect(r.acted).toEqual([3]);
        });

        it('negative: Akula\'s "attacks do not reduce Stasis" — two Akula hits leave it skipping', () => {
            const r = read(
                board({
                    applier: 'Medved',
                    hitters: ['Akula', 'Akula'],
                    hitterSpeeds: BEFORE_VICTIM,
                }),
                victim
            );
            expect(r.round1Hits).toBe(2);
            expect(r.acted).toEqual([3]);
        });

        it('reverse board: the two hits land AFTER its turn → it skips round 1, freed for round 2', () => {
            const r = read(
                board({
                    applier: 'Medved',
                    hitters: ['Bedrock', 'Bedrock'],
                    hitterSpeeds: AFTER_VICTIM,
                }),
                victim
            );
            expect(r.round1Hits).toBe(2);
            expect(r.acted).toEqual([2, 3]);
        });
    }
);

// A passive damage proc is a direct hit too (ruling 36), so it lowers Stasis the same way: Chakara's
// round-start "deals 60% damage to the enemy with the highest speed" lands on the stasised victim
// at the start of round 2, taking Medved's Stasis from 1 to 0 before the victim's turn.
const chakaraPassive = (): ShipSkills => {
    const built = buildTraceShip('Chakara');
    if (!built) throw new Error('Chakara missing from reference data');
    const full = buildShipAbilities(built);
    return { ...full, slots: full.slots.filter((s) => s.slot === 'passive') };
};

const playerProcBoard = (chakaraAttack: number): CombatEngineInput => {
    const board = playerBoard({ applier: 'Medved', hitters: [], hitterSpeeds: [] });
    const chakara = teamHitter('chakara', 'Bedrock', 'T4', 50);
    return {
        ...board,
        teamActors: [
            {
                ...chakara,
                walk: {
                    ...chakara.walk!,
                    shipSkills: chakaraPassive(),
                    stats: { ...chakara.walk!.stats, attack: chakaraAttack },
                },
            },
        ],
    };
};

const enemyProcBoard = (chakaraAttack: number): CombatEngineInput => {
    const board = enemyBoard({ applier: 'Medved', hitters: [], hitterSpeeds: [] });
    const chakara = enemyShip('chakara', chakaraPassive(), 'T4', 50);
    return {
        ...board,
        // The player focus must be the fastest player ship for Chakara's proc to find it.
        speed: 200,
        enemyAttackers: [
            ...board.enemyAttackers,
            { ...chakara, stats: { ...chakara.stats, attack: chakaraAttack } },
        ],
    };
};

describe.each([
    { side: 'player', board: playerProcBoard, victim: 'victim' },
    { side: 'enemy', board: enemyProcBoard, victim: 'attacker' },
] as const)(
    "Chakara's round-start proc lowers Stasis ($side side applier)",
    ({ board, victim }) => {
        it('the round-2 proc frees a 2-turn Stasis that would otherwise cost round 2', () => {
            expect(read(board(100), victim).acted).toEqual([2, 3]);
        });

        it('control: a 0-attack Chakara lands no hit, so the victim skips rounds 1 and 2', () => {
            expect(read(board(0), victim).acted).toEqual([3]);
        });
    }
);
