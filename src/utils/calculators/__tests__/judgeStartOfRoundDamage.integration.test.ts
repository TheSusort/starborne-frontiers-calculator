/**
 * Epic PR4: Judge's passive "At the start of the round, this Unit deals 60% damage to all
 * enemies with less than 50% HP" is parsed `type:'damage', trigger:'start-of-round'` (was
 * on-cast). This proves the fix through the REAL DPS-mode entry point (`simulateDPS`, which is
 * `runCombat` under the hood — DPS mode is not a separate simplified path):
 *
 *   1. The ability is now consumed by the reactive engine (LIVE_TRIGGERS 'start-of-round' →
 *      the `round-started` listener, triggers.ts) instead of the old cast-time
 *      "passive payload hit" fold (playerTurn.ts) — it fires EVERY ROUND the hp-threshold
 *      gate passes, not just the round it happens to be evaluated inline with a cast.
 *   2. The reactive `damage` executor branch (triggers.ts `cfg.type === 'damage'`) credits
 *      `effectiveAttack × (multiplier/100) × hits`, with NO enemy-defense mitigation and NO
 *      crit roll (`ctx.creditReactiveDamage`) — a DIFFERENT formula from the old on-cast fold,
 *      which ran the ability through the normal hit pipeline (defense-mitigated, crit-eligible).
 *      This is a real, documented behavior/number change for Judge (and any other ship whose
 *      passive damage crosses this same re-tag), not a regression — reported, not silently
 *      papered over with a golden update.
 *
 * RED STATUS: only the THIRD test below (the defense-mitigation comparison) actually fails
 * against the pre-fix baseline. The first two (round-1 gate, "fires every round") pass under
 * BOTH the old on-cast fold and the new reactive path at defense=0/crit=0 — at those settings the
 * old fold's per-cast hit and the new reactive credit compute byte-identical numbers (same
 * multiplier × attack, no mitigation to differ, no crit to roll), so they don't distinguish old
 * from new behavior on their own. They are kept as characterization tests of the NEW, correct
 * per-round firing pattern; the defense-mitigation test is the one that actually proves the fix.
 */
import { describe, it, expect } from 'vitest';
import { simulateDPS } from '../dpsSimulator';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
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
        const result = simulateDPS({
            attack: ATTACK,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            enemyDefense: 0,
            enemyHp: 19_000,
            rounds: 3,
            selfBuffs: [],
            enemyDebuffs: [],
            activeMultiplier: 100,
            shipSkills: judgeShipSkills(),
        });
        // Round 1: enemy at 100% entering → gate fails → only the 10,000 active hit.
        expect(result.rounds[0].directDamage).toBe(ATTACK);
        // Round 2: enemy at (19000-10000)/19000 ≈ 47.4% entering (< 50%) → the reactive fires:
        // 60% of BASE attack (10,000 × 0.6 = 6,000), credited alongside round 2's own active hit.
        const REACTIVE = ATTACK * 0.6;
        expect(result.rounds[1].directDamage).toBe(ATTACK + REACTIVE);
        // Round 3: still below 50% → fires again. Proves this is a per-round LIVE reactive
        // (start-of-round), not a single on-cast fold that only ever applied once.
        expect(result.rounds[2].directDamage).toBe(ATTACK + REACTIVE);
    });

    it('the reactive credit is NOT defense-mitigated (unlike the active hit) — a real numeric behavior change from the old on-cast fold', () => {
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

        // Round 2: the active hit is mitigated the SAME way (still `activeHitOnly`), but the
        // reactive credit riding alongside it is EXACTLY 60% of BASE (unmitigated) attack — not
        // reduced by the 5,000 defense that just cut the active hit down. If the reactive were
        // still defense-mitigated (the old on-cast fold's behavior), this round's total would be
        // LESS than `activeHitOnly + ATTACK * 0.6`.
        const REACTIVE = ATTACK * 0.6;
        expect(withReactive.rounds[1].directDamage).toBeCloseTo(activeHitOnly + REACTIVE, 6);
    });
});
