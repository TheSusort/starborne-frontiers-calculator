/**
 * PR5c Task 1 — characterization of heal-target `destroyedRound` + backstop reachability.
 *
 * GREEN against the CURRENT, UNMODIFIED engine. NO production code changes in this task.
 *
 * The healing engine reports when the heal target dies via `result.healing.destroyedRound`.
 * It is fed from two sources (engine.ts):
 *   1. The recordDestroyed path — when the heal target's HP reaches 0 inside `applyVictimDamage`
 *      (a direct enemy hit or a turn-start DoT tick), `recordDestroyed` stamps the actor's own
 *      `destroyedRound` field AND emits one `ship-destroyed`. The sink callback copies that into
 *      the local scalar.
 *   2. The post-round BACKSTOP (~3936): `if (destroyedRound === undefined && currentHp <= 0)`
 *      — sets ONLY the local scalar, with NO actor mutation and NO event emit.
 *
 * A future task (Task 2) will replace the scalar with reads of `healTarget.destroyedRound`.
 * This file LOCKS the current observable behavior AND determines whether the backstop is
 * reachable (can `currentHp <= 0` hold at round end WITHOUT recordDestroyed having stamped
 * `destroyedRound`?).
 *
 * OUTCOME B (reachable): a heal target seeded at `hp: 0` starts combat at `currentHp === 0`
 * (createActor seeds currentHp = stats.hp). It never takes damage, so `applyVictimDamage` /
 * recordDestroyed NEVER run for it — yet at round 1 end the backstop sees currentHp <= 0 and
 * sets destroyedRound = 1. The "Backstop reachability" block below locks this independent
 * backstop contribution, including the absence of any `ship-destroyed` for the focus actor.
 *
 * Manual (non-positional) healing fixture mirrors perActorIncoming.test.ts — all enemies are
 * MANUAL (no `position`) to stay on the single-target path.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { Ability } from '../../../types/abilities';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `dr${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** Manual flat enemy — NO `position` field (avoids the positional AoE path). */
const manualEnemy = (
    id: string,
    attack: number,
    speed = 50,
    extra: Partial<EnemyAttacker> = {}
): EnemyAttacker => ({
    id,
    stats: { attack, crit: 0, critDamage: 0, speed },
    chargeCount: 0,
    startCharged: false,
    ...extra,
});

const healBase = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    enemyDefense: 0,
    enemyHp: 10_000_000,
    numRounds: 3,
    selfBuffs: [],
    enemyDebuffs: [],
    debuffLandingChance: 1,
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 10_000,
    healTargetId: 'attacker',
    ...overrides,
});

const run = (input: CombatEngineInput) => {
    idCounter = 0;
    const bus = createEventBus();
    const result = runCombat({ ...input, bus });
    return result;
};

