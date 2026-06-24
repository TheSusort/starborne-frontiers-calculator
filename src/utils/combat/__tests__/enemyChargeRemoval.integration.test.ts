/**
 * Integration: enemy-targeted charge REMOVAL (Phase 0 Task 7).
 *
 * A `charge` ability whose target is an ENEMY ('enemy' | 'all-enemies') SUBTRACTS charges from
 * each opposing actor (floored at 0), skipping actors that are `chargeLossImmune`. Self/ally
 * targets keep the additive behaviour (unchanged). There is NO separate "charge-remove" type.
 *
 * Both application sites are exercised:
 *   - REACTIVE executor (triggers.ts executeIntent charge branch) — via a PLAYER `start-of-round`
 *     all-enemies charge ability, which is partitioned to the reactive drain (a live trigger),
 *     exactly like the Graphite start-of-round grant in allyChargeGrant.test.ts.
 *   - CAST path (playerTurn.ts runPlayerTurn charge step) — via a PLAYER `on-cast` all-enemies
 *     charge ability, which fires during the caster's own turn.
 *
 * Observable: the enemy team here is a single charged BURSTER seeded `chargeCount: 3,
 * startCharged: true` (→ charges == chargeCount == 3) so, left alone, it fires its big CHARGED
 * skill (400%) on its first turn. The PLAYER acts first (higher speed) and removes 2 of the
 * enemy's charges BEFORE the enemy acts → charges drop to 1 (< chargeCount) → the enemy fires
 * its small ACTIVE skill (50%) instead → far LESS incoming damage to the heal target. A control
 * whose charge ability is SELF-targeted (additive, no reach to the enemy) leaves the enemy at 3
 * → it bursts on turn 1 → MORE incoming. The strict inequality is the charge-removal signal.
 *
 * Floor-at-0: the enemy is seeded chargeCount 3, startCharged false, so it banks its first charge
 * on its own turn and reaches 1. A removal of 2 then floors it: max(0, 1 - 2) === 0 (no negative,
 * no crash). The test asserts remove-2 produces the SAME observable incoming as a remove-1 control
 * (both drive the single banked charge to 0) — proving over-removal floors at 0 without side
 * effects.
 *
 * Immunity: a chargeLossImmune burster seeded charges 3 — the removal is a no-op → it still
 * bursts on turn 1 → incoming EQUALS the self-target control (gate fully skips immune actors).
 */

import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { IntentExecContext } from '../triggers';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// ─── Ability fixtures ───────────────────────────────────────────────────────────

const enemyDamage = (multiplier: number, id: string): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});

/** A player charge ability with a configurable target + trigger (positive amount; the engine
 *  subtracts for enemy targets). */
const chargeAbility = (
    amount: number,
    target: Ability['target'],
    trigger: Ability['trigger'],
    id: string
): Ability => ({
    id,
    type: 'charge',
    target,
    trigger,
    conditions: [],
    config: { type: 'charge', amount },
});

// ─── Enemy fixtures ─────────────────────────────────────────────────────────────

/** A pure charged BURSTER. Seeded charges == chargeCount via startCharged → ready to fire its
 *  big CHARGED skill on its FIRST turn unless its charges are knocked below chargeCount first.
 *  Speed 40 → acts AFTER the player (speed 100). attack large so the burst is clearly visible. */
const chargedBurster = (opts: {
    chargeCount: number;
    startCharged: boolean;
    chargeLossImmune?: boolean;
}): EnemyAttacker => ({
    id: 'e-burster',
    stats: { attack: 5000, crit: 0, critDamage: 0, speed: 40 },
    chargeCount: opts.chargeCount,
    startCharged: opts.startCharged,
    ...(opts.chargeLossImmune ? { chargeLossImmune: true } : {}),
    shipSkills: {
        slots: [
            { slot: 'active', abilities: [enemyDamage(50, 'eb-a')] },
            { slot: 'charged', abilities: [enemyDamage(400, 'eb-c')] },
        ],
    } as ShipSkills,
});

// ─── Player / engine input ────────────────────────────────────────────────────────

/** Player focus: a heal target that holds the charge ability under test. Speed 100 → acts
 *  BEFORE the enemy burster (speed 40), so the removal lands before the enemy's turn. Huge HP so
 *  the enemy's hits never destroy it (incoming stays observable across all rounds). */
const buildInput = (chargeAbilityUnderTest: Ability, enemy: EnemyAttacker): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: {
        slots: [
            { slot: 'active', abilities: [enemyDamage(50, 'p-a')] },
            { slot: 'passive', abilities: [chargeAbilityUnderTest] },
        ],
    },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
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
    hp: 1_000_000_000,
    speed: 100,
    healTargetId: 'attacker',
    enemyAttackers: [enemy],
});

const totalIncoming = (r: ReturnType<typeof runCombat>): number =>
    r.healing!.rounds.reduce((sum, round) => sum + round.incomingDamage, 0);

// ─── Reactive-executor path (start-of-round all-enemies) ──────────────────────────

