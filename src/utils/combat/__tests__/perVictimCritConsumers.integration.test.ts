/**
 * Per-victim crit — consumer integration tests (Task 6).
 *
 * Three "consumer" effects that must behave per-victim after the per-victim crit wiring:
 *
 * 1. BLOODTHIRST (on-crit implant): `critHits` on the ability-performed event is a per-victim
 *    crit-identity signal — the count of critting (hit, victim) pairs a positional cast produced.
 *    Post-PR7, the on-crit listener no longer drives its enqueue count off `critHits`: it enqueues
 *    ONCE per positional `ability-performed` event (i.e. once per sub-attack) and scales the
 *    Bloodthirst heal off THAT event's `deliveredDamage`. (Since PR5 of the multi-hit epic, the
 *    non-positional/DPS path emits the SAME shape as the positional path — one event per
 *    sub-attack, with `critHits` 0 or 1 for THAT sub-attack's own crit outcome. There is no fold
 *    left anywhere and no separate enqueue-count meaning to carry: both paths enqueue once per
 *    event.) These tests still pin `critHits` itself as a per-victim signal on the payload; they
 *    do not exercise the enqueue count.
 *
 * 2. REACTIVE WARD (on-attacked): each AoE victim receives its OWN per-victim `attacked` event
 *    carrying THAT victim's own crit outcome. An AoE where the anchor crits but a disadvantaged
 *    covered victim does NOT crit must deliver `attacked.didCrit=true` to the anchor and
 *    `attacked.didCrit` absent/falsy to the covered victim.
 *
 * 3. MENACE (outgoing-amplification, amplify-on-crit): `outgoingAmplificationFor(victim, didCrit)`
 *    is called per footprint victim with THAT victim's crit outcome. An AoE at a mixed line where
 *    one victim crits (anchor) and one does not (covered) should deliver amplified damage only to
 *    the critting anchor — observable as a higher `attacked.damage` on the anchor vs control,
 *    while the covered victim's damage stays identical to the control.
 *
 * RNG strategy:
 *   - rng()=0.9 → crit rate 1.0 fires (0.9<1.0); crit rate 0.75 does NOT fire (0.9<0.75 false).
 *   - rng()=0   → all rate-gates fire (both crits; proc chances too).
 *
 * Passive abilities are wired through `shipSkills.slots` under a `'passive'` slot, matching the
 * pattern used in chronoReaverCharge.integration.test.ts and other engine tests.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { setRateGateRng, setKeyedRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import type { AffinityName } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import type { Ability, ShipSkills } from '../../../types/abilities';

// ---------------------------------------------------------------------------
// Shared harness helpers
// ---------------------------------------------------------------------------

/** A 100% single-hit direct damage active skill slot. */
function basicAttackSlot(): ShipSkills['slots'][number] {
    return {
        slot: 'active',
        abilities: [
            {
                id: 'dmg-basic',
                type: 'damage',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [],
                config: { type: 'damage', multiplier: 100 },
            },
        ],
    };
}

/** A passive slot carrying the given abilities. */
function passiveSlot(abilities: Ability[]): ShipSkills['slots'][number] {
    return { slot: 'passive', abilities };
}

/** A positioned enemy attacker with no offence (never fires back). */
function passiveEnemy(
    id: string,
    position: Position,
    affinity: AffinityName
): NonNullable<CombatEngineInput['enemyAttackers']>[number] {
    return {
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        affinity,
        shipSkills: { slots: [] },
    };
}

/** Base CombatEngineInput for the focus attacker (chemical, crit 100, attack 5000). */
function baseInput(
    passiveAbilities: Ability[],
    enemyAttackers: NonNullable<CombatEngineInput['enemyAttackers']>
): CombatEngineInput {
    return {
        attack: 5000,
        crit: 100,
        critDamage: 100,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: {
            slots: [
                basicAttackSlot(),
                ...(passiveAbilities.length > 0 ? [passiveSlot(passiveAbilities)] : []),
            ],
        },
        numRounds: 1,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinity: 'chemical',
        defence: 0,
        hp: 1_000_000_000,
        healTargetId: 'attacker',
        mode: 'healing',
        // 'all' pattern hits every living enemy-side actor.
        target: { raw: 'front', side: 'enemy', selection: 'front' },
        pattern: { raw: 'all', shape: 'all', range: 'all', modifiers: {} },
        position: 'M1',
        enemyAttackers,
    };
}

