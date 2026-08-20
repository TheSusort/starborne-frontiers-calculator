/**
 * Integration: an enemy whose CHARGED slot is pure support banks charges and casts it.
 *
 * `hasChargedSkill` gates the whole charge cadence (`advanceChargeCadence`, state.ts:401 —
 * no-op when the flag is false). It is derived on THREE actor paths — player focus, walked
 * 'team' and enemy — and the enemy path used to ask a different question than the other two:
 * where the player paths accept ANY ability in the charged slot, the enemy path additionally
 * required a DAMAGE ability with `multiplier > 0`.
 *
 * That predicate was carried over verbatim from the pre-kit `EnemyAttackerRuntime` ("mirrors
 * EnemyAttackerRuntime logic exactly", f82d6e19), back when enemies were damage-only actors and
 * "has a charged damage ability" was a fair proxy for "has a charged skill". Enemies later
 * gained full ship kits; the predicate was never revisited. The consequence was that every enemy
 * whose charged skill is pure support — heal, shield, buff, cleanse — never banked a single
 * charge and could never fire it. On today's 147-ship corpus that is 25 ships, essentially the
 * entire healer/support roster (Aegis, Chimei, Faust, Mender, Purifier, Salvation, Shelter, …).
 * All three paths now share one `hasUsableChargedSkill`.
 *
 * The suite covers both halves of the cadence, because banking alone is not the user-visible
 * behaviour — a ship that banks charges it can never spend is still broken:
 *   - BANKING: `chargeCount` above the round count, so the threshold is never reached and the
 *     counter never resets. The banked total is exactly the number of turns taken.
 *   - EXECUTION: `chargeCount` below the round count, so the enemy reaches the threshold
 *     mid-battle and casts. Asserted on the support effect actually landing (HP restored), not
 *     merely on the counter resetting.
 *
 * Harness notes:
 *   - State is read off the live actor roster via `__testTapActors` (the same objects the engine
 *     mutates in place), not inferred from the log.
 *   - The focus is a plain damage attacker with `hasChargedSkill: false`; it takes no part in the
 *     enemy's cadence and its own is a deliberate no-op. It is faster than the enemy, so within a
 *     round the focus always strikes before the enemy acts.
 */

import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** Rounds the enemy acts for. */
const ROUNDS = 3;
/** Banking-case threshold: above ROUNDS, so the charged skill never fires and nothing resets the
 *  counter mid-battle — the banked count stays monotonic and equals the turns taken. */
const ENEMY_CHARGE_COUNT = 5;
/** Execution-case threshold. The engine tests `charges >= chargeCount` at the START of a turn,
 *  before that turn banks, so a threshold of 2 is reached at the end of turn 2 and the charged
 *  skill fires on turn 3 — the last of ROUNDS — consuming the whole bank. */
const FIRING_CHARGE_COUNT = 2;
/** Enemy max HP for the execution case; the self-shield is a percentage of it. */
const FIRING_ENEMY_HP = 1000;
/** `chargedSelfShield` grants 20% of max HP. */
const EXPECTED_SHIELD = FIRING_ENEMY_HP * 0.2;

// ─── Charged-slot ability fixtures ──────────────────────────────────────────────

/** A pure-support charged payload: heals the caster. No damage ability anywhere in the slot. */
const chargedSelfHeal = (id: string): Ability => ({
    id,
    type: 'heal',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal', pct: 10, basis: 'target-hp' },
});

/** A pure-support charged payload whose effect is directly observable on the acting enemy: a
 *  self-shield banks an absorption pool, which needs no incoming damage to be visible. */
const chargedSelfShield = (id: string): Ability => ({
    id,
    type: 'shield',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'shield', pct: 20, basis: 'target-hp' },
});

/** The control payload: an ordinary charged damage ability (multiplier > 0). */
const chargedStrike = (id: string): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 20 },
});

// ─── Enemy fixture ──────────────────────────────────────────────────────────────

/**
 * An enemy with an ordinary damage active and a caller-supplied CHARGED slot. Everything except
 * the charged slot's ability type is held constant between the two cases, so a behavioural
 * difference isolates that one variable.
 */
