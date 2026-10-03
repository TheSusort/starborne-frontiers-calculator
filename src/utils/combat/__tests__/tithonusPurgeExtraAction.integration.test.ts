/**
 * Tithonus passive — "This Unit gains 1 extra action after it purges at least 4 buffs with a
 * single skill" (owner rulings 2026-10-03):
 *
 *   - the count is the TOTAL buffs his purges remove across every enemy the one skill strikes;
 *   - a purge of 2 on an enemy holding 1 buff removes 1;
 *   - buffs he STEALS do not count;
 *   - there is no once-per-round limit: every skill that purges 4 or more grants another action,
 *     so the chain runs until a cast purges fewer than 4 — the enemies run out of buffs or die —
 *     or until the engine's sim-safety cap (MAX_CHAINED_EXTRA_ACTIONS_PER_ROUND).
 *
 * Real parsed kit (buildTraceShip on docs/ship-skills.csv, refit 4 passive) on
 * Pattern-Circle-Range-1 anchored on M4, which strikes M4, M3 and T4; M2 is outside it and its
 * holder carries 4 buffs so a count leaking past the footprint would grant the action. Every
 * buff holder is faster than Tithonus and grants itself its buffs on its own round-1 turn.
 * Extra actions are read off Tithonus's round-1 `turn-started` count (2 = one extra action).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput, MAX_CHAINED_EXTRA_ACTIONS_PER_ROUND } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

const hasReferenceData = (): boolean => csvAvailable() && shipDataAvailable();

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

const tithonusKit = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: realSlot('Tithonus', 'active') },
        { slot: 'charged', abilities: realSlot('Tithonus', 'charged') },
        { slot: 'passive', abilities: realSlot('Tithonus', 'passive') },
    ],
});

let idc = 0;
/** A removable timed self buff with no stat effects. */
const selfBuff = (name: string): Ability => ({
    id: `sb-${++idc}`,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: name,
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 3,
    },
});
const buffKit = (n: number): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: Array.from({ length: n }, (_, i) => selfBuff(`Neutral Buff ${i + 1}`)),
        },
    ],
});

const OUTSIDE_BUFFS = 4;
/** Max HP that lets his chain kill the regain-buff board part-way through round 1. */
const REGAINER_HP = 20_000;

/** A durable, harmless enemy that grants itself `buffs` buffs before Tithonus acts. */
const buffedEnemy = (id: string, position: Position, buffs: number): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 150, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: single(),
    shipSkills: buffKit(buffs),
});

/** Enemies A (M4, the anchor), B (M3) and C (T4) in his pattern, plus one outside it at M2. */
const enemies = ([a, b, c]: [number, number, number]): EnemyAttacker[] => [
    buffedEnemy('enemy-a', 'M4', a),
    buffedEnemy('enemy-b', 'M3', b),
    buffedEnemy('enemy-c', 'T4', c),
    buffedEnemy('enemy-out', 'M2', OUTSIDE_BUFFS),
];

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 10_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 3,
    shipSkills: tithonusKit(),
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: true,
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
    pattern: circle(),
    speed: 100,
    ...over,
});

interface Measured {
    /** Tithonus's round-1 turns (2 = one extra action). */
    turns: number;
    /** Buffs Tithonus's purges removed, per round-1 turn. */
    purgedPerTurn: number[];
}

const measure = (input: CombatEngineInput, casterId: string): Measured => {
    const bus = createEventBus();
    const purgedPerTurn: number[] = [];
    bus.on('turn-started', (e) => {
        if (e.actorId === casterId && e.round === 1) purgedPerTurn.push(0);
    });
    bus.on('purge-performed', (e) => {
        if (e.casterId !== casterId || e.round !== 1 || purgedPerTurn.length === 0) return;
        purgedPerTurn[purgedPerTurn.length - 1] += e.count;
    });
    runCombat({ ...input, bus });
    return { turns: purgedPerTurn.length, purgedPerTurn };
};

const player = (buffs: [number, number, number], over: Partial<CombatEngineInput> = {}) =>
    measure(base({ enemyAttackers: enemies(buffs), ...over }), 'attacker');

beforeEach(() => {
    idc = 0;
    setupKeyedRng(5);
});

describe.skipIf(!hasReferenceData())("Tithonus's real passive parses to the purge gate", () => {
    it('an on-cast extra action gated on 4+ buffs purged by one skill, no once-per-round', () => {
        const grant = realSlot('Tithonus', 'passive').filter((a) => a.type === 'extra-action');
        expect(grant).toHaveLength(1);
        expect(grant[0]).toMatchObject({
            trigger: 'on-cast',
            conditions: [
                {
                    subject: 'buffs-purged-this-cast',
                    derivable: true,
                    countComparator: 'gte',
                    countThreshold: 4,
                },
            ],
            config: { type: 'extra-action', oncePerRound: false, chains: true },
        });
    });
});

describe.skipIf(!hasReferenceData())('player-side Tithonus — 4+ buffs purged by one skill', () => {
    it('A, B and C with two buffs each → his active purges 6 → one extra action', () => {
        const m = player([2, 2, 2]);
        expect(m.purgedPerTurn).toEqual([6, 0]);
        expect(m.turns).toBe(2);
    });

    it('A, B and C with one buff each → 3 purged → no extra action', () => {
        const m = player([1, 1, 1]);
        expect(m.purgedPerTurn).toEqual([3]);
        expect(m.turns).toBe(1);
    });

    it('a purge of 2 on an enemy holding 1 removes 1: 2 + 1 + 1 = 4 → one extra action', () => {
        const m = player([2, 1, 1]);
        expect(m.purgedPerTurn).toEqual([4, 0]);
        expect(m.turns).toBe(2);
    });
});

