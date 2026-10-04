/**
 * A same-tier re-application of a held buff or debuff REFRESHES it: the store keeps whichever of
 * the two lasts longer, and on a tie the fresh copy replaces the held one (highest tier wins; a
 * re-gain is a fresh gain). Lifetime counts the own-turn reprieve: a 1-turn self buff gained on
 * the carrier's own turn survives that turn's Post-Turn, so a re-gain on its next turn outlasts
 * the held copy, whose reprieve is spent.
 *
 * Wusheng: "This Unit gains Stealth for 1 turn after critically damaging an enemy. This Unit takes
 * 25% less direct damage while Stealth is active." Critting every turn, he holds Stealth through
 * every enemy turn. Real parsed passive (buildTraceShip, refit 4) with a hand-built 100% active so
 * he crits on every turn; the enemy that hits him acts after him each round.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { createStatusEngine, type RegisteredAbilityStatus } from '../statusEngine';
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

const realPassive = (ship: string): Ability[] => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const found = buildShipAbilities(built).slots.find((s) => s.slot === 'passive');
    if (!found) throw new Error(`${ship} has no passive slot`);
    return found.abilities;
};

let idc = 0;
const hit = (multiplier: number): Ability => ({
    id: `rf-${++idc}`,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});
/** Wusheng's passive behind a plain 100% active. */
const wusheng = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [hit(100)] },
        { slot: 'passive', abilities: realPassive('Wusheng') },
    ],
});
const plainHitter = (): ShipSkills => ({ slots: [{ slot: 'active', abilities: [hit(100)] }] });

const ROUNDS = 6;

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
    shipSkills: plainHitter(),
    ...over,
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: plainHitter(),
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
    hp: 1e9,
    hacking: 0,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    speed: 200,
    ...over,
});

/** Per round, what the slow hitter's hit on `victimId` delivered, and how many times `victimId`'s
 *  Stealth expired. */
const measure = (input: CombatEngineInput, victimId: string, hitterId: string) => {
    const bus = createEventBus();
    const hits: number[] = [];
    let expiries = 0;
    let gains = 0;
    bus.on('attacked', (e) => {
        if (e.targetId === victimId && e.attackerId === hitterId)
            hits.push(Math.round(e.takenDamage ?? e.damage ?? NaN));
    });
    bus.on('buff-expired', (e) => {
        if (e.actorId === victimId && e.buffName === 'Stealth') expiries++;
    });
    bus.on('buff-applied', (e) => {
        if (e.actorId === victimId && e.buffName === 'Stealth') gains++;
    });
    runCombat({ ...input, bus });
    return { hits, expiries, gains };
};

beforeEach(() => {
    idc = 0;
    setupKeyedRng(7);
});

describe('Wusheng re-gaining Stealth every turn keeps it through every enemy turn', () => {
    it('player Wusheng: every hit after his turn is the Stealth-reduced one', () => {
        const out = measure(
            base({
                crit: 100,
                critDamage: 0,
                shipSkills: wusheng(),
                enemyAttackers: [
                    enemyAt('e-hitter', 'M4', {
                        stats: {
                            attack: 1000,
                            crit: 0,
                            critDamage: 0,
                            defence: 0,
                            hp: 1e9,
                            speed: 50,
                            security: 0,
                        },
                    }),
                ],
            }),
            'attacker',
            'e-hitter'
        );
        expect(out.gains).toBe(ROUNDS);
        expect(out.hits).toHaveLength(ROUNDS);
        expect(new Set(out.hits).size).toBe(1);
        // Control: without Stealth the same hitter does more (the reduction is real).
        const control = measure(
            base({
                crit: 0,
                shipSkills: wusheng(),
                enemyAttackers: [
                    enemyAt('e-hitter', 'M4', {
                        stats: {
                            attack: 1000,
                            crit: 0,
                            critDamage: 0,
                            defence: 0,
                            hp: 1e9,
                            speed: 50,
                            security: 0,
                        },
                    }),
                ],
            }),
            'attacker',
            'e-hitter'
        );
        expect(control.gains).toBe(0);
        expect(control.hits[0]).toBeGreaterThan(out.hits[0]);
        expect(out.hits[0] / control.hits[0]).toBeCloseTo(0.75, 5);
    });

    it('enemy Wusheng: every player hit after his turn is the Stealth-reduced one', () => {
        const out = measure(
            base({
                speed: 50,
                enemyAttackers: [
                    enemyAt('e-wusheng', 'M4', {
                        stats: {
                            attack: 1000,
                            crit: 100,
                            critDamage: 0,
                            defence: 0,
                            hp: 1e9,
                            speed: 200,
                            security: 0,
                        },
                        shipSkills: wusheng(),
                    }),
                ],
            }),
            'e-wusheng',
            'attacker'
        );
        expect(out.gains).toBe(ROUNDS);
        expect(out.hits).toHaveLength(ROUNDS);
        expect(new Set(out.hits).size).toBe(1);
        const control = measure(
            base({
                speed: 50,
                enemyAttackers: [
                    enemyAt('e-wusheng', 'M4', {
                        stats: {
                            attack: 1000,
                            crit: 0,
                            critDamage: 0,
                            defence: 0,
                            hp: 1e9,
                            speed: 200,
                            security: 0,
                        },
                        shipSkills: wusheng(),
                    }),
                ],
            }),
            'e-wusheng',
            'attacker'
        );
        expect(control.gains).toBe(0);
        expect(out.hits[0] / control.hits[0]).toBeCloseTo(0.75, 5);
    });
});

