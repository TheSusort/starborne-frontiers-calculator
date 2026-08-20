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
 * U5's destructible target was the singular `enemy` entity, and the engine gated that entirely on a
 * `dpsEnemyTarget = enemyAttackerInputs.length === 0` discriminator. An empty roster became a
 * validation error at the normalization boundary, so nothing could reach that branch any more, and
 * SP-4c-2d has since deleted both the discriminator and the actor:
 *   • with any roster at all the singular `enemy` was a vestigial immortal sink — it never emitted
 *     ship-destroyed, never terminated the run, and `enemyOutcome` described IT, so it read
 *     `survived: true / roundsToKill: undefined` no matter what died;
 *   • the "pressure source" (0-MAX-hp roster) trick that USED to keep other fixtures non-positional
 *     would not have helped here anyway — it kept the cast on the sink, but the sink is still
 *     immortal. SP-4c-2a has since retired the trick outright (`withTargetableHp` in
 *     normalizeRoster.ts floors every enemy attacker's max HP), so it is not even constructible.
 *
 * So U5's surface has MOVED rather than vanished, and this file follows it: every case below now
 * measures the REAL, POSITIONED enemy, whose max HP carries the pool `enemyHp` used to hold. Four
 * of the five properties transfer intact — real per-victim intake, natural HP decline,
 * ship-destroyed on the kill round, and no credit booked past the kill — with the pinned integers
 * unchanged (30000 credited over 3 rounds, 10000 intake per round, kill in round 3).
 *
 * TWO properties were `dpsEnemyTarget`-only and did NOT transfer. **SP-4c-2d deleted both**, along
 * with everything in this file that pinned them — recorded here so a reader does not go looking:
 *   • the early `break` that TERMINATED the run on the kill was gated on `dpsEnemyTarget`, so the
 *     run played out its full `numRounds` once a roster existed. A real positioned enemy's death
 *     now ends the run through SP-4c-1's side-wipe rule instead, which is why the first case below
 *     reads `toHaveLength(3)` again.
 *   • `result.enemyOutcome` read the singular `enemy`, i.e. the immortal sink, and is GONE from
 *     `runCombat`'s return shape. Its production successor is `simulateDPS`'s own `ship-destroyed`
 *     re-derivation, covered by `dpsSynthesizedEnemy` / `dpsMultiEnemyFinalHp` /
 *     `dpsRealEnemyReactions`. The `enemyOutcome` assertion that used to sit in the second case
 *     went with the field; the case's three real claims (ship-destroyed, kill round, intake) stay.
 *     The case that pinned "the ONLY input which made `enemyOutcome` meaningful now throws" went
 *     too — with the field deleted it had no subject, and `dummyReachability.test.ts`'s
 *     `REFUSES an empty roster outright` still pins the boundary contract itself.
 *
 * Also gone from this file: two assertions that the dummy id `'enemy'` never appears among
 * `ship-destroyed` actors. No actor carries that id at all now, so they could only pass vacuously;
 * `sentinelActorIdReservation.test.ts` fences the id structurally instead, in both directions.
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
    // it dies in round 3 — and since SP-4c-1 that kill WIPES the enemy side, so the match ends on
    // that turn and the run reports exactly 3 rounds. That RESTORES the `toHaveLength(3)` this
    // case originally pinned: it only became 6 when the terminating `break` went `dpsEnemyTarget`-
    // gated and therefore dead. The credit claim is unchanged either way — nothing is booked after
    // the kill, which is now true because there is nothing after the kill.
    it('per-victim credit covers ONLY the rounds up to the kill', () => {
        const result = run(dpsBase({ attack: 10000, numRounds: 6 }, 25_000));

        // 3 × 10000 — byte-identical to the `direct: 30000` / `cumulative: 30000` this case
        // pinned on the scalar channel before the roster became real (M3).
        expect(dealtBy(result.rounds, 'attacker')).toBe(30000);

        // …and it is booked in exactly the first three rounds — which are now ALL the rounds there
        // are, the match having ended on the killing turn.
        const creditedRounds = result.rounds.filter(
            (rd) => (rd.perTargetDealt?.attacker?.[BARE_ENEMY_ID] ?? 0) > 0
        );
        expect(creditedRounds.map((rd) => rd.round)).toEqual([1, 2, 3]);
        expect(result.rounds).toHaveLength(3);

        // The scalar totals are dead the moment a roster exists — the DIRECT-CAST credit skip
        // (`if (!positional) {` around `creditDamage(...)`) suppresses them on a positional cast —
        // so they are 0 across the board, pinned so a future regression that starts double-booking
        // through BOTH channels is caught here.
        //
        // ⚠️ CORRECTION (SP-4c-2d): an earlier note here predicted `rawTotals` would "go with the
        // dummy" and told a future rung to DELETE this assertion. That prediction was wrong.
        // `rawTotals` is the report's scalar damage summary and it survives the dummy's deletion
        // intact; what went is the dummy's own HP ledger and `enemyOutcome`. So this block stays —
        // but read it for what it is: an assertion that the scalar channel books NOTHING on a
        // positional run, not a pin on intended values. The live claim (per-victim booking) is the
        // `creditedRounds` assertion above it.
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
        // The same three claims the deleted `result.enemyOutcome` field made, read off the real
        // enemy instead of the immortal sink: it DID die (not survived), in round 3
        // (rounds-to-kill), and its intake covered its whole pool (0% HP left). These ARE the
        // property now — there is no scalar block left to compare them against (SP-4c-2d).
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
        // Positive control for the two negatives above: the run really did damage this enemy for
        // all 6 rounds, so "never destroyed" is a fact about survival and not about inertness.
        expect(dealtBy(result.rounds, 'attacker')).toBe(60000);
    });
});
