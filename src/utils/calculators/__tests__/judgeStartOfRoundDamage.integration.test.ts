/**
 * Epic PR4 / PR4b: Judge's passive "At the start of the round, this Unit deals 60% damage to
 * all enemies with less than 50% HP" is parsed `type:'damage', trigger:'start-of-round'` (was
 * on-cast). This proves the fix through the REAL DPS-mode entry point (`simulateDPS`, which is
 * `runCombat` under the hood — DPS mode is not a separate simplified path):
 *
 *   1. The ability is now consumed by the reactive engine (LIVE_TRIGGERS 'start-of-round' →
 *      the `round-started` listener, triggers.ts) instead of the old cast-time
 *      "passive payload hit" fold (playerTurn.ts) — it fires EVERY ROUND the hp-threshold
 *      gate passes, not just the round it happens to be evaluated inline with a cast.
 *   2. PR4b: the reactive `damage` executor branch (triggers.ts `cfg.type === 'damage'`) now
 *      runs the ability through the SAME mitigated/crit-eligible pipeline as an on-cast hit
 *      (`ctx.applyReactiveDamage`, mirroring the `counter` branch's `applyCounterAttack`) —
 *      defense-mitigated, and crit-eligible unless the ability carries `noCrit` (Judge does
 *      not). PRE-PR4b this branch credited `effectiveAttack × (multiplier/100) × hits` with NO
 *      mitigation and NO crit roll (`ctx.creditReactiveDamage`) — a real, documented
 *      behavior/number change for Judge (and Chakara/Incinerator/Rhodium, which cross this
 *      same re-tag), not a regression.
 *
 * RED STATUS (pre-PR4b baseline): only the THIRD test below (the defense-mitigation comparison)
 * actually failed. The first two (round-1 gate, "fires every round") pass under BOTH the old
 * flat-credit formula and the new mitigated one at defense=0/crit=0 — at those settings they
 * compute byte-identical numbers (no mitigation to differ, no crit to roll), so they don't
 * distinguish old from new behavior on their own. They are kept as characterization tests of the
 * correct per-round firing pattern; the defense-mitigation test is the one that actually proves
 * the fix (now flipped to assert mitigation IS applied, matching PR4b's fix).
 */
import { describe, it, expect } from 'vitest';
import { simulateDPS } from '../dpsSimulator';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { calculateDamageReduction } from '../../autogear/priorityScore';
import type { Ship } from '../../../types/ship';

const JUDGE_TEXT =
    'This Unit ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> ' +
    'effects and has <unit-damage>20% defense penetration</unit-damage><br /><br />At the ' +
    'start of the round, this Unit deals <unit-damage>60% damage</unit-damage> to all ' +
    'enemies with less than 50% HP.';

function judgeShipSkills() {
    const ship = {
        refits: [{}, {}, {}, {}],
        activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
        firstPassiveSkillText: JUDGE_TEXT,
    } as unknown as Ship;
    return buildShipAbilities(ship);
}