// ─── Status-engine level ─────────────────────────────────────────────────────────────────────

const timed = (
    buffName: string,
    duration: number,
    over: Partial<Extract<RegisteredAbilityStatus, { kind: 'timed' }>> = {}
): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
    payload: { buffName, stacks: 1, parsedEffects: {} },
    side: 'self',
    sourceSlot: 'active',
    conditions: [],
    kind: 'timed',
    duration,
    ...over,
});

const heldBy = (eng: ReturnType<typeof createStatusEngine>, id: string) =>
    eng.timedAbilityStatuses('self', id).map((s) => ({
        name: s.active.buffName,
        turns: s.active.turnsRemaining,
        caster: s.casterId,
    }));

describe('status engine: an equal-tier re-application', () => {
    it('own-turn 1-turn re-gain over a held copy whose reprieve is spent replaces it', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.beginTurn('w');
        eng.applyTimedAbilityStatus(1, timed('Crit Power Up II', 1), 'w');
        eng.decrementPlayer('w'); // reprieve spent, still 1 turn left
        eng.beginRound(2);
        eng.beginTurn('w');
        eng.applyTimedAbilityStatus(2, timed('Crit Power Up II', 1), 'w');
        eng.decrementPlayer('w'); // the fresh copy's reprieve
        expect(heldBy(eng, 'w').map((h) => h.name)).toEqual(['Crit Power Up II']);
    });

    it('a re-application of the same duration replaces the held copy (the newer caster holds it)', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timed('Attack Up II', 2, { casterId: 'a' }), 'x');
        eng.applyTimedAbilityStatus(1, timed('Attack Up II', 2, { casterId: 'b' }), 'x');
        expect(heldBy(eng, 'x')).toEqual([{ name: 'Attack Up II', turns: 2, caster: 'b' }]);
    });

    it('a shorter re-application never shortens the held copy', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timed('Attack Up II', 3, { casterId: 'a' }), 'x');
        eng.applyTimedAbilityStatus(1, timed('Attack Up II', 1, { casterId: 'b' }), 'x');
        expect(heldBy(eng, 'x')).toEqual([{ name: 'Attack Up II', turns: 3, caster: 'a' }]);
    });

    it('a lower tier never replaces a higher one, however long it lasts', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timed('Attack Up III', 1, { casterId: 'a' }), 'x');
        eng.applyTimedAbilityStatus(1, timed('Attack Up II', 5, { casterId: 'b' }), 'x');
        expect(heldBy(eng, 'x')).toEqual([{ name: 'Attack Up III', turns: 1, caster: 'a' }]);
    });

    it('enemy side: an equal-tier, equal-duration debuff re-land refreshes; a shorter one does not', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        const debuff = (duration: number, casterId: string) =>
            timed('Defense Down II', duration, { side: 'enemy', casterId });
        const held = () =>
            eng.timedAbilityStatuses('enemy', undefined, 'v').map((s) => ({
                turns: s.active.turnsRemaining,
                caster: s.casterId,
            }));
        eng.applyTimedAbilityStatus(1, debuff(2, 'a'), undefined, 'v');
        eng.applyTimedAbilityStatus(1, debuff(2, 'b'), undefined, 'v');
        expect(held()).toEqual([{ turns: 2, caster: 'b' }]);
        eng.applyTimedAbilityStatus(1, debuff(1, 'c'), undefined, 'v');
        expect(held()).toEqual([{ turns: 2, caster: 'b' }]);
    });
});