describe('PR5c Task 1 — heal-target destroyedRound characterization', () => {
    // ── Survival: never dies → destroyedRound is absent (undefined) ──
    it('target survives all rounds → destroyedRound is undefined (key absent)', () => {
        const result = run(
            healBase({
                numRounds: 3,
                hp: 1_000_000,
                healTargetId: 'attacker',
                enemyAttackers: [manualEnemy('weak', 1000)],
            })
        );
        expect(result.healing!.destroyedRound).toBeUndefined();
        expect('destroyedRound' in result.healing!).toBe(false);
    });

    // ── Direct-hit kill in round N → destroyedRound === N (recordDestroyed path) ──
    it('target dies from a direct hit in round 1 → destroyedRound === 1', () => {
        const result = run(
            healBase({
                numRounds: 3,
                hp: 1000,
                healTargetId: 'attacker',
                // Enemy hits for far more than the target's HP on its round-1 turn.
                enemyAttackers: [manualEnemy('bigHit', 1_000_000)],
            })
        );
        expect(result.healing!.destroyedRound).toBe(1);
    });

    // ── DoT-tick kill at turn-start in round N → destroyedRound === N (recordDestroyed path) ──
    // Mirrors healing.test.ts "lethal turn-start DoT tick" setup. dotEnemy (speed 50) seeds a
    // tier-100 inferno on round 1; the tank's round-2 turn-start tick (= 5000, exactly hp) is
    // lethal and routes through applyIncomingToTarget → applyVictimDamage → recordDestroyed.
    it('target dies from a turn-start DoT tick in round 2 → destroyedRound === 2', () => {
        const infernoDot = () =>
            ab({
                type: 'dot',
                target: 'enemy',
                config: { type: 'dot', dotType: 'inferno', tier: 100, stacks: 1, duration: 5 },
            });
        const result = run(
            healBase({
                numRounds: 3,
                hp: 5000, // R2 turn-start inferno tick (5000) is exactly lethal
                defence: 0,
                healTargetId: 'attacker',
                selfBuffs: [], // no Cheat Death
                enemyAttackers: [
                    manualEnemy('dotEnemy', 5000, 50, {
                        shipSkills: { slots: [{ slot: 'active', abilities: [infernoDot()] }] },
                    }),
                ],
            })
        );
        expect(result.healing!.destroyedRound).toBe(2);
    });

    // ── Sticky: once set, never advances. Kill in round 2 with numRounds 4 → stays 2. ──
    it('destroyedRound is sticky: dies round 2, runs 4 rounds → destroyedRound === 2', () => {
        const infernoDot = () =>
            ab({
                type: 'dot',
                target: 'enemy',
                config: { type: 'dot', dotType: 'inferno', tier: 100, stacks: 1, duration: 5 },
            });
        const result = run(
            healBase({
                numRounds: 4,
                hp: 5000,
                defence: 0,
                healTargetId: 'attacker',
                selfBuffs: [],
                enemyAttackers: [
                    manualEnemy('dotEnemy', 5000, 50, {
                        shipSkills: { slots: [{ slot: 'active', abilities: [infernoDot()] }] },
                    }),
                ],
            })
        );
        // Set at round 2 and never re-stamped to a later round despite rounds 3 and 4 elapsing.
        expect(result.healing!.destroyedRound).toBe(2);
    });

    // ── Non-vacuous spread: at least one defined, at least one undefined. ──
    it('non-vacuous: a kill yields a defined round, survival yields undefined', () => {
        const killed = run(
            healBase({ numRounds: 2, hp: 1, enemyAttackers: [manualEnemy('k', 1_000_000)] })
        ).healing!.destroyedRound;
        const survived = run(
            healBase({ numRounds: 2, hp: 1_000_000, enemyAttackers: [manualEnemy('w', 1)] })
        ).healing!.destroyedRound;
        expect(killed).toBeTypeOf('number');
        expect(survived).toBeUndefined();
    });
});

describe('PR5c Task 1 — backstop reachability probe (OUTCOME B: REACHABLE)', () => {
    // The only heal-target HP-zeroing path that does NOT also stamp destroyedRound is a target
    // that STARTS at 0 HP: createActor seeds currentHp = stats.hp, so hp:0 → currentHp:0 at
    // construction. With no incoming damage, applyVictimDamage / recordDestroyed never run for it.
    // The post-round backstop (currentHp <= 0 && destroyedRound === undefined) is therefore the
    // SOLE writer of destroyedRound here — it sets it to round 1.
    it('heal target seeded at hp:0 → backstop sets destroyedRound = 1 (no recordDestroyed)', () => {
        idCounter = 0;
        const bus = createEventBus();
        // Capture ship-destroyed events: recordDestroyed is the ONLY emitter. If the focus actor
        // appears here, recordDestroyed ran; its absence proves the backstop (scalar-only) fired.
        const shipDestroyed: { actorId: string; round: number }[] = [];
        bus.on('ship-destroyed', (e) => {
            shipDestroyed.push({ actorId: e.actorId, round: e.round });
        });

        const result = runCombat({
            ...healBase({ hp: 0, numRounds: 3, healTargetId: 'attacker' }),
            bus,
        });

        // The backstop reports the heal target as destroyed in round 1.
        expect(result.healing!.destroyedRound).toBe(1);

        // INDEPENDENCE PROOF: recordDestroyed never fired for the focus actor (no ship-destroyed
        // event for 'attacker'). Had recordDestroyed produced this value, an event would exist.
        expect(shipDestroyed.some((e) => e.actorId === 'attacker')).toBe(false);
    });

    // Contrast lock: when HP IS driven to 0 by an actual hit (recordDestroyed path), a
    // ship-destroyed event DOES fire for the focus actor — distinguishing it from the backstop.
    it('a real lethal hit emits ship-destroyed for the focus actor (recordDestroyed path)', () => {
        idCounter = 0;
        const bus = createEventBus();
        const shipDestroyed: { actorId: string; round: number }[] = [];
        bus.on('ship-destroyed', (e) => {
            shipDestroyed.push({ actorId: e.actorId, round: e.round });
        });

        const result = runCombat({
            ...healBase({
                hp: 1000,
                numRounds: 3,
                healTargetId: 'attacker',
                enemyAttackers: [manualEnemy('bigHit', 1_000_000)],
            }),
            bus,
        });

        expect(result.healing!.destroyedRound).toBe(1);
        expect(shipDestroyed.some((e) => e.actorId === 'attacker' && e.round === 1)).toBe(true);
    });
});