const enemyWithChargedSlot = (
    id: string,
    chargedAbility: Ability,
    opts: { chargeCount?: number; hp?: number } = {}
): EnemyAttacker => ({
    id,
    stats: { attack: 100, crit: 0, critDamage: 0, hp: opts.hp ?? 1_000_000, speed: 100 },
    chargeCount: opts.chargeCount ?? ENEMY_CHARGE_COUNT,
    startCharged: false, // bank from zero — the whole point of the measurement
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: `${id}-active-hit`,
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 5 },
                    },
                ],
            },
            { slot: 'charged', abilities: [chargedAbility] },
        ],
    } as ShipSkills,
});

// ─── Engine input ───────────────────────────────────────────────────────────────

/** A plain damage focus. `hasChargedSkill: false` — its own cadence is a deliberate no-op, so
 *  the only charge movement in the battle belongs to the enemy under test. */
const buildInput = (enemy: EnemyAttacker): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'focus-hit',
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 10 },
                    },
                ],
            },
        ],
    },
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
    hp: 1_000_000_000,
    speed: 200, // focus acts first; irrelevant to the enemy's own cadence
    healTargetId: 'attacker',
    mode: 'healing',
    enemyAttackers: [enemy],
});

const enemyAfterBattle = (enemy: EnemyAttacker): CombatActor => {
    let captured: CombatActor[] = [];
    runCombat({ ...buildInput(enemy), __testTapActors: (actors) => (captured = actors) });
    const actor = captured.find((a) => a.id === enemy.id);
    if (!actor) throw new Error(`no actor '${enemy.id}' in tapped roster`);
    return actor;
};

const chargesAfterBattle = (enemy: EnemyAttacker): number => enemyAfterBattle(enemy).charges;

// ─── Cases ──────────────────────────────────────────────────────────────────────

describe('enemy charge cadence — banking', () => {
    it('an enemy with a charged DAMAGE skill banks one charge per turn (control)', () => {
        // Establishes that the harness observes charge banking at all: same board, same rounds,
        // same chargeCount — only the charged slot's ability type differs from the case below.
        const charges = chargesAfterBattle(
            enemyWithChargedSlot('e-striker', chargedStrike('e-striker-charged'))
        );

        expect(charges).toBe(ROUNDS);
    });

    it('an enemy whose charged skill is pure SUPPORT banks charges too', () => {
        // The regression: `hasChargedSkill` used to be false for this enemy because its charged
        // slot carries no damage ability, so `advanceChargeCadence` no-opped every turn and it
        // banked nothing at all. The identical kit on the player side always banked ROUNDS.
        const charges = chargesAfterBattle(
            enemyWithChargedSlot('e-healer', chargedSelfHeal('e-healer-charged'))
        );

        expect(charges).toBe(ROUNDS);
    });
});

describe('enemy charge cadence — execution', () => {
    it('a SUPPORT charged skill fires on reaching the threshold and its shield lands', () => {
        // Banking is only half the behaviour: charges that can never be spent are still a broken
        // ship. A self-shield is the observable — it banks an absorption pool on the caster with
        // no incoming damage required, unlike a self-heal, which is a no-op at full HP (the focus
        // binds to the legacy dummy in this mode, so the enemy actor is never damaged).
        const firing = enemyAfterBattle(
            enemyWithChargedSlot('e-support', chargedSelfShield('e-support-charged'), {
                chargeCount: FIRING_CHARGE_COUNT,
                hp: FIRING_ENEMY_HP,
            })
        );
        // Same enemy, threshold out of reach within ROUNDS → never casts → no shield.
        const neverFires = enemyAfterBattle(
            enemyWithChargedSlot('e-support', chargedSelfShield('e-support-charged'), {
                chargeCount: ENEMY_CHARGE_COUNT,
                hp: FIRING_ENEMY_HP,
            })
        );

        expect(neverFires.shieldPool).toBe(0);
        expect(firing.shieldPool).toBe(EXPECTED_SHIELD);
        // Consumed by the cast rather than parked at the cap: the bank hits 2 at the end of turn
        // 2, turn 3 opens above the threshold and spends it, and no turn remains to re-bank.
        expect(firing.charges).toBe(0);
        expect(neverFires.charges).toBe(ROUNDS);
    });
});