describe.skipIf(!hasReferenceData())('a stolen buff does not count', () => {
    // His charged skill steals 1 buff from the primary target (A), THEN purges 2 from each enemy.
    const charged = (buffs: [number, number, number]) => player(buffs, { startCharged: true });

    it('A 2, B 1, C 1: 1 stolen + 3 purged → no extra action', () => {
        const m = charged([2, 1, 1]);
        expect(m.purgedPerTurn).toEqual([3]);
        expect(m.turns).toBe(1);
    });

    it('control — A 3, B 1, C 1: 1 stolen + 4 purged → one extra action', () => {
        const m = charged([3, 1, 1]);
        expect(m.purgedPerTurn).toEqual([4, 0]);
        expect(m.turns).toBe(2);
    });
});

describe.skipIf(!hasReferenceData())('the extra action chains until the buffs run out', () => {
    it('five buffs each → purges 6, 6, then 3: two chained extra actions, then none', () => {
        const m = player([5, 5, 5]);
        expect(m.purgedPerTurn).toEqual([6, 6, 3]);
        expect(m.turns).toBe(3);
    });
});

describe.skipIf(!hasReferenceData())(
    'enemy-side Tithonus counts buffs purged from player ships',
    () => {
        /** A durable player-side ship that grants itself `buffs` buffs before the enemy Tithonus acts. */
        const buffedAlly = (id: string, position: Position, buffs: number): TeamActor => ({
            id,
            speed: 150,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            position,
            target: parseTarget('front'),
            pattern: single(),
            walk: {
                shipSkills: buffKit(buffs),
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
        const enemyTithonus: EnemyAttacker = {
            id: 'enemy-tithonus',
            stats: {
                attack: 10_000,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1e9,
                speed: 10,
                security: 0,
                hacking: 0,
            },
            chargeCount: 3,
            startCharged: false,
            position: 'M4',
            target: parseTarget('front'),
            pattern: circle(),
            shipSkills: tithonusKit(),
        };
        const run = (buffs: number) =>
            measure(
                base({
                    attack: 0,
                    speed: 150,
                    chargeCount: 0,
                    hasChargedSkill: false,
                    shipSkills: buffKit(buffs),
                    teamActors: [
                        buffedAlly('ally-b', 'M3', buffs),
                        buffedAlly('ally-c', 'T4', buffs),
                        buffedAlly('ally-out', 'M2', OUTSIDE_BUFFS),
                    ],
                    enemyAttackers: [enemyTithonus],
                }),
                'enemy-tithonus'
            );

        it('three player ships with two buffs each → 6 purged → one extra action', () => {
            const m = run(2);
            expect(m.purgedPerTurn).toEqual([6, 0]);
            expect(m.turns).toBe(2);
        });

        it('three player ships with one buff each → 3 purged → no extra action', () => {
            const m = run(1);
            expect(m.purgedPerTurn).toEqual([3]);
            expect(m.turns).toBe(1);
        });
    }
);

describe.skipIf(!hasReferenceData())(
    'enemies that regain a buff when hit keep the chain going',
    () => {
        // Opal, Bizon, Nayra and Panguan each gain a buff whenever they are directly damaged (no
        // once-per-round). His purge resolves before his damage, so every cast strips the buff his
        // previous cast handed back: five of them in his pattern give 5 purged per active cast and 4
        // on a charged cast (its steal takes the primary's buff first). Owner ruling 2026-10-03: the
        // chain continues until something else stops it.
        const REGAINERS = ['Opal', 'Bizon', 'Nayra', 'Panguan', 'Opal'];
        const CELLS: Position[] = ['M4', 'M3', 'M2', 'T3', 'B3'];
        const regainer = (i: number, hp: number): EnemyAttacker => ({
            ...buffedEnemy(`enemy-${i}`, CELLS[i], 1),
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 150, security: 0 },
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: buffKit(1).slots[0].abilities },
                    { slot: 'passive', abilities: realSlot(REGAINERS[i], 'passive') },
                ],
            },
        });
        // His real targeting: 'skip' on Circle-Range-1 anchors on M3 and strikes all five cells.
        const run = (hp: number) =>
            measure(
                base({
                    attack: 1000,
                    target: parseTarget('skip'),
                    enemyAttackers: REGAINERS.map((_, i) => regainer(i, hp)),
                }),
                'attacker'
            );

        it('durable regainers: the chain runs to the sim-safety cap and nothing throws', () => {
            expect(MAX_CHAINED_EXTRA_ACTIONS_PER_ROUND).toBe(20);
            const m = run(1e9);
            expect(m.turns).toBe(1 + MAX_CHAINED_EXTRA_ACTIONS_PER_ROUND);
            expect(m.purgedPerTurn.every((n) => n >= 4)).toBe(true);
        });

        it('fragile regainers: the chain ends once too few of them are left alive', () => {
            const m = run(REGAINER_HP);
            // Past the 8-insertion tripwire non-chainable grants throw at, and short of the cap.
            expect(m.turns).toBeGreaterThan(9);
            expect(m.turns).toBeLessThan(1 + MAX_CHAINED_EXTRA_ACTIONS_PER_ROUND);
            expect(m.purgedPerTurn.slice(0, -1).every((n) => n >= 4)).toBe(true);
            expect(m.purgedPerTurn[m.purgedPerTurn.length - 1]).toBeLessThan(4);
        });
    }
);
