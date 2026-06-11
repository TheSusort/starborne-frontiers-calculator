/**
 * Barrier — full damage immunity (Task 1).
 *
 * "Barrier" = FULL DAMAGE IMMUNITY for the duration of the buff. While a ship carries
 * an active Barrier status, ALL incoming damage to it is blocked — direct attacks, DoT
 * ticks, AND bomb detonations. It is duration-based (expires via the normal timed
 * lifecycle), NOT consumed on first hit. It is strictly "in front of" both the shield
 * pool AND Cheat Death: a lethal-sized hit fully blocked by Barrier does NOT trigger
 * Cheat Death.
 *
 * Harness mirrors the healing-mode runCombat fixtures in hpCrossing.test.ts: a focus
 * attacker that IS the heal target (does no damage), ship-/manual-backed enemy
 * attackers, and the heal target carrying an always-active no-payload self-buff
 * (`buffName:'Barrier'`) — the same shape as the Cheat-Death self-buff there, which
 * `selfBuffNamesForOwners` reports as active for the whole scenario.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability } from '../../../types/abilities';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `br${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** A manual flat enemy: one synthesized basic attack, no skills. */
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

/** A no-payload, always-active Barrier self-buff (surfaces in the snapshot as recurring,
 *  the same shape the Cheat-Death tests use — active for the whole scenario). */
const barrierBuff = () => ({
    id: 'barrier',
    buffName: 'Barrier',
    stacks: 1,
    isStackable: false,
    parsedEffects: {},
});