type AbilityPerformedEvent = Extract<CombatEvent, { type: 'ability-performed' }>;
type AttackedEvent = Extract<CombatEvent, { type: 'attacked' }>;

function collectAbilityPerformed(input: CombatEngineInput): AbilityPerformedEvent[] {
    const bus = createEventBus();
    const events: AbilityPerformedEvent[] = [];
    bus.on('ability-performed', (e) => events.push(e));
    runCombat({ ...input, bus });
    return events.filter((e) => e.actorId === 'attacker');
}

function collectAttacked(input: CombatEngineInput): AttackedEvent[] {
    const bus = createEventBus();
    const events: AttackedEvent[] = [];
    bus.on('attacked', (e) => events.push(e));
    runCombat({ ...input, bus });
    return events;
}

// ---------------------------------------------------------------------------
// 1. BLOODTHIRST — per-crit fan-out: critHits scales with critting-victim count
// ---------------------------------------------------------------------------

describe('per-victim crit identity on the event payload (Task 6)', () => {
    afterEach(() => resetRateGateRng());

    /**
     * `critHits` on the ability-performed event is a per-victim crit-identity signal — the count
     * of critting (hit, victim) pairs a positional cast produced — regardless of how many times
     * any listener enqueues off it. Bloodthirst is the canonical on-crit implant, wired here as a
     * passive ability with trigger:'on-crit' so we can read the payload it receives.
     *
     * Scenario A: 2 neutral enemies → both crit (rate 1.0, rng=0.9 → 0.9<1.0) → critHits=2.
     * Scenario B: 1 neutral enemy → only 1 crits → critHits=1.
     *
     * Post-PR7, the on-crit listener no longer enqueues `critHits` times: on the positional path it
     * enqueues ONCE per `ability-performed` event (per sub-attack) and scales the Bloodthirst heal
     * off that event's `deliveredDamage`. critHits=2 here proves per-victim crit identity on the
     * payload, not the proc-roll count.
     */
    it('2-victim AoE where both crit produces critHits=2; 1-victim produces critHits=1', () => {
        setRateGateRng(() => 0.9);

        // Bloodthirst-like passive: on-crit self-heal (trigger:on-crit is what drives the fan-out)
        const bloodthirstAbility: Ability = {
            id: 'bloodthirst-test-1',
            type: 'heal',
            target: 'self',
            trigger: 'on-crit',
            conditions: [],
            procChance: 0.2, // legendary 20%
            config: { type: 'heal', pct: 20, basis: 'damage-dealt' },
        };

        // Scenario A: 2 neutral enemies (both crit at rate 1.0)
        const twoVictimInput = baseInput(
            [bloodthirstAbility],
            [
                passiveEnemy('e1', 'M4', 'antimatter'), // neutral → rate 1.0 → crits at rng=0.9
                passiveEnemy('e2', 'M3', 'antimatter'), // neutral → rate 1.0 → crits at rng=0.9
            ]
        );
        const twoVictimPerf = collectAbilityPerformed(twoVictimInput);
        expect(twoVictimPerf.length).toBeGreaterThan(0);
        const critHitsA = twoVictimPerf[0].critHits;

        // Scenario B: 1 neutral enemy
        const oneVictimInput = baseInput(
            [bloodthirstAbility],
            [
                passiveEnemy('e1', 'M4', 'antimatter'), // only victim, crits
            ]
        );
        const oneVictimPerf = collectAbilityPerformed(oneVictimInput);
        expect(oneVictimPerf.length).toBeGreaterThan(0);
        const critHitsB = oneVictimPerf[0].critHits;

        // Core assertion: critHits scales with critting-victim count (a payload identity signal;
        // Bloodthirst itself no longer enqueues n=critHits times — see the describe-block doc).
        expect(critHitsA).toBe(2); // 2 critting (hit, victim) pairs
        expect(critHitsB).toBe(1); // 1 critting pair
        expect(critHitsA).toBeGreaterThan(critHitsB!);
    });

    /**
     * Regression guard: a disadvantaged covered victim that does NOT crit (affinity cap 0.75,
     * rng=0.9 → 0.9<0.75 is false) reduces critHits compared to when it DOES crit (rng=0 → 0<0.75).
     * This proves critHits reflects per-victim crit outcomes, not a blanket anchor-only count.
     */
    it('critHits reflects per-victim affinity-capped crit: disadvantaged non-critter reduces count', () => {
        const bloodthirstAbility: Ability = {
            id: 'bloodthirst-test-2',
            type: 'heal',
            target: 'self',
            trigger: 'on-crit',
            conditions: [],
            procChance: 0.2,
            config: { type: 'heal', pct: 20, basis: 'damage-dealt' },
        };

        const mixedEnemies = [
            passiveEnemy('e-anchor', 'M4', 'antimatter'), // neutral → always crits
            passiveEnemy('e-covered', 'M3', 'thermal'), // disadvantaged → cap 0.75
        ];

        // rng=0.9 → anchor crits (rate 1.0), covered does NOT crit (rate 0.75)
        // Per-victim crit gates carry `${victimId}:active-crit` stream keys (SP-0), so a bare
        // `setRateGateRng` override is bypassed by the keyed test provider — set BOTH so the
        // shared constant draw actually reaches every gate this test depends on. (The second
        // branch below doesn't need this: `resetRateGateRng()` nulls the keyed provider, so
        // every gate falls back to the plain `rng()` override regardless of its stream key.)
        setRateGateRng(() => 0.9);
        setKeyedRng(() => 0.9);
        const perfMiss = collectAbilityPerformed(baseInput([bloodthirstAbility], mixedEnemies));
        expect(perfMiss.length).toBeGreaterThan(0);
        const critHitsMiss = perfMiss[0].critHits ?? 0;

        resetRateGateRng();
        // rng=0 → anchor crits (rate 1.0), covered ALSO crits (rate 0.75 → 0<0.75)
        setRateGateRng(() => 0);
        const perfBoth = collectAbilityPerformed(baseInput([bloodthirstAbility], mixedEnemies));
        expect(perfBoth.length).toBeGreaterThan(0);
        const critHitsBoth = perfBoth[0].critHits ?? 0;

        // When the covered victim crits too, critHits is higher — a payload identity signal, not a
        // proc-roll count (Bloodthirst's on-crit enqueue no longer scales off critHits, see above).
        expect(critHitsMiss).toBe(1); // only anchor critted
        expect(critHitsBoth).toBe(2); // both critted
        expect(critHitsBoth).toBeGreaterThan(critHitsMiss);
    });
});