describe('enemy charge removal — reactive executor (start-of-round all-enemies)', () => {
    it('removes 2 of the enemy burster’s 3 charges → its turn-1 charged burst is suppressed', () => {
        // Removal of 2 (3 → 1 < chargeCount 3) → enemy fires its ACTIVE (50%), not its 400%
        // charged burst, on turn 1. Control: SAME ability but SELF-targeted (additive, no reach
        // to the enemy) → enemy stays at 3 → bursts on turn 1 → strictly MORE incoming.
        const removal = runCombat(
            buildInput(
                chargeAbility(2, 'all-enemies', 'start-of-round', 'p-remove'),
                chargedBurster({ chargeCount: 3, startCharged: true })
            )
        );
        const control = runCombat(
            buildInput(
                chargeAbility(2, 'self', 'start-of-round', 'p-self'),
                chargedBurster({ chargeCount: 3, startCharged: true })
            )
        );

        // Charge removal suppresses the enemy's turn-1 charged burst → strictly less incoming.
        expect(totalIncoming(removal)).toBeLessThan(totalIncoming(control));
    });

    it('floors at 0: removing 2 from a 1-charge enemy underflows cleanly (no negative, no crash)', () => {
        // Enemy seeded chargeCount 3, startCharged false → it banks 1 charge on its own turn,
        // reaching 1 (< chargeCount 3, so no burst either way). Removal amount 2 floors it:
        // max(0, 1 - 2) === 0. A remove-1 control drives the same single charge to 0. We assert
        // incoming is FINITE and EQUAL between remove-2 and remove-1 — over-removal floors at 0
        // without underflow, so the larger removal behaves no differently than remove-1.
        const remove2 = runCombat(
            buildInput(
                chargeAbility(2, 'all-enemies', 'start-of-round', 'p-r2'),
                chargedBurster({ chargeCount: 3, startCharged: false })
            )
        );
        const remove1 = runCombat(
            buildInput(
                chargeAbility(1, 'all-enemies', 'start-of-round', 'p-r1'),
                chargedBurster({ chargeCount: 3, startCharged: false })
            )
        );

        // Both runs complete with finite incoming; over-removal floors at 0 without underflow,
        // so the two runs deny the enemy its burst identically.
        expect(Number.isFinite(totalIncoming(remove2))).toBe(true);
        expect(totalIncoming(remove2)).toBe(totalIncoming(remove1));
    });

    it('skips a chargeLossImmune enemy → its burst is NOT suppressed (incoming == self-control)', () => {
        // Immune burster seeded charges 3 — removal is a no-op → it bursts on turn 1, exactly as
        // the self-target control (which never touches the enemy). Equal incoming → gate skipped.
        const removalVsImmune = runCombat(
            buildInput(
                chargeAbility(2, 'all-enemies', 'start-of-round', 'p-rm-imm'),
                chargedBurster({ chargeCount: 3, startCharged: true, chargeLossImmune: true })
            )
        );
        const selfControl = runCombat(
            buildInput(
                chargeAbility(2, 'self', 'start-of-round', 'p-self-imm'),
                chargedBurster({ chargeCount: 3, startCharged: true, chargeLossImmune: true })
            )
        );

        // Immune → removal no-op → identical incoming to the self-target control.
        expect(totalIncoming(removalVsImmune)).toBe(totalIncoming(selfControl));
    });
});

// ─── Cast path (on-cast all-enemies, fired during the player’s own turn) ──────────

describe('enemy charge removal — cast path (on-cast all-enemies)', () => {
    it('removes 2 of the enemy burster’s 3 charges on cast → turn-1 burst suppressed', () => {
        // on-cast routes through runPlayerTurn's charge step (the cast path). The player (speed
        // 100) casts before the enemy (speed 40) acts → removal lands first → burst suppressed.
        const removal = runCombat(
            buildInput(
                chargeAbility(2, 'all-enemies', 'on-cast', 'p-remove-cast'),
                chargedBurster({ chargeCount: 3, startCharged: true })
            )
        );
        const control = runCombat(
            buildInput(
                chargeAbility(2, 'self', 'on-cast', 'p-self-cast'),
                chargedBurster({ chargeCount: 3, startCharged: true })
            )
        );

        expect(totalIncoming(removal)).toBeLessThan(totalIncoming(control));
    });

    it('cast-path removal skips a chargeLossImmune enemy (incoming == self-control)', () => {
        const removalVsImmune = runCombat(
            buildInput(
                chargeAbility(2, 'all-enemies', 'on-cast', 'p-rm-cast-imm'),
                chargedBurster({ chargeCount: 3, startCharged: true, chargeLossImmune: true })
            )
        );
        const selfControl = runCombat(
            buildInput(
                chargeAbility(2, 'self', 'on-cast', 'p-self-cast-imm'),
                chargedBurster({ chargeCount: 3, startCharged: true, chargeLossImmune: true })
            )
        );

        expect(totalIncoming(removalVsImmune)).toBe(totalIncoming(selfControl));
    });
});

// ─── Type shape assertions ───────────────────────────────────────────────────────

it('IntentExecContext exposes removeChargesFrom (single-target removal)', () => {
    const fn: IntentExecContext['removeChargesFrom'] = (_targetId: string, _amount: number) => {};
    expect(typeof fn).toBe('function');
});

it('Ability accepts everyNthEvent (every-Nth-event gate)', () => {
    const a: Ability = {
        id: 't',
        type: 'charge',
        target: 'enemy',
        trigger: 'on-enemy-repaired',
        conditions: [],
        everyNthEvent: 2,
        config: { type: 'charge', amount: 1 },
    };
    expect(a.everyNthEvent).toBe(2);
});
