/**
 * "When an ally critically hits an enemy" counts a crit from the ally's PASSIVE damage too, not
 * only from its skills (owner ruling 53, 2026-10-05). The ally here is Chakara, whose round-start
 * passive "deals 60% damage to the enemy with the highest speed"; at crit 100 that hit crits:
 *   - Sentinel deals 60% to that enemy and repairs Chakara 5%;
 *   - Hermes grants Chakara Everliving Regeneration III;
 *   - Howler grants Chakara Blast.
 * Every ship carries only its passive slot, and only reactions inside the round-start phase are
 * read (before any ship's turn), so every reaction counted is to the round-start passive hit.
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

const passiveKit = (ship: string): ShipSkills => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const full = buildShipAbilities(built);
    return { ...full, slots: full.slots.filter((s) => s.slot === 'passive') };
};
const EMPTY: ShipSkills = { slots: [] };

const stats = (crit: number) => ({
    attack: 1000,
    crit,
    critDamage: 50,
    defence: 0,
    hp: 1e9,
    security: 0,
    hacking: 0,
});

const teamShip = (
    id: string,
    kit: ShipSkills,
    position: Position,
    speed: number,
    crit = 0
): TeamActorEngineInput => ({
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
        shipSkills: kit,
        stats: { ...stats(crit), defensePenetration: 0 },
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

const enemyShip = (
    id: string,
    kit: ShipSkills,
    position: Position,
    speed: number,
    crit = 0
): EnemyAttacker => ({
    id,
    stats: { ...stats(crit), speed },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: kit,
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1000,
    crit: 0,
    critDamage: 50,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: EMPTY,
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
    pattern: parsePattern('Pattern-Base'),
    speed: 50,
    ...over,
});

const REACTORS = ['Sentinel', 'Hermes', 'Howler'] as const;
const REACTOR_CELLS: Position[] = ['T4', 'B4', 'M3'];

/** Player Chakara (the focus) and player reactors against two inert enemies. */
const playerBoard = (chakaraCrit: number, reactorsOnEnemySide = false): CombatEngineInput =>
    base({
        shipSkills: passiveKit('Chakara'),
        crit: chakaraCrit,
        teamActors: reactorsOnEnemySide
            ? []
            : REACTORS.map((s, i) => teamShip(s, passiveKit(s), REACTOR_CELLS[i], 100 - i)),
        enemyAttackers: [
            enemyShip('fast-enemy', EMPTY, 'M4', 300),
            enemyShip('slow-enemy', EMPTY, 'M3', 20),
            ...(reactorsOnEnemySide
                ? REACTORS.map((s, i) =>
                      enemyShip(s, passiveKit(s), (['T3', 'B3', 'B4'] as const)[i], 100 - i)
                  )
                : []),
        ],
    });

/** The mirror: enemy Chakara and enemy reactors against the player focus and one inert ally. */
const enemyBoard = (chakaraCrit: number): CombatEngineInput =>
    base({
        speed: 300,
        teamActors: [teamShip('slow-ally', EMPTY, 'M3', 20)],
        enemyAttackers: [
            enemyShip('Chakara', passiveKit('Chakara'), 'M4', 10, chakaraCrit),
            ...REACTORS.map((s, i) => enemyShip(s, passiveKit(s), REACTOR_CELLS[i], 100 - i)),
        ],
    });

interface Reading {
    chakaraCrit: boolean;
    victim?: string;
    sentinelHit: string[];
    sentinelRepaired: string[];
    grants: string[];
}

const read = (input: CombatEngineInput, chakaraId: string): Reading => {
    setupKeyedRng(1);
    const bus = createEventBus();
    const r: Reading = { chakaraCrit: false, sentinelHit: [], sentinelRepaired: [], grants: [] };
    // Only the round-start phase counts: a ship with no skill throws a basic attack on its turn,
    // and that cast's own crits are not what this file measures.
    let roundStart = true;
    bus.on('turn-started', () => {
        roundStart = false;
    });
    bus.on(
        'reactive-damage-performed',
        (e: Extract<CombatEvent, { type: 'reactive-damage-performed' }>) => {
            if (!roundStart) return;
            if (e.sourceId === chakaraId) {
                r.chakaraCrit = e.didCrit === true;
                r.victim = e.targetId;
            }
            if (e.sourceId === 'Sentinel') r.sentinelHit.push(e.targetId);
        }
    );
    bus.on(
        'reactive-heal-performed',
        (e: Extract<CombatEvent, { type: 'reactive-heal-performed' }>) => {
            if (roundStart && e.casterId === 'Sentinel')
                r.sentinelRepaired.push(...e.perTarget.map((t) => t.targetId));
        }
    );
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (!roundStart) return;
        if (e.buffName === 'Everliving Regeneration III' || e.buffName === 'Blast')
            r.grants.push(`${e.buffName}@${e.actorId}`);
    });
    runCombat({ ...input, bus });
    return r;
};

describe.each([
    { side: 'player', board: playerBoard, chakara: 'attacker', victim: 'fast-enemy' },
    { side: 'enemy', board: enemyBoard, chakara: 'Chakara', victim: 'attacker' },
] as const)("Chakara's critting round-start hit ($side side)", ({ board, chakara, victim }) => {
    it('wakes Sentinel (hit that enemy, repair Chakara), Hermes and Howler', () => {
        const r = read(board(100), chakara);
        expect(r.chakaraCrit).toBe(true);
        expect(r.victim).toBe(victim);
        expect(r.sentinelHit).toEqual([victim]);
        expect(r.sentinelRepaired).toEqual([chakara]);
        expect(r.grants.sort()).toEqual(
            [`Blast@${chakara}`, `Everliving Regeneration III@${chakara}`].sort()
        );
    });

    it('negative: a non-critting round-start hit wakes none of them', () => {
        const r = read(board(0), chakara);
        expect(r.victim).toBe(victim);
        expect(r.chakaraCrit).toBe(false);
        expect(r.sentinelHit).toEqual([]);
        expect(r.sentinelRepaired).toEqual([]);
        expect(r.grants).toEqual([]);
    });
});

describe('reverse board: the reactors are on the OTHER side from Chakara', () => {
    it("an enemy's critting passive hit is not an ally crit", () => {
        const r = read(playerBoard(100, true), 'attacker');
        expect(r.chakaraCrit).toBe(true);
        expect(r.sentinelHit).toEqual([]);
        expect(r.sentinelRepaired).toEqual([]);
        expect(r.grants).toEqual([]);
    });
});
