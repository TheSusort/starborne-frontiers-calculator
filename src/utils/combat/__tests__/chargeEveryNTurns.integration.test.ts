/**
 * Integration golden: every-n-turns(period 2) end-of-turn charge proc.
 *
 * Covers Phase 0 Task 5:
 *   - engine.ts increments actor.turnsTaken at turn-started
 *   - the drain context's turnsTakenFor delegate reads the live counter
 *
 * Harness: simulateDPS (single attacker, no walked team). Modelled on allyChargeGrant.test.ts.
 *
 * Test 1 (passive-only, no baseline cadence): chargeCount=8 but no charged slot, so
 * advanceChargeCadence is a no-op (hasChargedSkill=false). The every-n-turns proc is the
 * SOLE charge source. Expected: charges=0 after turn 1 (odd), charges=1 after turn 2 (even),
 * charges=1 after turn 3 (odd), charges=2 after turn 4 (even).
 *
 * Test 2 (active+charged+passive, combined cadence): advanceChargeCadence fires +1/turn AND
 * the proc adds +1 on even turns (chargeCount=8, no reset before round 4).
 *   Round 1 (turn 1): advance → 0+1=1; proc? 1%2≠0 → no.  charges=1.
 *   Round 2 (turn 2): advance → 1+1=2; proc? 2%2=0 → +1.  charges=3.
 *   Round 3 (turn 3): advance → 3+1=4; proc? 3%2≠0 → no.  charges=4.
 *   Round 4 (turn 4): advance → 4+1=5; proc? 4%2=0 → +1.  charges=6.
 *
 * Without the turnsTaken increment (pre-fix): turnsTaken stays 0 → condition never passes →
 * test-2 round-2 charges=2 (not 3). Asserting rounds[1].charges===3 catches the regression.
 */

import { describe, it, expect } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../../calculators/dpsSimulator';
import { Ability, ShipSkills } from '../../../types/abilities';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

/** The every-n-turns end-of-turn self charge ability under test. */
const everyNTurnsChargeAbility = (period: number, amount: number, id = 'ent'): Ability => ({
    id,
    type: 'charge',
    target: 'self',
    trigger: 'end-of-turn',
    conditions: [{ subject: 'every-n-turns', derivable: true, period, offset: 0 }],
    config: { type: 'charge', amount },
});

/** A minimal damage ability so the attacker has an active-slot skill to fire each turn. */
const activeDamageAbility = (id = 'dmg'): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});

/** A CAST-PATH every-n-turns SELF charge ability (trigger: 'on-cast'), placed on the active slot
 *  so it routes through gateFiringAbilities → chargeGainFromSkill (the cast path), NOT the
 *  reactive end-of-turn drain. Models the asymmetry under test. */
const castEveryNTurnsChargeAbility = (period: number, amount: number, id = 'castEnt'): Ability => ({
    id,
    type: 'charge',
    target: 'self',
    trigger: 'on-cast',
    conditions: [{ subject: 'every-n-turns', derivable: true, period, offset: 0 }],
    config: { type: 'charge', amount },
});

