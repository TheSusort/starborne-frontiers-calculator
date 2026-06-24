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
    opts: { chargeCount: number; speed: number }
): EnemyAttacker => ({
    id,
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

const buildZosimosInput = (enemies: EnemyAttacker[], numRounds: number): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
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
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
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
        // (charges 0 < 1) it falls to the ACTIVE self-heal = its ONE repair. Seeded charges read
        // back via the tap reflect the cadence (1 → 0 after the round-1 burst), so we assert B is
        // NOT drained by checking it never dips BELOW its post-burst cadence value.
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

        // A repaired twice → drained once on its 2nd repair: 4 → 3.
        expect(chargesOf(actors, 'e-rep-a')).toBe(3);
        // B repaired ONCE (round 2 only) → B's own counter is 1, never the Nth → B NOT drained.
        // B's charges reflect ONLY its own charged-cadence (round 1 burst: 1 → 0; round 2 active
        // heal, no re-bank since charges 0 < chargeCount 1 → banks to 1). Crucially: NO removal
        // ever subtracted from B — its value is pure cadence, never floored by a drain.
        // The independence signal: B is NOT at a drained value (which from its cadence path it
        // could never reach below 0 anyway) — we assert it equals its undrained cadence outcome.
        const bUndrainedCadence = runAndTap(buildZosimosInput([enemyB], 2)); // B alone, no A repairs
        expect(chargesOf(actors, 'e-rep-b')).toBe(chargesOf(bUndrainedCadence, 'e-rep-b'));
    });
});
