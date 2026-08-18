/**
 * SP-U U5 — characterization of the REAL, destructible DPS enemy.
 *
 * BEFORE U5 the DPS opponent was an indestructible damage-wall: its modeled HP could decline
 * past 0 (scalar sink) yet it kept taking damage forever, never emitted ship-destroyed, and the
 * run always ran the full `numRounds`. U5 made it a real actor: the round's dealt damage lands
 * through the shared per-victim `applyVictimDamage` funnel (surfacing in `perActorIncoming`), its
 * HP declines naturally, and the moment it crosses 0 it is `recordDestroyed` (ship-destroyed).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * SP-4b-2b — THIS FILE'S ORIGINAL SUBJECT WAS THE EMPTY-ROSTER SHAPE, WHICH IS NOW ILLEGAL.
 *
 * U5's destructible target was the singular `enemy` entity, and the engine gates that entirely on
 * `dpsEnemyTarget = enemyAttackerInputs.length === 0` (engine.ts:2475). An empty roster is now a
 * validation error at the normalization boundary, so NOTHING can reach that branch any more:
 *   • with any roster at all the singular `enemy` is a vestigial immortal sink — it never emits
 *     ship-destroyed, never terminates the run, and `enemyOutcome` describes IT, so it reads
 *     `survived: true / roundsToKill: undefined` no matter what dies;
 *   • the "pressure source" (0-MAX-hp roster) trick that keeps other fixtures non-positional does
 *     NOT help here — it keeps the cast on the sink, but the sink is still immortal.
 *
 * So U5's surface has MOVED rather than vanished, and this file follows it: every case below now
 * measures the REAL, POSITIONED enemy, whose max HP carries the pool `enemyHp` used to hold. Four
 * of the five properties transfer intact — real per-victim intake, natural HP decline,
 * ship-destroyed on the kill round, and no credit booked past the kill — with the pinned integers
 * unchanged (30000 credited over 3 rounds, 10000 intake per round, kill in round 3).
 *
 * TWO properties are `dpsEnemyTarget`-only and do NOT transfer. They are pinned as such below
 * rather than silently dropped:
 *   • the early `break` that TERMINATED the run on the kill (engine.ts:11115) is gated on
 *     `dpsEnemyTarget`, so the run now plays out its full `numRounds`. Past the kill the focus
 *     falls back onto the legacy dummy victim and books NO credit (engine.ts:5876 skips
 *     `creditDamage` whenever a roster exists), which is what the credit-window case asserts.
 *   • `result.enemyOutcome` reads the singular `enemy`, i.e. the immortal sink. Its production
 *     successor is `simulateDPS`'s own `ship-destroyed` re-derivation (dpsSimulator.ts:796),
 *     covered by `dpsSynthesizedEnemy` / `dpsMultiEnemyFinalHp` / `dpsRealEnemyReactions`. The
 *     last case here pins that the ONLY input which made `enemyOutcome` meaningful now throws.
 * (SP-4c deletes the dummy; both bullets go with it.)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import { bareEnemy, BARE_ENEMY_ID } from '../__testutils__/bareRosterFixture';
import { dealtBy } from '../__testutils__/perTargetDealt';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `idd${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

/** Plain 100% active damage skill — base turn damage == effective attack (defense 0). */
const activeDamageSkills = (): ShipSkills => {
    idCounter = 0;
    return {
        slots: [
            {
                slot: 'active',
                abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } })],
            },
        ],
    };
};

/** 100% active damage + an inferno DoT applied to the enemy on the active turn. */
const damagePlusInfernoSkills = (): ShipSkills => {
    idCounter = 0;
    return {
        slots: [
            {
                slot: 'active',
                abilities: [
                    ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                    ab({
                        type: 'dot',
                        target: 'enemy',
                        config: {
                            type: 'dot',
                            dotType: 'inferno',
                            tier: 100,
                            stacks: 1,
                            duration: 99,
                        },
                    }),
                ],
            },
        ],
    };
};