// ---------------------------------------------------------------------------
// 2. REACTIVE WARD — per-victim attacked event carries victim's own didCrit
// ---------------------------------------------------------------------------

describe('per-victim crit consumers — Reactive Ward / per-victim attacked.didCrit (Task 6)', () => {
    afterEach(() => resetRateGateRng());

    /**
     * Reactive Ward reads `attacked.didCrit` to decide whether to cleanse 1 or 2 debuffs.
     * The engine emits a per-victim `attacked` event for each AoE footprint victim, each
     * carrying THAT victim's own crit outcome via `hitOutcomes` (see emitPerVictimAttacked.ts).
     *
     * Fixture: attacker (chemical, crit 100) fires a whole-team AoE.
     *   - ANCHOR (M4, antimatter): neutral → rate 1.0 → crits at rng=0.9 → attacked.didCrit=true.
     *   - COVERED (M3, thermal): disadvantaged → rate 0.75 → does NOT crit at rng=0.9
     *     → attacked.didCrit absent/falsy.
     *
     * The Ward-carrying covered victim's `attacked` event must carry its OWN crit outcome, NOT
     * the anchor's. Pre-wiring: the covered victim shared the anchor's crit (both would have
     * didCrit=true) — this test would FAIL on the pre-wiring engine.
     */
    it('per-victim attacked event carries the victim own didCrit (not the anchor)', () => {
        // Per-victim crit gates carry `${victimId}:active-crit` stream keys (SP-0), so a bare
        // `setRateGateRng` override is bypassed by the keyed test provider — set BOTH so the
        // shared constant draw actually reaches every gate this test depends on.
        setRateGateRng(() => 0.9);
        setKeyedRng(() => 0.9);

        const attacked = collectAttacked(
            baseInput(
                [],
                [
                    passiveEnemy('anchor', 'M4', 'antimatter'), // neutral → crits
                    passiveEnemy('ward-carrier', 'M3', 'thermal'), // disadvantaged → does NOT crit
                ]
            )
        );

        // The engine emits one `attacked` event per victim (per hit).
        // targetId on the attacked event is the raw actor id (no e: prefix in runCombat path).
        const anchorAttacked = attacked.find((e) => e.targetId === 'anchor');
        const wardAttacked = attacked.find((e) => e.targetId === 'ward-carrier');

        expect(anchorAttacked).toBeDefined();
        expect(wardAttacked).toBeDefined();

        // Anchor critted → its attacked event carries didCrit=true.
        expect(anchorAttacked!.didCrit).toBe(true);

        // Ward carrier did NOT crit (disadvantaged, rng=0.9) → attacked.didCrit is absent/falsy.
        // A Reactive Ward listening on this event sees the VICTIM'S OWN crit outcome → cleanses 1
        // debuff (not 2). Pre-wiring: this would be true (shared anchor crit) — the fix delivers
        // the CORRECT per-victim signal.
        expect(wardAttacked!.didCrit).toBeFalsy();
    });

    /**
     * Control: when the covered victim is also NEUTRAL (antimatter), it ALSO crits at rng=0.9.
     * Both victims' `attacked` events carry didCrit=true. Proves the per-victim path correctly
     * delivers didCrit=true to covered-slot victims when they earn it — not a blanket suppression.
     */
    it('control: both victims neutral → both attacked events carry didCrit=true', () => {
        setRateGateRng(() => 0.9);

        const attacked = collectAttacked(
            baseInput(
                [],
                [
                    passiveEnemy('anchor', 'M4', 'antimatter'), // neutral → crits
                    passiveEnemy('covered', 'M3', 'antimatter'), // neutral → also crits
                ]
            )
        );

        const anchorAttacked = attacked.find((e) => e.targetId === 'anchor');
        const coveredAttacked = attacked.find((e) => e.targetId === 'covered');

        expect(anchorAttacked).toBeDefined();
        expect(coveredAttacked).toBeDefined();

        // Both neutral → both crit → both attacked.didCrit should be true.
        expect(anchorAttacked!.didCrit).toBe(true);
        expect(coveredAttacked!.didCrit).toBe(true);
    });

    /**
     * Three-victim AoE (anchor + 2 covered) where only the anchor crits (rng=0.9):
     * anchor attacked.didCrit=true; both covered victims attacked.didCrit absent/falsy.
     * Extends the two-victim case to a full line.
     */
    it('three-victim AoE: anchor crits, two thermal covered victims do NOT crit', () => {
        // Per-victim crit gates carry `${victimId}:active-crit` stream keys (SP-0), so a bare
        // `setRateGateRng` override is bypassed by the keyed test provider — set BOTH so the
        // shared constant draw actually reaches every gate this test depends on.
        setRateGateRng(() => 0.9);
        setKeyedRng(() => 0.9);

        const attacked = collectAttacked(
            baseInput(
                [],
                [
                    passiveEnemy('front', 'M4', 'antimatter'), // neutral → crits
                    passiveEnemy('mid', 'M3', 'thermal'), // disadvantaged → no crit
                    passiveEnemy('back', 'M2', 'thermal'), // disadvantaged → no crit
                ]
            )
        );

        const frontA = attacked.find((e) => e.targetId === 'front');
        const midA = attacked.find((e) => e.targetId === 'mid');
        const backA = attacked.find((e) => e.targetId === 'back');

        expect(frontA).toBeDefined();
        expect(midA).toBeDefined();
        expect(backA).toBeDefined();

        expect(frontA!.didCrit).toBe(true);
        expect(midA!.didCrit).toBeFalsy();
        expect(backA!.didCrit).toBeFalsy();
    });
});

