/**
 * Integration: repair-driven enemy charge REMOVAL (Phase 1, Zosimos-style).
 *
 * Zosimos's passive reacts to an ENEMY being REPAIRED (`on-enemy-repaired`, sourced from the
 * `heal-performed` event whose `casterId` is the repairing enemy). Two effects ride the trigger:
 *
 *   1. SELF charge GAIN every repair — a `{ type:'charge', target:'self' }` reactive ability
 *      (no `everyNthEvent`) → the owner banks +1 charge on EVERY enemy repair.
 *   2. ENEMY charge REMOVAL every SECOND repair — a `{ type:'charge', target:'enemy',
 *      everyNthEvent:2 }` reactive ability → the executor counts repairs per
 *      `${ownerId}:${abilityId}:${repairerId}` and, only on the 2nd (4th, …), removes one
 *      charge from THAT repairer (single-target via removeChargesFrom).
 *
 * The per-source counter is keyed by the REPAIRER id, so a second enemy that repairs only once
 * is on its own count (1, not the Nth) and is never drained — proving counter independence.
 *
 * Harness notes:
 *   - Zosimos is the player FOCUS (id 'attacker'). It is given chargeCount 10 (so the self-gain,
 *     which caps at chargeCount, has headroom) but `hasChargedSkill: false` so the focus's own
 *     cast-path charge cadence is a no-op — Zosimos's charges move ONLY via the reactive gain.
 *   - A "repairing enemy" has a SELF-heal on its active slot. recipientsFor('self') always
 *     returns the caster, so `heal-performed` (→ on-enemy-repaired) fires on EVERY one of its
 *     turns regardless of HP deficit. It carries a chargeCount (a valid removal target —
 *     removeChargesFrom skips chargeCount-0 actors) but NO charged-damage slot, so
 *     hasChargedSkill is false → it never re-banks its own charges → the seeded value minus the
 *     drains is exactly observable.
 *   - Charges are read DIRECTLY off the live actor roster via the engine's `__testTapActors`
 *     tap (the same objects the engine mutates in place).
 */

import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// ─── Ability fixtures ───────────────────────────────────────────────────────────

/** Zosimos's SELF charge gain — fires every enemy repair (no everyNthEvent gate). */
const selfGainOnRepair = (id: string): Ability => ({
    id,
    type: 'charge',
    target: 'self',
    trigger: 'on-enemy-repaired',
    conditions: [],
    config: { type: 'charge', amount: 1 },
});

/** Zosimos's ENEMY charge removal — single-target on the repairer, every 2nd repair. */
const removeFromRepairerEvery2nd = (id: string): Ability => ({
    id,
    type: 'charge',
    target: 'enemy',
    trigger: 'on-enemy-repaired',
    conditions: [],
    everyNthEvent: 2,
    config: { type: 'charge', amount: 1 },
});

// ─── Repairing enemy fixture ──────────────────────────────────────────────────────

/** An enemy that SELF-heals every turn (→ heal-performed every turn → an enemy repair). Carries
 *  a chargeCount so it is a valid removal target, but NO charged-damage slot → hasChargedSkill
 *  false → it never re-banks its own charges (the seeded value is stable barring removals). */
const repairingEnemy = (
    id: string,
    opts: { chargeCount: number; speed: number; affinity?: EnemyAttacker['affinity'] }
): EnemyAttacker => ({
    id,
    affinity: opts.affinity,
    stats: { attack: 1, crit: 0, critDamage: 0, hp: 1_000_000, speed: opts.speed },
    chargeCount: opts.chargeCount,
    startCharged: true, // seed charges == chargeCount
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: `${id}-self-heal`,
                        type: 'heal',
                        target: 'self',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'heal', pct: 10, basis: 'target-hp' },
                    },
                ],
            },
        ],
    } as ShipSkills,
});

// ─── Engine input (Zosimos = focus) ─────────────────────────────────────────────────