/** The real opponent carries the pool. `enemyHp` (the dummy scalar) is kept in step with it so
 *  the two never disagree, but it is INERT on a positional run (M6) — the roster entry's own
 *  `stats.hp` is what actually declines. */
const dpsBase = (
    overrides: Partial<CombatEngineInput> = {},
    enemyPool = 25_000
): CombatEngineInput => ({
    enemyAttackers: bareEnemy({ stats: { hp: enemyPool } }),
    attack: 10000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: activeDamageSkills(),
    enemyDefense: 0,
    enemyHp: 25_000,
    numRounds: 6,
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
    hp: 30_000,
    // NO healTargetId — DPS mode.
    ...overrides,
});

const run = (input: CombatEngineInput) => {
    idCounter = 0;
    const bus = createEventBus();
    return runCombat({ ...input, bus });
};

describe('SP-U U5 — the real positioned DPS enemy is destructible', () => {
    // attack 10000 × 100% → 10000 dmg/round vs a 25000 pool → the enemy's HP crosses 0 in R3, so
    // it dies in round 3. The run itself plays all 6 rounds (see the header: the terminating
    // `break` is `dpsEnemyTarget`-gated), but NO credit is booked after the kill.
    it('per-victim credit covers ONLY the rounds up to the kill', () => {
        const result = run(dpsBase({ attack: 10000, numRounds: 6 }, 25_000));

        // 3 × 10000 — byte-identical to the `direct: 30000` / `cumulative: 30000` this case
        // pinned on the scalar channel before the roster became real (M3).
        expect(dealtBy(result.rounds, 'attacker')).toBe(30000);

        // …and it is booked in exactly the first three rounds: rounds 4-6 credit nothing, which is
        // what the old `expect(result.rounds).toHaveLength(3)` was really observing.
        const creditedRounds = result.rounds.filter(
            (rd) => (rd.perTargetDealt?.attacker?.[BARE_ENEMY_ID] ?? 0) > 0
        );
        expect(creditedRounds.map((rd) => rd.round)).toEqual([1, 2, 3]);
        expect(result.rounds).toHaveLength(6);

        // The scalar totals are dead the moment a roster exists (engine.ts:5876 skips
        // `creditDamage`), so they are 0 across the board — pinned so a future regression that
        // starts double-booking through BOTH channels is caught here.
        expect(result.rawTotals).toEqual({
            direct: 0,
            corrosion: 0,
            inferno: 0,
            detonation: 0,
            cumulative: 0,
            totalSecondary: 0,
            totalConditional: 0,
            teamTotal: 0,
            generic: 0,
        });
    });

    it('reports the real enemy outcome (rounds-to-kill / not survived / 0% HP)', () => {
        // The same three claims the old `result.enemyOutcome` assertion made, read off the real
        // enemy instead of the immortal sink: it DID die (not survived), in round 3
        // (rounds-to-kill), and its intake covered its whole pool (0% HP left).
        idCounter = 0;
        const bus = createEventBus();
        const destroyed: { actorId: string; round: number }[] = [];
        bus.on('ship-destroyed', (e) => destroyed.push({ actorId: e.actorId, round: e.round }));
        const result = runCombat({
            ...dpsBase({ attack: 10000, numRounds: 6 }, 25_000),
            bus,
        });

        const kill = destroyed.filter((e) => e.actorId === BARE_ENEMY_ID);
        expect(kill).toHaveLength(1); // not survived
        expect(kill[0].round).toBe(3); // rounds-to-kill
        const intake = result.rounds.reduce(
            (sum, rd) => sum + (rd.perActorIncoming?.[BARE_ENEMY_ID]?.incoming ?? 0),
            0
        );
        expect(intake).toBeGreaterThanOrEqual(25_000); // pool exhausted → 0% HP

        // The scalar block now describes the vestigial sink, not this kill (see the header).
        expect(result.enemyOutcome).toEqual({
            survived: true,
            roundsToKill: undefined,
            finalHpPct: 100,
        });
    });

    it('surfaces the enemy per-round intake in perActorIncoming (per-victim basis)', () => {
        // A pool the focus cannot exhaust, so every one of the 6 rounds is a damage round and the
        // per-round intake is observable throughout — the property this case exists for.
        const result = run(dpsBase({ attack: 10000, numRounds: 6 }, 10_000_000));
        expect(result.rounds).toHaveLength(6);
        for (const rd of result.rounds) {
            expect(rd.perActorIncoming?.[BARE_ENEMY_ID]?.incoming).toBe(10000);
            expect(rd.perActorIncoming?.[BARE_ENEMY_ID]?.shieldAbsorbed).toBe(0);
            expect(rd.perActorIncoming?.[BARE_ENEMY_ID]?.barrierAbsorbed).toBe(0);
        }
    });

    it('emits exactly one ship-destroyed for the real enemy id on the kill round', () => {
        idCounter = 0;
        const bus = createEventBus();
        const shipDestroyed: { actorId: string; round: number }[] = [];
        bus.on('ship-destroyed', (e) => {
            shipDestroyed.push({ actorId: e.actorId, round: e.round });
        });
        runCombat({ ...dpsBase({ attack: 10000, numRounds: 6 }, 25_000), bus });
        // M1: the id moves from the vestigial sink `'enemy'` to the roster entry's own id.
        const enemyDeaths = shipDestroyed.filter((e) => e.actorId === BARE_ENEMY_ID);
        expect(enemyDeaths).toHaveLength(1);
        expect(enemyDeaths[0].round).toBe(3);
        // And the sink itself is never destroyed, whatever happens to the real roster.
        expect(shipDestroyed.filter((e) => e.actorId === 'enemy')).toHaveLength(0);
    });

    it('DoT damage also drives the kill; DoT ticks are counted up to the kill round', () => {
        // direct 10000 + inferno (tier 100 → 100% of attack = 10000)/round: the enemy dies fast.
        idCounter = 0;
        const bus = createEventBus();
        const destroyed: { actorId: string; round: number }[] = [];
        bus.on('ship-destroyed', (e) => destroyed.push({ actorId: e.actorId, round: e.round }));
        const result = runCombat({
            ...dpsBase(
                {
                    attack: 10000,
                    numRounds: 6,
                    shipSkills: damagePlusInfernoSkills(),
                },
                25_000
            ),
            bus,
        });
        const kill = destroyed.find((e) => e.actorId === BARE_ENEMY_ID);
        expect(kill).toBeDefined();
        // Strictly sooner than the direct-only kill in round 3 → the DoT really contributed.
        expect(kill!.round).toBeLessThan(3);
        expect(result.rawTotals.inferno).toBeGreaterThan(0);
    });

    it('an enemy that OUTLASTS the window is never destroyed (survived, HP% remaining)', () => {
        // Huge pool: 10000/round × 6 never crosses it → the enemy survives all 6 rounds.
        idCounter = 0;
        const bus = createEventBus();
        const shipDestroyed: string[] = [];
        bus.on('ship-destroyed', (e) => shipDestroyed.push(e.actorId));
        const result = runCombat({
            ...dpsBase({ attack: 10000, numRounds: 6 }, 10_000_000),
            bus,
        });
        expect(result.rounds).toHaveLength(6);
        expect(shipDestroyed).not.toContain(BARE_ENEMY_ID);
        expect(shipDestroyed).not.toContain('enemy');
        // Positive control for the two negatives above: the run really did damage this enemy for
        // all 6 rounds, so "never destroyed" is a fact about survival and not about inertness.
        expect(dealtBy(result.rounds, 'attacker')).toBe(60000);
    });

    // The shape U5 characterized — no roster at all, so the singular `enemy` IS the destructible
    // target — is a validation error since SP-4b-2b. Pinned here so the two properties that did
    // NOT transfer (the terminating break, and a meaningful `enemyOutcome`) are on record as
    // unreachable-by-contract rather than quietly untested.
    it('the empty-roster shape that made the singular `enemy` destructible now throws', () => {
        expect(() => run(dpsBase({ enemyAttackers: [] }))).toThrow(/enemyAttackers is empty/);
    });
});