// ---------------------------------------------------------------------------
// 3. MENACE — amplification applies per victim based on per-victim crit outcome
// ---------------------------------------------------------------------------

describe('per-victim crit consumers — Menace outgoing amplification (Task 6)', () => {
    afterEach(() => resetRateGateRng());

    /**
     * Menace is an `outgoing-amplification` ability with `condition: 'amplify-on-crit'`.
     * `outgoingAmplificationFor(victim, didCrit)` is called per footprint victim in
     * `applyPositionalDamage` with THAT victim's crit outcome (the per-victim seam).
     *
     * When `didCrit=false`, `conditionMet` returns false and the proc is never attempted → zero amp.
     * When `didCrit=true`, the proc gate fires (procChance=1.0 to make it deterministic) → +ampPct.
     *
     * Fixture: attacker (chemical, crit 100, rng=0.9) fires a whole-team AoE.
     *   - ANCHOR (M4, antimatter): neutral → crits → Menace condition met → proc gate fires
     *     (procChance=1.0, 0.9<1.0 → fires) → damage amplified by +45%.
     *   - COVERED (M3, thermal): disadvantaged → does NOT crit → Menace condition NOT met
     *     → proc never attempted → NO amplification.
     *
     * Observation: compare anchor damage (with-Menace vs control) and covered damage (same).
     * WITH Menace: anchor.damage ≈ control_anchor × 1.45; covered.damage ≈ control_covered × 1.0.
     */
    it('Menace amplifies critting anchor but NOT the non-critting covered victim', () => {
        // procChance=1.0 makes Menace deterministic: fires whenever condition is met (crit=true).
        // At rng=0.9: anchor crits (rate 1.0, 0.9<1.0) → proc fires (1.0, 0.9<1.0).
        //             covered doesn't crit → condition not met → proc not attempted.
        const menaceAbility: Ability = {
            id: 'menace-deterministic',
            type: 'outgoing-amplification',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'outgoing-amplification',
                condition: 'amplify-on-crit',
                ampPct: 45, // legendary Menace
                procChance: 1.0, // deterministic: always fires when condition (didCrit) is met
            },
        };

        const enemies = [
            passiveEnemy('anchor', 'M4', 'antimatter'), // crits at rng=0.9
            passiveEnemy('covered', 'M3', 'thermal'), // does NOT crit at rng=0.9
        ];

        // Per-victim crit gates carry `${victimId}:active-crit` stream keys (SP-0), so a bare
        // `setRateGateRng` override is bypassed by the keyed test provider — set BOTH so the
        // shared constant draw actually reaches every gate this test depends on, in BOTH runs.
        setRateGateRng(() => 0.9);
        setKeyedRng(() => 0.9);
        const menaceAttacked = collectAttacked(baseInput([menaceAbility], enemies));

        setRateGateRng(() => 0.9);
        setKeyedRng(() => 0.9);
        const controlAttacked = collectAttacked(baseInput([], enemies));

        const menaceAnchor = menaceAttacked.find((e) => e.targetId === 'anchor');
        const menaceCovered = menaceAttacked.find((e) => e.targetId === 'covered');
        const controlAnchor = controlAttacked.find((e) => e.targetId === 'anchor');
        const controlCovered = controlAttacked.find((e) => e.targetId === 'covered');

        expect(menaceAnchor).toBeDefined();
        expect(menaceCovered).toBeDefined();
        expect(controlAnchor).toBeDefined();
        expect(controlCovered).toBeDefined();

        const menaceAnchorDmg = menaceAnchor!.damage ?? 0;
        const menaceCoveredDmg = menaceCovered!.damage ?? 0;
        const controlAnchorDmg = controlAnchor!.damage ?? 0;
        const controlCoveredDmg = controlCovered!.damage ?? 0;

        expect(menaceAnchorDmg).toBeGreaterThan(0);
        expect(menaceCoveredDmg).toBeGreaterThan(0);
        expect(controlAnchorDmg).toBeGreaterThan(0);
        expect(controlCoveredDmg).toBeGreaterThan(0);

        // Core assertion A: anchor's damage is amplified by Menace (critted → condition met → proc fired).
        // Ratio should be ~1.45 (the 45% amp factor).
        expect(menaceAnchorDmg).toBeGreaterThan(controlAnchorDmg);
        expect(menaceAnchorDmg / controlAnchorDmg).toBeCloseTo(1.45, 1);

        // Core assertion B: covered victim's damage is NOT amplified (no crit → condition not met).
        // Ratio should be ~1.0 (no change).
        expect(menaceCoveredDmg / controlCoveredDmg).toBeCloseTo(1.0, 1);

        // Regression guard: Menace does NOT bleed into the non-critting victim.
        // The covered victim's damage must be essentially identical in both runs.
        expect(Math.abs(menaceCoveredDmg - controlCoveredDmg)).toBeLessThan(1);
    });

    /**
     * Control for Menace: when BOTH victims crit (rng=0, all gates fire), both get amplified.
     * This proves the amp fires for the covered slot too when it earns a crit — not a blanket
     * suppression of the covered position.
     */
    it('control: when both victims crit (rng=0), Menace amplifies both', () => {
        const menaceAbility: Ability = {
            id: 'menace-ctrl',
            type: 'outgoing-amplification',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'outgoing-amplification',
                condition: 'amplify-on-crit',
                ampPct: 45,
                procChance: 1.0,
            },
        };

        const enemies = [
            passiveEnemy('anchor', 'M4', 'antimatter'), // crits (rate 1.0)
            passiveEnemy('covered', 'M3', 'antimatter'), // neutral → also crits (rate 1.0) at rng=0
        ];

        setRateGateRng(() => 0);
        const menaceAttacked = collectAttacked(baseInput([menaceAbility], enemies));
        setRateGateRng(() => 0);
        const controlAttacked = collectAttacked(baseInput([], enemies));

        const menaceAnchorDmg = menaceAttacked.find((e) => e.targetId === 'anchor')?.damage ?? 0;
        const menaceCoveredDmg = menaceAttacked.find((e) => e.targetId === 'covered')?.damage ?? 0;
        const controlAnchorDmg = controlAttacked.find((e) => e.targetId === 'anchor')?.damage ?? 0;
        const controlCoveredDmg =
            controlAttacked.find((e) => e.targetId === 'covered')?.damage ?? 0;

        // Both victims crit → both get Menace amplification → both ratios ≈ 1.45.
        expect(menaceAnchorDmg / controlAnchorDmg).toBeCloseTo(1.45, 1);
        expect(menaceCoveredDmg / controlCoveredDmg).toBeCloseTo(1.45, 1);
    });
});