const baseInput = (overrides: Partial<DPSSimulationInput> = {}): DPSSimulationInput => ({
    attack: 10000,
    crit: 0,
    critDamage: 150,
    defensePenetration: 0,
    // chargeCount=0 default — individual tests override this. chargeCount=0 caps the charge
    // executor at 0 (min(current+amount, 0)=0), so tests that rely on charge accumulation
    // must override chargeCount to a positive value (e.g. chargeCount: 8).
    chargeCount: 0,
    enemyDefense: 0,
    enemyHp: 100_000_000,
    rounds: 6,
    selfBuffs: [],
    enemyDebuffs: [],
    ...overrides,
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('every-n-turns(2) end-of-turn charge proc — Phase 0 Task 5 integration', () => {
    /**
     * With chargeCount=0 (no charged skill) advanceChargeCadence is a no-op, so the
     * ONLY charge source is the every-n-turns proc itself. This isolates the proc
     * cleanly without any baseline cadence noise.
     *
     * Expected charges per round:
     *   round 1: turnsTaken=1 → 1%2≠0 → 0
     *   round 2: turnsTaken=2 → 2%2=0 → 1
     *   round 3: turnsTaken=3 → 3%2≠0 → 1 (no cap; chargeCount=0 → charge ability cap check)
     *
     * Wait — the charge executor caps at actor.chargeCount. chargeCount=0 means cap=0 and
     * the charge ability would be capped at 0 (min(0+1, 0)=0). That won't work.
     *
     * Use chargeCount=8 with a passive-only ship: no charged slot, so advanceChargeCadence
     * is a no-op (hasChargedSkill=false when there is no charged slot, even with chargeCount≥1).
     * The charge executor caps at chargeCount=8. Clean separation.
     */

    it('charges accumulate only on even turns (proc fires rounds 2, 4 only)', () => {
        // chargeCount=8 but NO charged slot → hasChargedSkill stays false (selectFiringSkill
        // returns undefined for 'charged') → advanceChargeCadence is a no-op every turn.
        // The every-n-turns proc is the SOLE charge source.
        const shipSkills: ShipSkills = {
            slots: [
                { slot: 'active', abilities: [activeDamageAbility()] },
                // passive carries the every-n-turns charge ability
                { slot: 'passive', abilities: [everyNTurnsChargeAbility(2, 1)] },
            ],
        };

        const result = simulateDPS(
            baseInput({
                chargeCount: 8,
                shipSkills,
                rounds: 4,
            })
        );

        // turnsTaken=1 (odd) → no proc → charges=0
        expect(result.rounds[0].charges).toBe(0);
        // turnsTaken=2 (even) → proc fires → charges=1
        expect(result.rounds[1].charges).toBe(1);
        // turnsTaken=3 (odd) → no proc → charges still 1
        expect(result.rounds[2].charges).toBe(1);
        // turnsTaken=4 (even) → proc fires → charges=2
        expect(result.rounds[3].charges).toBe(2);
    });

    it('charges with both baseline cadence and every-n-turns proc (chargeCount=8, active+charged slots)', () => {
        // Active + charged slots: hasChargedSkill=true → advanceChargeCadence adds +1/turn (no
        // reset before round 4 since charges never reach 8). The proc adds +1 on even turns.
        //
        // Derivation (chargeCount=8, startCharged=false, startCharges=0):
        //   Round 1 (turn 1): advance 0→1; proc? 1%2≠0 → no.  charges=1.
        //   Round 2 (turn 2): advance 1→2; proc? 2%2=0 → +1.  charges=3.
        //   Round 3 (turn 3): advance 3→4; proc? 3%2≠0 → no.  charges=4.
        //   Round 4 (turn 4): advance 4→5; proc? 4%2=0 → +1.  charges=6.
        //
        // Pre-fix baseline (turnsTaken always 0 → proc never fires):
        //   Round 2 charges = 2 (not 3) → the failing assertion catches the regression.
        const shipSkills: ShipSkills = {
            slots: [
                { slot: 'active', abilities: [activeDamageAbility('a')] },
                { slot: 'charged', abilities: [activeDamageAbility('c')] },
                { slot: 'passive', abilities: [everyNTurnsChargeAbility(2, 1, 'ent')] },
            ],
        };

        const result = simulateDPS(
            baseInput({
                chargeCount: 8,
                shipSkills,
                rounds: 4,
            })
        );

        expect(result.rounds[0].charges).toBe(1);
        // KEY ASSERTION: without the turnsTaken increment this would be 2 (not 3).
        expect(result.rounds[1].charges).toBe(3);
        expect(result.rounds[2].charges).toBe(4);
        expect(result.rounds[3].charges).toBe(6);
    });

    it('proc does NOT fire on odd turns (control: period=3 skips turns 1 and 2)', () => {
        // Sanity check: period=3 proc fires only on turn 3 (turnsTaken=3, 3%3=0).
        // Rounds 1 and 2 get only baseline; round 3 gets baseline+1.
        const shipSkills: ShipSkills = {
            slots: [
                { slot: 'active', abilities: [activeDamageAbility('a')] },
                { slot: 'charged', abilities: [activeDamageAbility('c')] },
                { slot: 'passive', abilities: [everyNTurnsChargeAbility(3, 1, 'ent3')] },
            ],
        };

        const result = simulateDPS(
            baseInput({
                chargeCount: 8,
                shipSkills,
                rounds: 3,
            })
        );

        expect(result.rounds[0].charges).toBe(1); // turn 1: advance only
        expect(result.rounds[1].charges).toBe(2); // turn 2: advance only (2%3≠0)
        expect(result.rounds[2].charges).toBe(4); // turn 3: advance 2→3, proc +1 → 4
    });

    it('CAST-PATH every-n-turns(2) on-cast self charge fires on even turns (symmetry with reactive)', () => {
        // The every-n-turns SELF charge ability lives on the ACTIVE slot with trigger 'on-cast',
        // so it flows through the CAST path (gateFiringAbilities → chargeGainFromSkill) rather than
        // the reactive end-of-turn drain. The cast-path condition context is built by
        // buildRoundContext in runPlayerTurn; pre-fix it does NOT carry turnsTaken (defaults 0),
        // so the every-n-turns gate's `t <= 0` guard always rejects and the proc never banks.
        //
        // Active + charged slots: hasChargedSkill=true → advanceChargeCadence adds +1/turn (no reset
        // before round 4 since charges never reach 8). The cast-path proc adds +1 on even turns.
        //
        // Post-fix derivation (chargeCount=8, startCharged=false, startCharges=0):
        //   Round 1 (turn 1): advance 0→1; proc? 1%2≠0 → no.  charges=1.
        //   Round 2 (turn 2): advance 1→2; proc? 2%2=0 → +1.  charges=3.
        //   Round 3 (turn 3): advance 3→4; proc? 3%2≠0 → no.  charges=4.
        //   Round 4 (turn 4): advance 4→5; proc? 4%2=0 → +1.  charges=6.
        //
        // Pre-fix (cast-path turnsTaken always 0 → gate rejects → ability dropped by
        // gateFiringAbilities → proc never fires):
        //   Round 2 charges = 2 (not 3) → the KEY assertion below fails pre-fix.
        const shipSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        activeDamageAbility('a'),
                        castEveryNTurnsChargeAbility(2, 1, 'castEnt'),
                    ],
                },
                { slot: 'charged', abilities: [activeDamageAbility('c')] },
            ],
        };

        const result = simulateDPS(
            baseInput({
                chargeCount: 8,
                shipSkills,
                rounds: 4,
            })
        );

        expect(result.rounds[0].charges).toBe(1); // turn 1 (odd): advance only
        // KEY ASSERTION: pre-fix this is 2 (cast-path turnsTaken=0 → proc never fires).
        expect(result.rounds[1].charges).toBe(3); // turn 2 (even): advance 1→2, cast proc +1 → 3
        expect(result.rounds[2].charges).toBe(4); // turn 3 (odd): advance 3→4, no proc
        expect(result.rounds[3].charges).toBe(6); // turn 4 (even): advance 4→5, cast proc +1 → 6
    });
});
