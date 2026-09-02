import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
import { bareEnemy, BARE_ENEMY_ID } from '../__testutils__/bareRosterFixture';

// NOTE: do NOT call resetRateGateRng() after setupKeyedTestRng() — reset nulls the keyed
// provider and restores Math.random, un-seeding the test (rateAccumulator.ts).

const FOCUS_ID = 'attacker';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `sp4a_${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const damageSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } })],
        },
    ],
});

/** A heal-carrying kit: `self` so the fixture needs no team actors (a bare `stats.hp` team ally
 *  would be silently reduced to 1 HP by `normalizeTeamActorsToWalked` without a `walk` bundle). */
const selfHealSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({
                    type: 'heal',
                    target: 'self',
                    config: { type: 'heal', pct: 10, basis: 'hp' },
                }),
            ],
        },
    ],
});

const base = (): CombatEngineInput => ({
    // Every run needs a real opponent. This file's subject is `mode` — the run-kind
    // signal — not the roster, so the roster here is the shared inert 0-attack punching bag.
    // 20 000 total focus damage against 500 000 HP means it survives both rounds, so the run's
    // SHAPE is constant across every mode compared below (a mid-run kill would change it).
    enemyAttackers: bareEnemy(),
    attack: 10_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: damageSkills(),
    numRounds: 2,
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
    hp: 50_000,
    speed: 300,
});

const DPS_BASE = (): CombatEngineInput => ({ ...base() });
/** No `healTargetId` here — each test adds it, so the "mode 'healing' names no heal focus"
 *  guard test in Task 6 can omit it. */
const HEAL_BASE = (): CombatEngineInput => ({ ...base(), shipSkills: selfHealSkills() });
const BATTLE_BASE = (): CombatEngineInput => ({ ...base() });

describe('mode is the sole run-kind signal', () => {
    beforeEach(() => {
        setupKeyedTestRng(9001);
    });

    it("omitting mode on a plain DPS input is identical to mode 'dps'", () => {
        setupKeyedTestRng(9001);
        const implicit = runCombat({ ...DPS_BASE() });
        setupKeyedTestRng(9001);
        const explicit = runCombat({ ...DPS_BASE(), mode: 'dps' });

        expect(explicit).toEqual(implicit);
        // NON-VACUITY (correction 9's class): a whole-result `toEqual` is only an equivalence claim
        // if the results carry something. Positionally the focus's credit lives in `perTargetDealt`,
        // NOT in the now-dead scalar `directDamage`, so pin the credit that actually exists — two
        // equal-but-empty results would otherwise satisfy the assertion above.
        expect(implicit.rounds.map((r) => r.perTargetDealt?.attacker?.[BARE_ENEMY_ID])).toEqual([
            10_000, 10_000,
        ]);
    });

    it('battle mode keeps the healing result block (healPipelineActive, not mode, gates it)', () => {
        // Regression fence for the fact verified in this plan: battle mode anchors healTarget to
        // the focus, so the `healing` block IS present in a sim result. Gating that block on
        // `mode === 'healing'` would silently drop it from every battleSimulator result.
        const result = runCombat({ ...BATTLE_BASE(), mode: 'battle' });
        expect('healing' in result && result.healing !== undefined).toBe(true);
    });
});

describe('the engine demands an explicit mode rather than inferring one', () => {
    it('throws when healTargetId is set without a heal-bearing mode', () => {
        expect(() => runCombat({ ...HEAL_BASE(), healTargetId: FOCUS_ID })).toThrow(
            /healTargetId requires mode/
        );
    });

    it("throws when mode 'healing' names no heal focus", () => {
        expect(() => runCombat({ ...HEAL_BASE(), mode: 'healing' })).toThrow(
            /mode 'healing' requires healTargetId/
        );
    });

    it("accepts healTargetId with mode 'healing'", () => {
        expect(() =>
            runCombat({ ...HEAL_BASE(), healTargetId: FOCUS_ID, mode: 'healing' })
        ).not.toThrow();
    });

    it("accepts healTargetId with mode 'battle'", () => {
        // Legal, not just tolerated: ~20 fixtures migrated from the old `positionalTeamBattle:
        // true` field carry a `healTargetId` alongside it, so a future tightening of guard 1
        // (healTargetId requires 'healing' or 'battle') would break them silently without this.
        expect(() =>
            runCombat({ ...BATTLE_BASE(), healTargetId: FOCUS_ID, mode: 'battle' })
        ).not.toThrow();
    });
});