// ---------------------------------------------------------------------------
// 4. noCrit guard — a noCrit AoE never crits ANY victim (anchor OR covered)
// ---------------------------------------------------------------------------

describe('per-victim crit consumers — noCrit AoE guard (CodeRabbit #183)', () => {
    afterEach(() => resetRateGateRng());

    /** A whole-team AoE attack flagged noCrit (e.g. a guaranteed-non-crit hit). */
    function noCritAttackSlot(): ShipSkills['slots'][number] {
        return {
            slot: 'active',
            abilities: [
                {
                    id: 'dmg-nocrit',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100, noCrit: true },
                },
            ],
        };
    }

    /**
     * Regression for the per-victim crit seam: before the fix, covered (non-anchor) victims
     * resolved crit via `rollVictimCrit`, which ignored the attack's `noCrit` flag — so a
     * noCrit AoE could still crit covered victims (and, worse, advance the crit RNG for them,
     * desyncing the schedule). The anchor was already safe (drawHits=0 → hitCrits empty).
     *
     * With rng=0 EVERY rate-gate would fire, so any un-guarded roll WOULD crit. We assert that
     * neither anchor nor covered crits, and the ability-performed critHits is 0.
     */
    it('noCrit AoE never crits any victim even when rng=0 (all gates would fire)', () => {
        const enemies = [
            passiveEnemy('anchor', 'M4', 'antimatter'), // neutral — would crit if allowed
            passiveEnemy('covered', 'M3', 'antimatter'), // neutral — the previously-buggy slot
        ];

        // Build a noCrit variant of the base input (swap the active slot).
        const base = baseInput([], enemies);
        const noCritInput: CombatEngineInput = {
            ...base,
            shipSkills: { slots: [noCritAttackSlot()] },
        };

        setRateGateRng(() => 0); // all gates fire → any unguarded crit roll would succeed

        const attacked = collectAttacked(noCritInput);
        const anchor = attacked.find((e) => e.targetId === 'anchor');
        const covered = attacked.find((e) => e.targetId === 'covered');

        expect(anchor).toBeDefined();
        expect(covered).toBeDefined();
        // Both took damage but NEITHER critted.
        expect(anchor!.damage ?? 0).toBeGreaterThan(0);
        expect(covered!.damage ?? 0).toBeGreaterThan(0);
        expect(anchor!.didCrit).toBeFalsy();
        expect(covered!.didCrit).toBeFalsy();

        // ability-performed reports zero critting pairs.
        const perf = collectAbilityPerformed(noCritInput);
        expect(perf.length).toBeGreaterThan(0);
        expect(perf[0].critHits ?? 0).toBe(0);
    });
});