const buildZosimosInput = (
    enemies: EnemyAttacker[],
    numRounds: number,
    applierAffinity?: CombatEngineInput['affinity']
): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    // Applier (Zosimos) affinity — drives the charge-manipulation affinity gate on the
    // single-target removeChargesFrom path. Undefined → antimatter/neutral → gate never skips
    // (every existing case in this file omits it → byte-identical).
    affinity: applierAffinity,
    // Zosimos needs chargeCount > 0 for the self-gain (it caps at chargeCount). 10 = headroom.
    chargeCount: 10,
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'zos-hit',
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 10 },
                    },
                ],
            },
            {
                slot: 'passive',
                abilities: [selfGainOnRepair('zos-gain'), removeFromRepairerEvery2nd('zos-drain')],
            },
        ],
    },
    numRounds,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    // false → the focus's own cast-path charge cadence is a no-op; Zosimos's charges move ONLY
    // via the reactive self-gain (chargeCount 10 still enables the gain branch).
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1_000_000_000,
    speed: 200, // Zosimos fast (acts before the enemies); irrelevant to the listener.
    healTargetId: 'attacker',
    mode: 'healing',
    enemyAttackers: enemies,
});

// ─── Direct-charge tap ──────────────────────────────────────────────────────────

const runAndTap = (input: CombatEngineInput): CombatActor[] => {
    let captured: CombatActor[] = [];
    runCombat({ ...input, __testTapActors: (actors) => (captured = actors) });
    return captured;
};
const chargesOf = (actors: CombatActor[], id: string): number => {
    const a = actors.find((x) => x.id === id);
    if (!a) throw new Error(`no actor '${id}' in tapped roster`);
    return a.charges;
};

// ─── Case 5 ───────────────────────────────────────────────────────────────────────