describe('Judge start-of-round AoE damage — reactive engine consumption (DPS mode)', () => {
    const ATTACK = 10_000;

    it('does NOT fire round 1 (enemy enters round 1 at 100% HP — the below-50% gate fails)', () => {
        const result = simulateDPS({
            attack: ATTACK,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            enemyDefense: 0,
            enemyHp: 19_000,
            rounds: 1,
            selfBuffs: [],
            enemyDebuffs: [],
            activeMultiplier: 100, // own 100%-attack active hit: 10,000 dmg → enemy at ~47.4%
            shipSkills: judgeShipSkills(),
        });
        // Round 1: only the active hit (10,000) lands — no reactive credit yet, since the
        // start-of-round gate for round 1 reads the ENTERING (pre-round) enemy HP%, which is
        // always 100% before any damage has been dealt.
        expect(result.rounds[0].directDamage).toBe(ATTACK);
    });

    it('fires EVERY round once the enemy is below 50% HP — a recurring reactive, not a one-shot', () => {
        // SP-U U5: the DPS enemy is now real & destructible and the run terminates on its death,
        // so this uses a larger pool (90k) that lingers below 50% for several rounds before dying
        // — enough to observe the start-of-round reactive fire on MULTIPLE below-50% rounds (the
        // point of the test) rather than a single kill round. Active-only 10k/round; once below
        // 50% the reactive adds 60% of base attack (6,000) every round through the kill.
        const result = simulateDPS({
            attack: ATTACK,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            enemyDefense: 0,
            enemyHp: 90_000,
            rounds: 12,
            selfBuffs: [],
            enemyDebuffs: [],
            activeMultiplier: 100,
            shipSkills: judgeShipSkills(),
        });
        const REACTIVE = ATTACK * 0.6;
        // The start-of-round reactive is gated on the ENTERING enemy HP% (rd.enemyHpPct): every
        // round entered below 50% deals ATTACK + REACTIVE; every round at/above 50% deals only
        // ATTACK. This holds through the kill round (the run terminates when the enemy dies).
        for (const rd of result.rounds) {
            expect(rd.directDamage).toBe(rd.enemyHpPct < 50 ? ATTACK + REACTIVE : ATTACK);
        }
        // Non-vacuous & recurring: the reactive fired on ≥2 rounds (not a one-shot on-cast fold).
        const firedRounds = result.rounds.filter((rd) => rd.enemyHpPct < 50);
        expect(firedRounds.length).toBeGreaterThanOrEqual(2);
        // The enemy is a real target — it dies within the window.
        expect(result.summary.survived).toBe(false);
    });

    it("the reactive credit IS now defense-mitigated (epic PR4b) — matches the active hit's mitigation ratio", () => {
        const DEFENSE = 5_000;

        // Isolate the DEFENSE-MITIGATED active-hit magnitude on its own: a huge enemyHp so the
        // hp-threshold gate never opens in round 1 (no reactive component to entangle with).
        const activeHitOnly = simulateDPS({
            attack: ATTACK,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            enemyDefense: DEFENSE,
            enemyHp: 10_000_000,
            rounds: 1,
            selfBuffs: [],
            enemyDebuffs: [],
            shipSkills: judgeShipSkills(),
        }).rounds[0].directDamage;
        // Defense strictly mitigates the active hit vs the no-defense baseline (10,000 raw).
        expect(activeHitOnly).toBeLessThan(ATTACK);

        // SAME attack/defense, but a small enemyHp so the (defense-mitigated) round-1 hit still
        // crosses the enemy below 50% HP, opening the reactive gate for round 2.
        const withReactive = simulateDPS({
            attack: ATTACK,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            enemyDefense: DEFENSE,
            enemyHp: 8_000,
            rounds: 2,
            selfBuffs: [],
            enemyDebuffs: [],
            shipSkills: judgeShipSkills(),
        });
        // Round 1 is defense-mitigated identically to the isolated active-only hit (the reactive
        // gate hasn't opened yet — same as the earlier "does NOT fire round 1" case).
        expect(withReactive.rounds[0].directDamage).toBeCloseTo(activeHitOnly, 6);

        // Round 2 (epic PR4b): the reactive credit riding alongside the active hit is now ALSO
        // defense-mitigated — cut down by (1 - calculateDamageReduction(DEFENSE)/100), the SAME
        // raw defense-vs-attack curve `victimHitDamage` (and `applyCounterAttack`) use for a
        // normal hit, with crit:0 so there is no crit multiplier to fold in.
        //
        // NOTE this is NOT literally `activeHitOnly / ATTACK`: Judge's own kit-text "20% defense
        // penetration" clause (JUDGE_TEXT) lowers the ACTIVE hit's effective enemy defense
        // (4,000 instead of 5,000), which is why `activeHitOnly` mitigates more favorably than a
        // bare `calculateDamageReduction(DEFENSE)` would predict. The reactive `applyReactiveDamage`
        // walk reads `effectiveStatsOf(owner).defensePenetration`, which is BASE-ACTOR-STAT ONLY
        // (ability/kit-text-derived pen bonuses fold separately and are NOT threaded through this
        // reactive path) — the SAME documented approximation `applyCounterAttack` already accepts
        // for counter-attacks. So the reactive credit here mitigates against the FULL 5,000
        // defense, not Judge's pen-reduced 4,000.
        const rawMitigationRatio = 1 - calculateDamageReduction(DEFENSE) / 100;
        const REACTIVE_MITIGATED = ATTACK * 0.6 * rawMitigationRatio;
        // Precision 0 (not 6, unlike the round-1 comparison above): the round's directDamage is
        // `Math.round(active + reactive)` computed from the FULL-PRECISION sum inside the engine,
        // while this expected value adds the already-rounded `activeHitOnly` to a freshly
        // computed `REACTIVE_MITIGATED` — a sub-1 rounding-order discrepancy, not a formula bug.
        expect(withReactive.rounds[1].directDamage).toBeCloseTo(
            activeHitOnly + REACTIVE_MITIGATED,
            0
        );
        // And, since Judge's defense-pen is real for the active hit but NOT folded into the
        // reactive walk, the reactive's own mitigation ratio is strictly worse than the active
        // hit's — proving the two hits are no longer using the identical byte-for-byte formula
        // (a real, reported approximation, not a silent regression).
        expect(rawMitigationRatio).toBeLessThan(activeHitOnly / ATTACK);
    });
});