/** A no-payload, always-active Cheat Death self-buff. */
const cheatDeathBuff = () => ({
    id: 'cheat-death',
    buffName: 'Cheat Death',
    stacks: 1,
    isStackable: false,
    parsedEffects: {},
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
    numRounds: 2,
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
    const cheated: Extract<CombatEvent, { type: 'cheat-death-activated' }>[] = [];
    bus.on('cheat-death-activated', (e) => cheated.push(e));
    const result = runCombat({ ...input, bus });
    return { cheated, result };
};

describe('Barrier — full damage immunity (Task 1)', () => {
    // ── Direct attack while barriered → HP unchanged; barrierAbsorbed == damage; shield untouched ──
    it('blocks a direct attack: HP unchanged, barrierAbsorbed == attack damage, shieldPool untouched', () => {
        const { result } = run(
            healBase({
                numRounds: 2,
                hp: 10_000,
                selfBuffs: [barrierBuff()],
                enemyAttackers: [manualEnemy('atk1', 3000)],
            })
        );

        const rounds = result.healing!.rounds;
        // targetHpPctStart is a PRE-hit snapshot, so round 0's 100% proves nothing on its own.
        // The POST-hit signal is round 2's start HP: Barrier is active both rounds, so if the
        // round-1 hit had drained HP, round 2 would start below 100%. It starts at 100% →
        // the round-1 hit was fully blocked.
        expect(rounds[1].targetHpPctStart).toBeCloseTo(100, 6);
        expect(result.healing!.destroyedRound).toBeUndefined();
        // The blocked total is tracked separately as barrierAbsorbed (NOT shieldAbsorbed).
        expect(rounds[0].barrierAbsorbed).toBe(3000);
        expect(rounds[1].barrierAbsorbed).toBe(3000);
        // Shield pool untouched (no shield ability → 0, and barrier did NOT drain it).
        expect(rounds[0].shieldAbsorbed).toBe(0);
        // Blocked damage still "arrives": it counts toward incomingDamage even though its
        // effect is nullified (mirrors the control test's incomingDamage assertion).
        expect(rounds[0].incomingDamage).toBe(3000);
    });

    // ── DoT batch (Corrosion) while barriered → HP unchanged (DoT fully blocked) ──
    // The corrosion ticks at the tank's turn start in round 2; round 3's targetHpPctStart
    // observes the post-tick HP. With Barrier it is fully blocked → still 100% at round 3.
    // Non-vacuous: round 2's incomingDamage > 0 proves the tick damage actually arrived.
    it('blocks a DoT batch (Corrosion): tick arrives but HP unchanged (round-3 start still 100%)', () => {
        const corrosionDot = () =>
            ab({
                type: 'dot',
                target: 'enemy',
                config: { type: 'dot', dotType: 'corrosion', tier: 7, stacks: 10, duration: 5 },
            });
        // attack 0 → the ONLY incoming damage is the corrosion tick (isolates the DoT from the
        // enemy's basic attack, so incomingDamage > 0 below is sourced solely from the tick).
        const dotEnemy = manualEnemy('dotEnemy', 0, 50, {
            shipSkills: { slots: [{ slot: 'active', abilities: [corrosionDot()] }] },
        });

        const { result } = run(
            healBase({
                numRounds: 3,
                hp: 1000,
                selfBuffs: [barrierBuff()],
                enemyAttackers: [dotEnemy],
            })
        );

        const rounds = result.healing!.rounds;
        // The DoT tick damage arrived this run (non-vacuous: it was incoming damage)…
        expect(rounds.some((rd) => rd.incomingDamage > 0)).toBe(true);
        // …but Barrier fully blocked it → HP at the start of round 3 is still 100%.
        expect(rounds[2].targetHpPctStart).toBeCloseTo(100, 6);
        expect(result.healing!.destroyedRound).toBeUndefined();
    });

    // ── Bomb detonation while barriered → HP unchanged ──
    // The enemy applies a bomb (countdown 2) AND carries a detonate-dot:bomb so the
    // applied bomb bursts on a later enemy turn — its detonation damage funnels into
    // enemyTurn.detonationDamage → applyIncomingToTarget. Barrier fully blocks it.
    it('blocks a bomb detonation: detonation arrives but HP unchanged (last round still 100%)', () => {
        const bombDot = () =>
            ab({
                type: 'dot',
                target: 'enemy',
                config: { type: 'dot', dotType: 'bomb', tier: 7, stacks: 10, duration: 2 },
            });
        const detonate = () =>
            ab({
                type: 'detonate-dot',
                target: 'enemy',
                config: { type: 'detonate-dot', dotType: 'bomb', powerPct: 100 },
            });
        // NOTE: a ship-backed enemy whose active skill is the bomb-apply + detonate kit deals NO
        // basic-attack direct damage into the heal target — the only incoming stream is the bomb
        // detonation (verified: incomingDamage is [0, 700, 700, 700] = the bomb burst alone, the
        // basic attack contributes nothing). Bomb burst scales with the APPLIER's effective attack
        // (playerTurn.ts: damagePerStack = effectiveAttack * tier/100), so 10 stacks × (1000 × 7/100)
        // × 100% = 700 per detonation. The basic `attack` value is therefore irrelevant to intake
        // except as the bomb's damagePerStack scalar — it must stay non-zero or the bomb deals 0.
        // The test pins the EXACT bomb total below, so it cannot pass on basic-attack blocking.
        const attack = 1000;
        const bombDamagePerRound = 10 /* stacks */ * (attack * (7 / 100)); /* tier 7 */ // = 700
        const bombEnemy = manualEnemy('bombEnemy', attack, 50, {
            shipSkills: { slots: [{ slot: 'active', abilities: [bombDot(), detonate()] }] },
        });

        const { result } = run(
            healBase({
                numRounds: 4,
                hp: 10_000,
                selfBuffs: [barrierBuff()],
                enemyAttackers: [bombEnemy],
            })
        );

        const rounds = result.healing!.rounds;
        // NON-VACUOUS + ISOLATED: the bomb detonation actually arrives as incoming damage, and the
        // incoming total equals the EXACT bomb burst (700/round, rounds 2-4) — not a basic attack.
        // This proves the assertion is exercising the bomb path, not basic-attack blocking.
        const detonationRounds = rounds.filter((rd) => rd.incomingDamage > 0);
        expect(detonationRounds.length).toBeGreaterThan(0);
        expect(detonationRounds.every((rd) => rd.incomingDamage === bombDamagePerRound)).toBe(true);
        // …but Barrier fully blocked each detonation (barrierAbsorbed === the exact bomb total)…
        expect(detonationRounds.every((rd) => rd.barrierAbsorbed === bombDamagePerRound)).toBe(
            true
        );
        // …so HP at the start of the last round is still 100%.
        expect(rounds[rounds.length - 1].targetHpPctStart).toBeCloseTo(100, 6);
        expect(result.healing!.destroyedRound).toBeUndefined();
    });

    // ── Otherwise-lethal hit while barriered → HP unchanged AND NO cheat-death-activated ──
    it('a lethal hit blocked by Barrier does NOT trigger Cheat Death (Barrier is in front of it)', () => {
        const { result, cheated } = run(
            healBase({
                numRounds: 2,
                hp: 2000, // enemy hits for 3000 → lethal sized
                selfBuffs: [barrierBuff(), cheatDeathBuff()],
                enemyAttackers: [manualEnemy('atk1', 3000)],
            })
        );

        const rounds = result.healing!.rounds;
        // POST-hit signal: round 2's start HP is 100% → the would-be-lethal round-1 hit drained
        // NO HP (Barrier is active both rounds and blocked it fully).
        expect(rounds[1].targetHpPctStart).toBeCloseTo(100, 6);
        expect(result.healing!.destroyedRound).toBeUndefined();
        // Cheat Death was NOT consumed: Barrier is strictly in front of it.
        expect(cheated).toHaveLength(0);
    });

    // ── Control: identical run WITHOUT Barrier → HP drains (proves the guard is load-bearing) ──
    it('control (no Barrier): the same direct attack drains HP normally', () => {
        const { result } = run(
            healBase({
                numRounds: 2,
                hp: 10_000,
                selfBuffs: [], // NO Barrier
                enemyAttackers: [manualEnemy('atk1', 3000)],
            })
        );

        const rounds = result.healing!.rounds;
        // 3000 of 10000 max HP landed → barrierAbsorbed 0, incoming damage drained HP.
        expect(rounds[0].barrierAbsorbed).toBe(0);
        expect(rounds[0].incomingDamage).toBe(3000);
        expect(rounds[0].shieldAbsorbed).toBe(0);
        // POST-hit signal: with NO Barrier the round-1 hit actually drains HP, so round 2 starts
        // at (10000 - 3000) / 10000 = 70%. This is what genuinely proves HP dropped (contrast the
        // barriered test where round-2 start stays 100%).
        expect(rounds[1].targetHpPctStart).toBeCloseTo(70, 6);
    });

    // ── Shield precedence: Barrier sits IN FRONT of the shield pool (never drains it) ──
    // The heal target carries BOTH a 25%-of-hp self shield (2500 pool) AND Barrier. A barriered
    // attack must be blocked by Barrier first, so the shield pool is NEVER touched.
    it('shield precedence: Barrier blocks in front of the shield pool — shield never drains', () => {
        const shieldSelf = () =>
            ab({
                type: 'shield',
                target: 'self',
                config: { type: 'shield', pct: 25, basis: 'hp' }, // 25% of 10000 hp = 2500 pool
            });

        const { result } = run(
            healBase({
                numRounds: 2,
                hp: 10_000,
                shipSkills: { slots: [{ slot: 'active', abilities: [shieldSelf()] }] },
                selfBuffs: [barrierBuff()],
                enemyAttackers: [manualEnemy('atk1', 3000)],
            })
        );

        const rounds = result.healing!.rounds;
        // The fixture really does seed a non-zero shield pool (otherwise this test is vacuous):
        // by round 2 the round-1 cast's 2500 shield is present at round start.
        expect(rounds[1].targetShieldStart).toBeGreaterThan(0);
        // Barrier blocks each round's 3000 attack…
        expect(rounds.map((rd) => rd.barrierAbsorbed)).toEqual([3000, 3000]);
        // …and because Barrier is in FRONT of the shield, the shield pool is NEVER drained.
        expect(rounds.map((rd) => rd.shieldAbsorbed)).toEqual([0, 0]);
        // HP intact (round-2 start, the post-hit signal) — nothing got through Barrier.
        expect(rounds[1].targetHpPctStart).toBeCloseTo(100, 6);
        expect(result.healing!.destroyedRound).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────
// Barrier duration semantics (lock) — resolves locked decision #9.
// ─────────────────────────────────────────────────────────────────────────────────────

/** Self hp-threshold-below condition (TRIGGER config; executeIntent scrubs it at drain). */
const selfThresholdBelow = (n: number) =>
    ({
        subject: 'hp-threshold',
        derivable: true,
        hpComparator: 'below',
        hpPercent: n,
        hpSubject: 'self',
    }) as const;

/** A real on-hp-threshold-crossed Barrier grant (Tycho/Kafa shape): when the tank's own
 *  HP drops below `threshold`%, grant a `duration` Barrier self-buff. */
const crossingBarrier = (threshold: number, duration: number, oncePerCombat = false): Ability => ({
    id: `xbarrier-${++idCounter}`,
    type: 'buff',
    target: 'self',
    trigger: 'on-hp-threshold-crossed',
    conditions: [selfThresholdBelow(threshold)],
    config: {
        type: 'buff',
        buffName: 'Barrier',
        stacks: 1,
        parsedEffects: {},
        isStackable: false,
        duration,
        oncePerCombat,
    },
});

/** A damage-taken heal-leech (heals `pct`% of each attack's damage AFTER the drain).
 *  Recovery so the tank re-arms above the threshold between crossings. noCrit → deterministic. */
const takenLeechHeal = (pct: number): Ability => ({
    id: `leech-${++idCounter}`,
    type: 'heal',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal', pct, basis: 'damage-taken', noCrit: true },
});

describe('Barrier duration semantics (lock)', () => {
    /**
     * USER RULING (decision #9 — RESOLVED, authoritative; this is the real game mechanic):
     * "Keep current." Barrier blocks all damage from the REMAINING attacks in the round it is
     * granted. Its value scales with enemy count: with N enemies, a Barrier granted when enemy
     * 1's attack crosses the threshold blocks the same-round attacks of enemies 2..N. With a
     * SINGLE enemy, the Barrier is granted AFTER that enemy's only attack, so there is nothing
     * left for it to block this round — and the tank's own same-turn post-turn decrement expires
     * it before the next round. This single-enemy inertness is INTENTIONAL and ACCEPTED, NOT a
     * defect. The multi-enemy lock test at the end of this describe block demonstrates where
     * Barrier delivers its value (enemy 2's same-round attack IS blocked).
     *
     * This test pins the single-enemy boundary case: a "for 1 turn" (duration:1) Barrier blocks
     * ZERO intake events with one enemy.
     *
     * Fixture: maxHp 10000, crossing threshold 40% (4000 HP), a duration:1 Barrier granted
     * reactively when the tank's own HP first drops below 40% (Kafa/Tycho shape — but NOT
     * oncePerCombat, so it can re-fire). A manual flat enemy hits 6500/round, and a 70%
     * damage-taken leech recovers the tank ~back up each round. 4 rounds.
     *
     * OBSERVED round-by-round trace (per-round barrierAbsorbed / targetHpPctStart / round buffs):
     *
     *   R1 (start 100% = 10000):
     *     - Enemy attacks 6500. NO Barrier active yet → HP drains 10000 → 3500 (35%).
     *       This intake is NOT blocked (barrierAbsorbed R1 = 0).
     *     - HP is now below 40% → the on-hp-threshold-crossed listener fires DURING R1's enemy
     *       turn and grants Barrier duration:1.
     *     - Leech 70% of 6500 = 4550 → 3500 + 4550 = 8050 (80.5%).
     *     - Owner post-turn decrement INCLUDES same-turn applications: the duration:1 Barrier
     *       granted THIS round is decremented 1 → 0 at the tank's own post-turn decrement and
     *       EXPIRES before any further intake. It blocks NOTHING (the only R1 intake already
     *       landed before the grant).
     *
     *   R2 (start 80.5% = 8050):
     *     - The R1 Barrier still LINGERS in the round-overview snapshot (healTargetBuffs shows
     *       'Barrier') — but it is already spent/expired and does NOT block: the 6500 attack
     *       drains 8050 → 1550 (15.5%) UNBLOCKED (barrierAbsorbed R2 = 0). A fresh duration:1
     *       Barrier is granted during R2's enemy turn and again expires same-turn.
     *
     *   R3 (start 61.0%): same — attack lands UNBLOCKED. Because no intake is ever blocked, the
     *     leech can't keep pace with 6500/round and the tank is DESTROYED in round 3.
     *
     * CONCLUSION (the lock): a reactively-granted "for 1 turn" (duration:1) Barrier whose grant
     * trigger fires DURING the enemy's turn (AFTER the attack that caused the crossing) blocks
     * ZERO intake events. The same-turn application is immediately consumed by the tank's own
     * post-turn decrement (owner post-turn decrement INCLUDES same-turn applications, per the
     * turn model), so the Barrier never survives into a round where an intake event occurs.
     * NOTE: the spent Barrier still LINGERS for one round in healTargetBuffs (the round-overview
     * snapshot re-derives it) even though it blocks nothing — names-only display, never folded
     * into any value. Every round's incoming attack therefore drains HP normally; barrierAbsorbed
     * is 0 in EVERY round, and the tank dies once the leech can't keep up.
     *
     * Per the USER RULING above, this zero-block outcome is the INTENTIONAL, ACCEPTED consequence
     * of the real mechanic ("Barrier blocks the remaining same-round attacks; with one enemy
     * there are none left after the grant"), NOT a defect. The grant timing (reactive, post-attack,
     * during the enemy turn) collides with the same-turn decrement so a 1-turn duration has no
     * surviving window — but with a SINGLE attacker there was never anything left to block this
     * round anyway. See the duration:2 test (a longer duration survives one round to block the
     * NEXT round) and the multi-enemy test (where Barrier blocks enemy 2's SAME-round attack —
     * its real value) below for the contrast.
     */
    it('reactive duration:1 Barrier (grant fires post-attack) blocks ZERO intake — expires same turn', () => {
        const { result } = run(
            healBase({
                numRounds: 4,
                hp: 10_000,
                shipSkills: {
                    slots: [
                        {
                            slot: 'passive',
                            abilities: [crossingBarrier(40, 1), takenLeechHeal(70)],
                        },
                    ],
                },
                enemyAttackers: [manualEnemy('atk1', 6500)],
            })
        );

        const rounds = result.healing!.rounds;

        // NON-VACUOUS: the attacks actually land as incoming damage in R1-R3 (R4 the tank is
        // already dead → no further intake).
        expect(rounds.slice(0, 3).every((rd) => rd.incomingDamage === 6500)).toBe(true);

        // LOCK: a duration:1 Barrier granted reactively (post-attack, during the enemy turn) is
        // decremented to expiry by the tank's own same-turn post-turn decrement → it never
        // survives into an intake. barrierAbsorbed is 0 in EVERY round.
        expect(rounds.map((rd) => rd.barrierAbsorbed)).toEqual([0, 0, 0, 0]);

        // The spent Barrier LINGERS one round in the round-overview (R2 shows it) even though it
        // blocked nothing — names-only display, distinct from the blocked total above.
        expect(rounds[1].healTargetBuffs.map((b) => b.buffName)).toContain('Barrier');

        // Because nothing is ever blocked, the leech can't keep up with 6500/round → the tank
        // is destroyed in round 3 (confirms the zero-block result is load-bearing, not vacuous).
        expect(result.healing!.destroyedRound).toBe(3);
    });

    /**
     * Contrast / sanity lock: a LONGER (duration:2) reactively-granted Barrier DOES survive past
     * its grant turn and blocks the NEXT round's intake.
     *
     * Same fixture as above but duration:2. OBSERVED targetHpPctStart / barrierAbsorbed per round:
     *   R1 start 100.0%, barrierAbsorbed 0
     *   R2 start  80.5%, barrierAbsorbed 6500  (BLOCKED)
     *   R3 start 100.0%, barrierAbsorbed 0
     *   R4 start  80.5%, barrierAbsorbed 6500  (BLOCKED)
     *
     *   R1: attack 6500 lands UNBLOCKED (10000 → 3500, 35%) → crossing fires → Barrier duration:2
     *       granted during R1's enemy turn → same-turn post-turn decrement takes 2 → 1 (STILL
     *       ACTIVE). Leech recovers toward 80.5%.
     *   R2: Barrier (1 turn left) is ACTIVE at the start of the enemy turn → the 6500 attack is
     *       FULLY BLOCKED (barrierAbsorbed R2 = 6500, HP does NOT drain). No crossing → no fresh
     *       grant. Post-turn decrement takes 1 → 0 → EXPIRES.
     *   R3: Barrier expired → 6500 attack lands UNBLOCKED again → crossing fires → fresh
     *       duration:2 Barrier granted → survives into R4.
     *   R4: Barrier active → 6500 FULLY BLOCKED (barrierAbsorbed R4 = 6500).
     *
     * So a duration:2 Barrier blocks exactly the intake of the round AFTER each grant: rounds 2
     * and 4 here. This confirms the duration:1 single-enemy zero-block result above is a
     * same-turn-decrement artifact of the 1-turn duration (and, per the USER RULING, the
     * accepted single-enemy boundary), not a bug in the block guard itself.
     */
    it('reactive duration:2 Barrier survives one round and blocks the NEXT round intake', () => {
        const { result } = run(
            healBase({
                numRounds: 4,
                hp: 10_000,
                shipSkills: {
                    slots: [
                        {
                            slot: 'passive',
                            abilities: [crossingBarrier(40, 2), takenLeechHeal(70)],
                        },
                    ],
                },
                enemyAttackers: [manualEnemy('atk1', 6500)],
            })
        );

        const rounds = result.healing!.rounds;

        // R1 + R3 grants: attack lands unblocked (barrierAbsorbed 0). R2 + R4: fully blocked 6500.
        expect(rounds.map((rd) => rd.barrierAbsorbed)).toEqual([0, 6500, 0, 6500]);
        // The two blocks keep the tank alive across all 4 rounds.
        expect(result.healing!.destroyedRound).toBeUndefined();
    });

    /**
     * MULTI-ENEMY VALUE LOCK (the USER RULING in action) — a reactive duration:1 Barrier blocks
     * the SAME-ROUND attack of a SECOND enemy that acts after the triggering enemy. This is where
     * Barrier delivers its real value; the single-enemy inertness above is just the N=1 boundary.
     *
     * Fixture: same Tycho-shape reactive duration:1 grant (threshold 40%, NOT oncePerCombat) and
     * 70% damage-taken leech as the single-enemy test, but with TWO enemy attackers BOTH faster
     * than the tank so they both act before the tank's own turn each round:
     *   - tank (focus / heal target): speed 50
     *   - enemy atk1: 6500 damage, speed 120  → acts FIRST, crosses the 40% threshold
     *   - enemy atk2: 3000 damage, speed 110  → acts SECOND, SAME round, before the tank
     *
     * OBSERVED per-round event trace (every round R1-R3 is identical — atk1 re-crosses each round
     * because the leech recovers the tank back above 40% by the round top, then atk1 re-drops it):
     *
     *   [attacked atk1]            — 6500 lands UNBLOCKED (tank HP 10000 → ~3500, below 40%)
     *   [buff-applied attacker Barrier] — the on-hp-threshold-crossed grant fires DURING atk1's
     *                                     turn → duration:1 Barrier now active on the tank
     *   [attacked atk2]            — 3000 attack arrives SAME round. Barrier is STILL ACTIVE (the
     *                                tank has NOT taken its post-turn decrement yet — it acts last)
     *                                → atk2's 3000 is FULLY BLOCKED (barrierAbsorbed += 3000) and,
     *                                per decision #7, deals NO damage taken → its damage-taken leech
     *                                does NOT fire (a fully-blocked attack has nothing to leech from)
     *   [buff-expired attacker Barrier] — the tank's own post-turn decrement (1 → 0) expires it
     *
     * Per-round result: incomingDamage 9500 (6500 + 3000), barrierAbsorbed 3000 (exactly atk2's
     * hit). The damage-taken leech heals 4550 (70% of atk1's UNBLOCKED 6500 only — NOT 70% of the
     * full 9500); the blocked atk2 3000 contributes ZERO leech (decision #7). The tank survives the
     * two rounds (10000 → 8050 → 6100) — contrast the single-enemy control (same Barrier, only the
     * 6500 enemy) which blocks ZERO.
     *
     * This is the load-bearing demonstration of the real mechanic AND decision #7: with multiple
     * enemies the reactive 1-turn Barrier blocks every same-round attack that lands AFTER the grant,
     * and a fully-blocked attack feeds neither HP loss nor a damage-taken leech.
     *
     * NOTE on the turn model: this benefit depends on TURN ORDER — both attacking enemies must
     * act before the tank's own post-turn decrement (here forced via enemy speed > tank speed). A
     * fuller positional/multi-enemy combat model (where targeting and ordering vary) is a deferred
     * future phase; this test locks the benefit under the current single-target turn model where
     * the ordering can be arranged.
     */
    it('reactive duration:1 Barrier blocks a SECOND enemy same-round attack, and the blocked hit feeds no leech', () => {
        const { result } = run(
            healBase({
                numRounds: 2,
                hp: 10_000,
                speed: 50, // tank slowest (margin); the enemy speeds 120/110 are what force both
                // enemies to act before the tank's post-turn decrement, so the grant survives the round
                shipSkills: {
                    slots: [
                        {
                            slot: 'passive',
                            abilities: [crossingBarrier(40, 1), takenLeechHeal(70)],
                        },
                    ],
                },
                enemyAttackers: [
                    manualEnemy('atk1', 6500, 120), // crosses the threshold → grants Barrier
                    manualEnemy('atk2', 3000, 110), // same-round attack AFTER the grant → blocked
                ],
            })
        );

        const rounds = result.healing!.rounds;

        // NON-VACUOUS: both attacks arrive each round (6500 + 3000 = 9500 incoming).
        expect(rounds.every((rd) => rd.incomingDamage === 9500)).toBe(true);

        // LOCK: each round, atk1's 6500 lands UNBLOCKED (it triggers the grant), then atk2's 3000
        // same-round attack is FULLY BLOCKED by the freshly-granted Barrier → barrierAbsorbed 3000
        // every round (exactly atk2's hit, never atk1's). This is the real multi-enemy value.
        expect(rounds.map((rd) => rd.barrierAbsorbed)).toEqual([3000, 3000]);

        // LOCK (decision #7): the 70% damage-taken leech heals 4550 = 70% of atk1's UNBLOCKED 6500
        // ONLY. The fully-blocked atk2 3000 deals no damage taken → it feeds NO leech (the heal is
        // NOT 70% of 9500 = 6650). A Barrier-blocked attack has nothing to leech from. The leech
        // credits the heal target's own directHeal (read off the engine round's perActor map).
        expect(rounds.map((rd) => rd.perActor.get('attacker')?.directHeal)).toEqual([4550, 4550]);

        // The tank survives the two rounds — the blocked 3000/round is damage it never takes.
        expect(result.healing!.destroyedRound).toBeUndefined();
    });
});