describe('repair-driven enemy charge removal — every-2nd-repair (Zosimos-style)', () => {
    it('after the enemy’s 1st repair: that enemy unchanged (counter 1), Zosimos +1', () => {
        // numRounds 1 → the enemy acts (self-heals) once = its 1st repair. Counter for
        // (zos-drain, repairer) = 1 → 1 % 2 !== 0 → NO removal. The self-gain (no gate) fires →
        // Zosimos +1.
        const enemy = repairingEnemy('e-repairer', { chargeCount: 4, speed: 40 });
        const actors = runAndTap(buildZosimosInput([enemy], 1));

        expect(chargesOf(actors, 'e-repairer')).toBe(4); // unchanged (1st repair → no drain)
        expect(chargesOf(actors, 'attacker')).toBe(1); // self-gain fired once
    });

    it('after the enemy’s 2nd repair: that enemy −1 (counter 2 → fires), Zosimos +2', () => {
        // numRounds 2 → the enemy self-heals twice = repairs 1 and 2. Counter reaches 2 on the
        // 2nd → 2 % 2 === 0 → removeChargesFrom(repairer, 1): 4 → 3 (single-target). The self-gain
        // fires on BOTH repairs → Zosimos +2.
        const enemy = repairingEnemy('e-repairer', { chargeCount: 4, speed: 40 });
        const actors = runAndTap(buildZosimosInput([enemy], 2));

        expect(chargesOf(actors, 'e-repairer')).toBe(3); // 2nd repair → one charge drained
        expect(chargesOf(actors, 'attacker')).toBe(2); // self-gain fired on both repairs
    });

    it('a SECOND enemy that repairs ONCE is NOT drained (per-source counter is independent)', () => {
        // SAME run, two repairing enemies. Enemy A self-heals BOTH rounds → repairs 1 and 2 →
        // drained on its 2nd (4 → 3). Enemy B self-heals ONLY on round 2 (round 1 it fires its
        // CHARGED damage skill — a non-heal turn) → it repairs exactly ONCE → B's own counter is
        // 1 (not the Nth) → B is NOT drained. Because the executor keys the counter by REPAIRER
        // id (`${owner}:${ability}:${repairerId}`), A's two repairs never advance B's count.
        const enemyA = repairingEnemy('e-rep-a', { chargeCount: 4, speed: 60 });
        // Enemy B: chargeCount 1 + startCharged + a charged-DAMAGE slot → round 1 it fires the
        // charged skill (charges 1 ≥ chargeCount 1, hasChargedSkill true) and banks to 0; round 2
        // (charges 0 < 1) it falls to the ACTIVE self-heal = its ONE repair, and banks back to 1.
        const enemyB: EnemyAttacker = {
            id: 'e-rep-b',
            stats: { attack: 1, crit: 0, critDamage: 0, hp: 1_000_000, speed: 30 },
            chargeCount: 1,
            startCharged: true, // charges 1 → fires charged on round 1
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'e-rep-b-self-heal',
                                type: 'heal',
                                target: 'self',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'heal', pct: 10, basis: 'target-hp' },
                            },
                        ],
                    },
                    {
                        slot: 'charged',
                        abilities: [
                            {
                                id: 'e-rep-b-burst',
                                type: 'damage',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'damage', multiplier: 50 },
                            },
                        ],
                    },
                ],
            } as ShipSkills,
        };

        const actors = runAndTap(buildZosimosInput([enemyA, enemyB], 2));

        // A repaired twice → drained once on its 2nd repair: 4 → 3. This is the wrong-key guard:
        // proves the every-2nd-repair gate DOES drain when the same repairer hits the count.
        expect(chargesOf(actors, 'e-rep-a')).toBe(3);
        // B repaired ONCE (round 2 only) → B's own counter is 1, never the Nth → B NOT drained.
        // B's value is pure charged-cadence arithmetic, untouched by any removal:
        //   round 1: charges 1 ≥ chargeCount 1 → fires charged burst, banks down to 0
        //   round 2: charges 0 < 1 → falls to the ACTIVE self-heal (its one repair), banks to 1
        // So B ends at 1. Crucially this 1 is reached WITHOUT any drain: A's two repairs advance
        // A's counter, NOT B's, because the executor keys the counter per-repairer
        // (`${owner}:${ability}:${repairerId}`). Direct assertion (no reference run) — B is
        // untouched by A's drain.
        expect(chargesOf(actors, 'e-rep-b')).toBe(1);
    });

    // ─── Single-target affinity gate (removeChargesFrom) ─────────────────────────────
    // Charge Manipulation does not affect enemies with affinity advantage over the applier
    // (buffs.ts). The all-enemies path is covered in chargeRemovalAffinityGate.integration.test;
    // this pins the SINGLE-TARGET removeChargesFrom path (Zosimos "that enemy" drain).
    it('every-2nd-repair drain SKIPS a repairer with affinity advantage over the applier', () => {
        // Applier (Zosimos) THERMAL; repairer ELECTRIC (electric beats thermal → applier
        // disadvantaged → getAffinityMatchup(thermal, electric) === 'disadvantage' → SKIP). Same
        // 2-round, every-2nd-repair setup as the −1 case above, so absent the gate the electric
        // enemy WOULD be drained 4 → 3. With the gate it keeps all 4.
        const electric = repairingEnemy('e-electric', {
            chargeCount: 4,
            speed: 40,
            affinity: 'electric',
        });
        const actors = runAndTap(buildZosimosInput([electric], 2, 'thermal'));

        expect(chargesOf(actors, 'e-electric')).toBe(4); // gated → not drained
        expect(chargesOf(actors, 'attacker')).toBe(2); // self-gain (ally grant) is NOT gated
    });

    it('every-2nd-repair drain still removes from a repairer the applier is advantaged over', () => {
        // Control: applier THERMAL, repairer CHEMICAL (thermal beats chemical → advantage, NOT
        // disadvantage) → the gate does NOT skip → drained 4 → 3 exactly as the neutral case.
        const chemical = repairingEnemy('e-chemical', {
            chargeCount: 4,
            speed: 40,
            affinity: 'chemical',
        });
        const actors = runAndTap(buildZosimosInput([chemical], 2, 'thermal'));

        expect(chargesOf(actors, 'e-chemical')).toBe(3); // not gated → drained on the 2nd repair
        expect(chargesOf(actors, 'attacker')).toBe(2);
    });
});
