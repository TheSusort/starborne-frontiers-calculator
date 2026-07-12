/**
 * D-PR1: end-to-end engine integration — Leech standing leech + Bloodthirst proc frequency.
 *
 * Both tests use `buildShipAbilitiesWithEquipment` with a stub `getGearPiece`, exercising the
 * real resolution→merge→engine path (Tasks 2+3+engine pickup), not just ability injection.
 *
 * Leech (standing leech):
 *   The Leech set ability has trigger 'on-cast', so it stays in castSkills after the
 *   reactive partition and is picked up by the standing-leech scan (engine.ts ~2037-2057).
 *   With attackerHealModifier=0, noCrit:true on the ability, and 1 round of damage D,
 *   the credited directHeal is exactly 0.15 × D.
 *
 * Bloodthirst (reactive on-crit heal):
 *   The Bloodthirst ability has trigger 'on-crit', so it routes to reactiveAbilities →
 *   registered as a listener that fires once per critting hit. procChance 0.20 over 10
 *   rounds (1 crit/round) → floor(10 × 0.20) = 2 fires (accumulator back-loaded: rounds
 *   5 and 10 — acc accumulates 0.20 per crit and first crosses 1.0 on the 5th call).
 *   basis 'damage-dealt': the reactive executor now resolves this as the triggering hit's
 *   damage (eventCtx.triggerDamage), captured from ability-performed.damage on the on-crit
 *   listener. Crit damage computation: attack=5000, multiplier=100%, critDamage=0,
 *   enemyDefense=0 → directDamage = 5000 * 1.0 * 1.0 = 5000. Each fire: pct=20 →
 *   directHeal = 5000 × 0.20 = 1000. 2 fires → 2000 total.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { setRateGateRng, setKeyedRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { CombatActor } from '../state';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { buildShipAbilitiesWithEquipment } from '../../abilities/buildShipAbilitiesWithEquipment';
import { buildEquipmentAbilities } from '../../abilities/buildEquipmentAbilities';
import { deriveTeamEngineActors } from '../../calculators/dpsSimulator';
import { simulateBattle, BattlePlacement } from '../../calculators/battleSimulator';
import { modifierTotalsFromAbilities } from '../../abilities/applyAbilities';
import { makeConditionContext } from '../../abilities/__tests__/conditionContextFixture';
import { SelectedGameBuff, TeamActorInput } from '../../../types/calculator';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import { flattenCombatLog } from '../log/__testutils__/flattenCombatLog';

// ---------------------------------------------------------------------------
// Shared test harness helpers
// ---------------------------------------------------------------------------

/** Minimal Ship stub. Equipment and implants are provided by overrides. */
function makeShip(over: Partial<Ship>): Ship {
    return {
        id: 'test-ship',
        name: 'Test Ship',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'ATTACKER',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: {},
        refits: [],
        ...over,
    } as Ship;
}

/** Minimal GearPiece stub. */
function makePiece(over: Partial<GearPiece>): GearPiece {
    return {
        id: 'piece-1',
        slot: 'weapon',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: null,
        subStats: [],
        setBonus: null,
        ...over,
    } as GearPiece;
}

/** getGearPiece factory backed by an id→GearPiece map. */
function makeGetGearPiece(map: Record<string, GearPiece>): (id: string) => GearPiece | undefined {
    return (id) => map[id];
}

/** Sum a heal bucket over all rounds for the given actor (default: 'attacker'). */
function sumHeal(
    result: ReturnType<typeof runCombat>,
    bucket: 'directHeal' | 'effectiveHeal' | 'overheal',
    actorId = 'attacker'
): number {
    return (result.healing?.rounds ?? []).reduce(
        (sum, rd) => sum + (rd.perActor.get(actorId)?.[bucket] ?? 0),
        0
    );
}

/** Base engine input: neutral stats, enemy never dies, healing mode on (focus is target). */
const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    enemyDefense: 0,
    enemyHp: 10_000_000,
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
    defence: 2000,
    hp: 10_000,
    healTargetId: 'attacker',
    ...overrides,
});

// ---------------------------------------------------------------------------
// RNG forcing helper — recovers the legacy back-loaded accumulator schedule.
//
// The gate now fires iff `rng() < rate`. These integration tests were written
// against the OLD deterministic accumulator (acc += rate each call; fires when
// acc >= 1, i.e. on the floor((n)·rate) > floor((n-1)·rate) calls). To preserve
// their exact intent we install an RNG that reproduces that schedule for ONE
// "gate of interest" (the proc gate under test) while letting every OTHER draw
// always fire (value 0 → fires any rate, e.g. the always-on crit:100 gate).
//
// Draws alternate per round: the probe shows the engine issues the crit-gate
// draw first, then the proc-gate draw. So the proc gate is every `everyN`-th
// draw at the given 1-based `offset`. For the gate-of-interest draws we run a
// local accumulator at `rate` and return 0 (fire) on cross, 0.99 (no fire)
// otherwise. ORDER-SENSITIVE: relies on the probed per-round draw interleave.
// ---------------------------------------------------------------------------
function installBackloadedAccumulator(opts: {
    rate: number;
    isGateOfInterest: (drawIdx: number) => boolean; // drawIdx is 1-based
    nonGate?: number; // value returned for non-target draws (default 0 → fires crit:100)
}): void {
    let drawIdx = 0;
    let acc = 0;
    const EPS = 1e-9;
    const nonGate = opts.nonGate ?? 0;
    setRateGateRng(() => {
        drawIdx += 1;
        if (!opts.isGateOfInterest(drawIdx)) return nonGate;
        acc += opts.rate;
        if (acc >= 1 - EPS) {
            acc -= 1;
            return 0; // fire
        }
        return 0.99; // no fire
    });
}

// ---------------------------------------------------------------------------
// Gear stubs shared across tests
// ---------------------------------------------------------------------------

const leechPieceA = makePiece({ id: 'leech-1', slot: 'weapon', setBonus: 'LEECH' });
const leechPieceB = makePiece({ id: 'leech-2', slot: 'hull', setBonus: 'LEECH' });
const bloodthirstPiece = makePiece({
    id: 'bt-legendary',
    slot: 'implant_major',
    rarity: 'legendary',
    setBonus: 'BLOODTHIRST',
});

// ---------------------------------------------------------------------------
// Test 1: Leech set standing leech — full end-to-end
// ---------------------------------------------------------------------------

describe('D-PR1 integration — Leech set standing leech', () => {
    /**
     * Setup:
     *   - Ship equipped with 2 LEECH-set pieces (activates the Leech set ability via buildEquipmentAbilities).
     *   - buildShipAbilitiesWithEquipment merges the Leech ability into the passive slot.
     *   - Active slot: a single-hit damage ability with multiplier 100 (attack 5000 → damage 5000).
     *   - healModifier: 0 (so raw = pct × damage, no further folds).
     *   - Leech ability config: pct 15, basis 'damage-dealt', noCrit:true.
     *   - Expected directHeal = 0.15 × 5000 = 750.
     *
     * The standing-leech scan (engine.ts ~2037) reads from the attacker's castSkills passive slot.
     * Because the Leech ability has trigger 'on-cast' (NOT in LIVE_TRIGGERS), it stays in castSkills
     * after the reactive partition and IS picked up. This test exercises that full path.
     */
    it('Leech set: standing leech credits directHeal = 0.15 × damage (full build→merge→engine path)', () => {
        const ship = makeShip({
            equipment: { weapon: 'leech-1', hull: 'leech-2' },
        });
        const getGearPiece = makeGetGearPiece({
            'leech-1': leechPieceA,
            'leech-2': leechPieceB,
        });

        // Real resolution+merge path: tasks 2+3.
        const baseSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece);

        // Verify the Leech ability landed in the passive slot (pre-condition).
        const passive = baseSkills.slots.find((s) => s.slot === 'passive');
        expect(passive).toBeDefined();
        const leechAbility = passive!.abilities.find((a) => a.id === 'equip-set-LEECH');
        expect(leechAbility).toBeDefined();

        // Append a damage active so the attacker deals damage that the standing leech can latch onto.
        const shipSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'dmg-active',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 100, hits: 1 },
                        },
                    ],
                },
                // Carry over the full passive slot (Leech + any ship own passives).
                ...(passive ? [{ slot: passive.slot, abilities: passive.abilities }] : []),
            ],
        };

        // attack 5000, mult 100, enemyDefense 0 → direct damage = 5000.
        // Leech: 15% of 5000 = 750. healModifier 0, noCrit:true → directHeal = 750.
        const D = 5000;
        const result = runCombat(
            BASE({
                attack: D,
                crit: 0,
                critDamage: 0,
                healModifier: 0,
                numRounds: 1,
                hp: 10_000,
                shipSkills,
            })
        );

        expect(result.healing).toBeDefined();
        // directHeal must equal 15% of direct damage dealt.
        expect(sumHeal(result, 'directHeal')).toBeCloseTo(0.15 * D, 6);
        // Full HP → all overheal, no effectiveHeal.
        expect(sumHeal(result, 'effectiveHeal')).toBeCloseTo(0, 6);
        expect(sumHeal(result, 'overheal')).toBeCloseTo(0.15 * D, 6);
    });
});

// ---------------------------------------------------------------------------
// Test 2: Bloodthirst implant (legendary) — proc frequency + per-fire amount
// ---------------------------------------------------------------------------

describe('D-PR1 integration — Bloodthirst implant proc frequency', () => {
    afterEach(() => resetRateGateRng());

    /**
     * Setup:
     *   - Ship equipped with legendary Bloodthirst implant (procChance 0.20, pct 20).
     *   - buildShipAbilitiesWithEquipment merges the on-crit reactive ability into the passive slot.
     *   - Active slot: 1-hit damage ability. crit 100 → 1 crit per round for 10 rounds.
     *   - procChance 0.20 → accumulator fires floor(10×0.20)=2 times (back-loaded: rounds 5, 10).
     *     The rateAccumulator starts at 0 and accumulates +0.20 per qualifying crit. It fires
     *     when acc >= 1: first fire at call 5 (acc 0.2→0.4→0.6→0.8→1.0), second at call 10.
     *   - Each fire: basis 'damage-dealt' now resolves as the triggering hit's damage
     *     (eventCtx.triggerDamage, captured from ability-performed.damage). Crit damage:
     *     attack=5000, multiplier=100%, critDamage=0, enemyDefense=0 → directDamage=5000.
     *     pct=20 → raw = 5000 × 0.20 = 1000. healModifier 0 → directHeal per fire = 1000.
     *   - Total directHeal over 10 rounds = 2 × 1000 = 2000.
     *
     * Two assertions:
     *   (a) fire count = 2 and fires on rounds 5 and 10 (back-loaded accumulator schedule).
     *   (b) summed directHeal = 2000.
     */
    it('Bloodthirst legendary: fires floor(10 × 0.20)=2 times over 10 crits; total directHeal = 2×1000', () => {
        // Per round the engine draws crit (draw 1,3,5,… always-fire crit:100) then the
        // Bloodthirst proc gate (draws 2,4,6,…). Reproduce the legacy rate-0.2 back-loaded
        // accumulator on the proc gate → fires on rounds 5 and 10.
        installBackloadedAccumulator({ rate: 0.2, isGateOfInterest: (d) => d % 2 === 0 });
        const ship = makeShip({
            implants: { implant_major: 'bt-legendary' },
        });
        const getGearPiece = makeGetGearPiece({ 'bt-legendary': bloodthirstPiece });

        // Real resolution+merge path: tasks 2+3.
        const baseSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece);

        // Verify the Bloodthirst ability landed in the passive slot (pre-condition).
        const passive = baseSkills.slots.find((s) => s.slot === 'passive');
        expect(passive).toBeDefined();
        const btAbility = passive!.abilities.find((a) =>
            a.id.startsWith('equip-implant-BLOODTHIRST')
        );
        expect(btAbility).toBeDefined();
        expect(btAbility!.procChance).toBeCloseTo(0.2);

        // Append a damage active. crit 100 → every hit crits → on-crit listener fires once/round.
        const shipSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'dmg-active',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 100, hits: 1 },
                        },
                    ],
                },
                ...(passive ? [{ slot: passive.slot, abilities: passive.abilities }] : []),
            ],
        };

        // Each reactive-heal fire: basis 'damage-dealt' → eventCtx.triggerDamage = directDamage.
        // attack=5000, multiplier=100%, critDamage=0, enemyDefense=0 → directDamage=5000.
        // pct 20 → raw = 5000 × 0.20 = 1000. procChance 0.20 over 10 crits → 2 fires.
        const critDamage = 5000; // attack 5000 × mult 1.0 × critMult 1.0 (critDamage=0) × noDefense
        const perFireAmount = critDamage * (20 / 100); // = 1000
        const expectedFires = Math.floor(10 * 0.2); // = 2
        const expectedTotal = expectedFires * perFireAmount; // = 2000

        const result = runCombat(
            BASE({
                attack: 5000,
                crit: 100,
                critDamage: 0,
                healModifier: 0,
                numRounds: 10,
                hp: 10_000,
                shipSkills,
            })
        );

        expect(result.healing).toBeDefined();
        expect(result.healing!.rounds).toHaveLength(10);

        // (b) total direct heal = 2000 (2 fires × 1000 per fire).
        expect(sumHeal(result, 'directHeal')).toBeCloseTo(expectedTotal, 6);

        // (a) fire count: back-loaded accumulator fires on rounds 5 and 10.
        const firedRounds = result
            .healing!.rounds.map((rd, i) => ({
                round: i + 1,
                heal: rd.perActor.get('attacker')?.directHeal ?? 0,
            }))
            .filter((r) => r.heal > 0);
        expect(firedRounds).toHaveLength(expectedFires);
        // NOTE: `installBackloadedAccumulator`'s `setRateGateRng` override is dead for this
        // gate under SP-0 — the Bloodthirst proc gate now carries an `${ownerId}:proc` stream
        // key (triggers.ts), and the keyed test provider (installed globally in
        // setupTests.ts) takes precedence over a bare `setRateGateRng` override whenever a key
        // is supplied. Left in place as historical intent documentation (originally scripted a
        // back-loaded rate-0.2 accumulator firing on rounds 5 and 10); the actual fire rounds
        // now come from the keyed `attacker:proc` sub-stream under the fixed test seed, which
        // instead fires on rounds 6 and 10 (still exactly 2 of 10, same total directHeal).
        expect(firedRounds[0].round).toBe(6);
        expect(firedRounds[1].round).toBe(10);
        // Each fire credits exactly perFireAmount.
        for (const r of firedRounds) {
            expect(r.heal).toBeCloseTo(perFireAmount, 6);
        }
    });
});

// ---------------------------------------------------------------------------
// D-PR2 — conditional outgoing-damage implants
// ---------------------------------------------------------------------------
//
// Three implants now live in the equipment-ability registry as passive `modifier`
// abilities with channel 'outgoingDamage'. These tests exercise the REAL fold path:
//   buildEquipmentAbilities → Ability[] → modifierTotalsFromAbilities(abilities, ctx)
// which is identical to the path the engine walks inside effectiveDamageStatsOf.
//
// Step 1 tests are FOLD-LEVEL (fast, deterministic): they prove the correct
// value is accumulated into totals.outgoingDamage for each implant.
// Step 2 is an ENGINE-LEVEL smoke-test for INTRUSION (the scaling implant):
// it runs the full runCombat pipeline and asserts directDamage amplification.

// ---------------------------------------------------------------------------
// Gear-piece stubs for the three D-PR2 implants
// ---------------------------------------------------------------------------

/** INTRUSION legendary: +5% outgoing damage per enemy debuff (value 0, perUnit 5). */
const intrusionPiece = makePiece({
    id: 'intrusion-legendary',
    slot: 'implant_major',
    rarity: 'legendary',
    setBonus: 'INTRUSION',
});

/** ARCANE_SIEGE epic: +15% outgoing damage while shielded (flat value 15). */
const arcaneSiegePiece = makePiece({
    id: 'arcane-siege-epic',
    slot: 'implant_minor',
    rarity: 'epic',
    setBonus: 'ARCANE_SIEGE',
});

/** WARPSTRIKE legendary: +5% outgoing damage while self-debuffed (flat, >=1 gate). */
const warpstrikePiece = makePiece({
    id: 'warpstrike-legendary',
    slot: 'implant_major',
    rarity: 'legendary',
    setBonus: 'WARPSTRIKE',
});

// ---------------------------------------------------------------------------
// Step 1: modifier-fold-level integration tests
// ---------------------------------------------------------------------------

describe('D-PR2 integration — INTRUSION fold (modifier-level)', () => {
    /**
     * INTRUSION legendary: value:0, scaling:{conditionIndex:0, perUnit:5}, condition: enemy-debuff.
     * The scaling condition has no countComparator → it is a BARE scaling source (gateConditions
     * strips it), so the ability folds unconditionally with bonus = enemyDebuffCount × perUnit.
     *
     * At enemyDebuffCount:3 → 0 + 3×5 = 15.
     * At enemyDebuffCount:0 → 0 + 0×5 = 0.
     */
    it('outgoingDamage === 15 when enemyDebuffCount:3 (legendary, 3×5%)', () => {
        const ship = makeShip({ implants: { implant_major: 'intrusion-legendary' } });
        const getGearPiece = makeGetGearPiece({ 'intrusion-legendary': intrusionPiece });
        const abilities = buildEquipmentAbilities(ship, getGearPiece);

        const intrusion = abilities.find((a) => a.id.startsWith('equip-implant-INTRUSION'));
        expect(intrusion).toBeDefined();

        const totals = modifierTotalsFromAbilities(
            [intrusion!],
            makeConditionContext({ enemyDebuffCount: 3 })
        );
        expect(totals.outgoingDamage).toBe(15); // 3 × 5
    });

    it('outgoingDamage === 0 when enemyDebuffCount:0 (no debuffs → zero bonus)', () => {
        const ship = makeShip({ implants: { implant_major: 'intrusion-legendary' } });
        const getGearPiece = makeGetGearPiece({ 'intrusion-legendary': intrusionPiece });
        const abilities = buildEquipmentAbilities(ship, getGearPiece);
        const intrusion = abilities.find((a) => a.id.startsWith('equip-implant-INTRUSION'));

        const totals = modifierTotalsFromAbilities(
            [intrusion!],
            makeConditionContext({ enemyDebuffCount: 0 })
        );
        expect(totals.outgoingDamage).toBe(0);
    });
});

describe('D-PR2 integration — WARPSTRIKE fold (modifier-level)', () => {
    /**
     * WARPSTRIKE legendary: flat value:5, condition: self-debuff >=1 (countComparator:'gte',
     * countThreshold:1). This condition HAS a countComparator, so gateConditions keeps it as
     * a GATE (not just a scaler). The flat value fires once (not per-debuff).
     *
     * Load-bearing assertion: with selfDebuffNames:['A','B'] (2 debuffs) → still === 5,
     * NOT 10. This proves the flat-value+gate choice (the value does NOT scale with count).
     */
    it('outgoingDamage === 5 when selfDebuffNames:["Burn"] (legendary, 1 debuff → flat value)', () => {
        const ship = makeShip({ implants: { implant_major: 'warpstrike-legendary' } });
        const getGearPiece = makeGetGearPiece({ 'warpstrike-legendary': warpstrikePiece });
        const abilities = buildEquipmentAbilities(ship, getGearPiece);
        const warpstrike = abilities.find((a) => a.id.startsWith('equip-implant-WARPSTRIKE'));
        expect(warpstrike).toBeDefined();

        const totals = modifierTotalsFromAbilities(
            [warpstrike!],
            makeConditionContext({ selfDebuffNames: ['Burn'] })
        );
        expect(totals.outgoingDamage).toBe(5);
    });

    it('outgoingDamage === 0 when selfDebuffNames:[] (no self-debuffs → gate fails)', () => {
        const ship = makeShip({ implants: { implant_major: 'warpstrike-legendary' } });
        const getGearPiece = makeGetGearPiece({ 'warpstrike-legendary': warpstrikePiece });
        const abilities = buildEquipmentAbilities(ship, getGearPiece);
        const warpstrike = abilities.find((a) => a.id.startsWith('equip-implant-WARPSTRIKE'));

        const totals = modifierTotalsFromAbilities(
            [warpstrike!],
            makeConditionContext({ selfDebuffNames: [] })
        );
        expect(totals.outgoingDamage).toBe(0);
    });

    it(
        'outgoingDamage === 5 (NOT 10) when selfDebuffNames:["A","B"] — ' +
            'flat value, not per-count (load-bearing: proves gate-not-scaler)',
        () => {
            const ship = makeShip({ implants: { implant_major: 'warpstrike-legendary' } });
            const getGearPiece = makeGetGearPiece({ 'warpstrike-legendary': warpstrikePiece });
            const abilities = buildEquipmentAbilities(ship, getGearPiece);
            const warpstrike = abilities.find((a) => a.id.startsWith('equip-implant-WARPSTRIKE'));

            const totals = modifierTotalsFromAbilities(
                [warpstrike!],
                makeConditionContext({ selfDebuffNames: ['A', 'B'] })
            );
            // Flat value gates once — does NOT scale with debuff count.
            expect(totals.outgoingDamage).toBe(5);
        }
    );
});

describe('D-PR2 integration — ARCANE_SIEGE fold (modifier-level)', () => {
    /**
     * ARCANE_SIEGE epic: flat value:15, condition: self-shield (derivable). The self-shield
     * condition returns selfShielded ? 1 : 0. With countComparator absent it gates on count > 0.
     */
    it('outgoingDamage === 15 when selfShielded:true (epic, +15% while shielded)', () => {
        const ship = makeShip({ implants: { implant_minor: 'arcane-siege-epic' } });
        const getGearPiece = makeGetGearPiece({ 'arcane-siege-epic': arcaneSiegePiece });
        const abilities = buildEquipmentAbilities(ship, getGearPiece);
        const arcaneSiege = abilities.find((a) => a.id.startsWith('equip-implant-ARCANE_SIEGE'));
        expect(arcaneSiege).toBeDefined();

        const totals = modifierTotalsFromAbilities(
            [arcaneSiege!],
            makeConditionContext({ selfShielded: true })
        );
        expect(totals.outgoingDamage).toBe(15);
    });

    it('outgoingDamage === 0 when selfShielded:false (gate fails — dormant without shield)', () => {
        const ship = makeShip({ implants: { implant_minor: 'arcane-siege-epic' } });
        const getGearPiece = makeGetGearPiece({ 'arcane-siege-epic': arcaneSiegePiece });
        const abilities = buildEquipmentAbilities(ship, getGearPiece);
        const arcaneSiege = abilities.find((a) => a.id.startsWith('equip-implant-ARCANE_SIEGE'));

        const totals = modifierTotalsFromAbilities(
            [arcaneSiege!],
            makeConditionContext({ selfShielded: false })
        );
        expect(totals.outgoingDamage).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Step 2: engine-level smoke test — INTRUSION amplifies direct damage end-to-end
// ---------------------------------------------------------------------------
//
// Assertion form used: QUALITATIVE (strictly more / exactly equal) rather than
// exact ratio. Reason: the exact per-round debuff count reaching modifierCtx
// depends on how many scheduled SelectedGameBuff entries resolve as "landed"
// active buffs on that specific round, which involves the status engine's
// application timing (recurring vs timed) and the landedEnemyDebuffs array
// accumulation. Computing the exact expected ratio would require reimplementing
// that pipeline here. The qualitative assertion is sufficient to confirm that
// (a) the INTRUSION passive ability is picked up by the engine's modifier fold,
// (b) non-zero enemyDebuffCount produces a positive outgoingDamage boost, and
// (c) the boost is absent when there are no debuffs.
// The Step 1 fold-level tests provide the exact quantitative coverage.

describe('D-PR2 integration — INTRUSION engine-level (outgoing damage amplified)', () => {
    /**
     * Minimal SelectedGameBuff stub for an enemy debuff. The parsedEffects only need
     * to be non-null (the debuff contribution that matters here is PRESENCE in the
     * landed-debuff count, not the buff's own numeric effects on damage).
     * skillDuration:'recurring' → the debuff is active every round without needing
     * a charge schedule (mirrors the "recurring" scheduling in the status engine).
     */
    function makeEnemyDebuff(name: string): SelectedGameBuff {
        return {
            id: `test-debuff-${name}`,
            buffName: name,
            stacks: 1,
            parsedEffects: {},
            isStackable: false,
            skillDuration: 'recurring',
            autoFilled: false,
        };
    }

    /** Single-hit 100% damage active shared between the Intrusion and bare ship-skills builders. */
    const dmgActiveAbility: Ability = {
        id: 'dmg-active',
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier: 100, hits: 1 },
    };

    /** Ship with legendary INTRUSION implant. Passive slot injected from buildShipAbilitiesWithEquipment. */
    function buildIntrusionShipSkills(): ShipSkills {
        const ship = makeShip({ implants: { implant_major: 'intrusion-legendary' } });
        const getGearPiece = makeGetGearPiece({ 'intrusion-legendary': intrusionPiece });
        const baseSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece);
        const passive = baseSkills.slots.find((s) => s.slot === 'passive');

        return {
            slots: [
                {
                    slot: 'active',
                    abilities: [dmgActiveAbility],
                },
                ...(passive ? [{ slot: passive.slot, abilities: passive.abilities }] : []),
            ],
        };
    }

    /** Ship with NO implant — bare damage active only. */
    const bareShipSkills: ShipSkills = {
        slots: [
            {
                slot: 'active',
                abilities: [dmgActiveAbility],
            },
        ],
    };

    it(
        'INTRUSION legendary: directDamage > bare when 3 enemy debuffs are active; ' +
            'directDamage === bare with no debuffs',
        () => {
            const ATTACK = 10_000;
            // Three recurring enemy debuffs — all land every round.
            const threeDebuffs = [
                makeEnemyDebuff('Corrosion'),
                makeEnemyDebuff('Inferno'),
                makeEnemyDebuff('Armor Break'),
            ];

            // Intrusion + debuffs present → modifier should boost outgoingDamage.
            const withIntrusionWithDebuffs = runCombat(
                BASE({
                    attack: ATTACK,
                    crit: 0,
                    critDamage: 0,
                    numRounds: 1,
                    enemyDebuffs: threeDebuffs,
                    shipSkills: buildIntrusionShipSkills(),
                })
            );

            // Bare (no Intrusion) + same debuffs → no modifier.
            const bareWithDebuffs = runCombat(
                BASE({
                    attack: ATTACK,
                    crit: 0,
                    critDamage: 0,
                    numRounds: 1,
                    enemyDebuffs: threeDebuffs,
                    shipSkills: bareShipSkills,
                })
            );

            // Intrusion + no debuffs → modifier is 0, same as bare.
            const withIntrusionNoDebuffs = runCombat(
                BASE({
                    attack: ATTACK,
                    crit: 0,
                    critDamage: 0,
                    numRounds: 1,
                    enemyDebuffs: [],
                    shipSkills: buildIntrusionShipSkills(),
                })
            );

            // Bare + no debuffs → baseline.
            const bareNoDebuffs = runCombat(
                BASE({
                    attack: ATTACK,
                    crit: 0,
                    critDamage: 0,
                    numRounds: 1,
                    enemyDebuffs: [],
                    shipSkills: bareShipSkills,
                })
            );

            // Qualitative assertion A: INTRUSION fires when debuffs are present.
            // Intrusion-equipped attacker MUST deal strictly more direct damage than bare.
            expect(withIntrusionWithDebuffs.rawTotals.direct).toBeGreaterThan(
                bareWithDebuffs.rawTotals.direct
            );

            // Qualitative assertion B: INTRUSION is dormant when no debuffs are present.
            // Direct damage must equal the bare baseline.
            expect(withIntrusionNoDebuffs.rawTotals.direct).toBe(bareNoDebuffs.rawTotals.direct);
        }
    );
});

// ---------------------------------------------------------------------------
// D-PR4 Task 9: Insidiousness implant — reactive damage on debuff-inflicted
// ---------------------------------------------------------------------------
//
// Insidiousness fires a reactive direct-damage proc when the owner inflicts a debuff.
// The proc fires at the stated procChance rate via the deterministic accumulator.
//
// Test strategy:
//   A. With debuff-applying active + Insidiousness passive:
//      - Each round, the debuff lands (application:'apply') → debuff-applied emitted
//        → on-debuff-inflicted listener fires → Insidiousness enqueued → proc-gated.
//      - procChance 0.5 over N rounds → floor(N × 0.5) reactive-damage procs credited
//        as directDamage. So withInsidiousness.rawTotals.direct > withoutInsidiousness.
//   B. Attacker with NO debuff active + same Insidiousness passive:
//      - No debuff-applied events → on-debuff-inflicted never fires → zero reactive damage.
//      - directDamage must equal the same damage-only active WITHOUT Insidiousness.
//
// Insidiousness used here: uncommon (procChance 0.12, multiplier 70) BUT we override the
// ability shape directly (injecting into the passive slot) to use procChance 0.5 for a
// deterministic 10-round test (floor(10 × 0.5) = 5 procs). multiplier 70 means each proc
// deals effectiveAttack × 0.70. With attack 4000 and affinityMult 1 → 2800 per proc.
// Over 20 rounds procChance 0.5 → floor(20 × 0.5) = 10 procs → 28_000 reactive total.
// The active is a bare-damage ability (multiplier 100, 1 hit, 20 rounds) → 4000 × 20 = 80_000.
// Expected total direct = 80_000 + 28_000 = 108_000.
//
// Note: the debuff-applying ability also emits debuff-applied each round (application:'apply'
// always lands). No primary damage from the debuff ability itself — multiplier left off.

describe('D-PR4 Task 9 integration — Insidiousness reactive damage fires on debuff-inflicted', () => {
    const ATTACK = 4_000;
    const NUM_ROUNDS = 20;
    const INSIDIOUSNESS_MULT = 70; // 70% damage per proc
    const INSIDIOUSNESS_PROC = 0.5;
    const PER_PROC = ATTACK * (INSIDIOUSNESS_MULT / 100); // 2800

    /** Single-hit 100% damage active (no debuff inflicted). */
    const dmgOnlyActive: Ability = {
        id: 'dmg-active',
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier: 100, hits: 1 },
    };

    /** Debuff-applying active: inflicts 'Corrosion'-named debuff each round (application 'apply'
     *  bypasses hacking/security so it always lands, emitting debuff-applied every round). */
    const debuffActive: Ability = {
        id: 'debuff-active',
        type: 'debuff',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'debuff',
            buffName: 'Corrosion',
            parsedEffects: {},
            stacks: 1,
            isStackable: false,
            application: 'apply',
            duration: 1,
        },
    };

    /** Insidiousness ability injected directly into passive slot (procChance 0.5, mult 70). */
    const insidiousnessAbility: Ability = {
        id: 'equip-implant-INSIDIOUSNESS',
        type: 'damage',
        target: 'enemy',
        trigger: 'on-debuff-inflicted',
        conditions: [],
        procChance: INSIDIOUSNESS_PROC,
        config: { type: 'damage', multiplier: INSIDIOUSNESS_MULT, hits: 1 },
        autoFilled: true,
    };

    /** Build ship skills: active abilities in active slot + insidiousness in passive slot. */
    function buildSkills(activeAbilities: Ability[], withInsidiousness: boolean): ShipSkills {
        return {
            slots: [
                { slot: 'active', abilities: activeAbilities },
                ...(withInsidiousness
                    ? [{ slot: 'passive' as const, abilities: [insidiousnessAbility] }]
                    : []),
            ],
        };
    }

    it(
        'A. Debuff-applying active + Insidiousness: reactive damage procs add to rawTotals.direct ' +
            '(13 procs × 2800 = 36400 on top of 80000 base damage)',
        () => {
            // With Insidiousness and debuff active: each round the debuff lands → on-debuff-inflicted
            // → Insidiousness fires at 0.5 rate → reactive-damage credited to direct.
            const withInsidiousness = runCombat(
                BASE({
                    attack: ATTACK,
                    crit: 0,
                    critDamage: 0,
                    numRounds: NUM_ROUNDS,
                    // Both a debuff-only (no damage) active AND a damage-only active so
                    // we have a stable base damage to compare against.
                    shipSkills: buildSkills([dmgOnlyActive, debuffActive], true),
                })
            );

            // Without Insidiousness but same actives: baseline (no reactive damage).
            const withoutInsidiousness = runCombat(
                BASE({
                    attack: ATTACK,
                    crit: 0,
                    critDamage: 0,
                    numRounds: NUM_ROUNDS,
                    shipSkills: buildSkills([dmgOnlyActive, debuffActive], false),
                })
            );

            // Qualitative: Insidiousness adds reactive damage on top of the base active damage.
            expect(withInsidiousness.rawTotals.direct).toBeGreaterThan(
                withoutInsidiousness.rawTotals.direct
            );

            // Quantitative: the reactive contribution must equal exactly ACTUAL_PROCS × PER_PROC.
            // NOTE: `EXPECTED_PROCS` (floor(20×0.5)=10, a "back-loaded accumulator" formula) is
            // stale under SP-0 — Insidiousness's on-debuff-inflicted proc gate now carries an
            // `${ownerId}:proc` stream key (triggers.ts), drawing from a real keyed
            // `attacker:proc` sub-stream under the fixed test seed, which fires 13 of 20 times
            // (a real Bernoulli(0.5) outcome, not the deterministic floor formula).
            const ACTUAL_PROCS = 13;
            const reactiveContribution =
                withInsidiousness.rawTotals.direct - withoutInsidiousness.rawTotals.direct;
            expect(reactiveContribution).toBeCloseTo(ACTUAL_PROCS * PER_PROC, 1);
        }
    );

    it(
        'B. Damage-only active + Insidiousness: no debuff-applied events → no reactive damage ' +
            '(same rawTotals.direct as bare damage-only)',
        () => {
            // Insidiousness present but active deals ONLY direct damage (no debuff-applied events).
            const withInsidiousnessNoDeb = runCombat(
                BASE({
                    attack: ATTACK,
                    crit: 0,
                    critDamage: 0,
                    numRounds: NUM_ROUNDS,
                    shipSkills: buildSkills([dmgOnlyActive], true),
                })
            );

            // Bare: same damage-only active, no Insidiousness.
            const bareNoDeb = runCombat(
                BASE({
                    attack: ATTACK,
                    crit: 0,
                    critDamage: 0,
                    numRounds: NUM_ROUNDS,
                    shipSkills: buildSkills([dmgOnlyActive], false),
                })
            );

            // Must be EQUAL: no debuffs applied → no reactive triggers → zero Insidiousness damage.
            expect(withInsidiousnessNoDeb.rawTotals.direct).toBe(bareNoDeb.rawTotals.direct);
        }
    );
});

// ---------------------------------------------------------------------------
// D-PR5: Second Wind implant — reactive self-heal on crit-received
// ---------------------------------------------------------------------------
//
// Second Wind fires a reactive self-heal when the OWNER receives a critting hit
// (trigger: 'on-attacked', triggerCritFilter: 'crit'). The heal basis is 'hp'
// (owner effective max HP). The ability is placed in the 'attacker' (healTarget)
// passive slot so HP-restore actually applies.
//
// Test A: crit attacker fires Second Wind at the gated rate.
//   - 'attacker' (hp 10000) carries Second Wind (procChance 0.5, pct 10, basis 'hp').
//   - enemyAttacker with crit 100 attacks the 'attacker' every round for 10 rounds.
//   - Each round: attacked event with didCrit:true → on-attacked + crit filter → enqueued.
//   - Rate gate 0.5 over 10 calls fires exactly 5 times (back-loaded: calls 2,4,6,8,10).
//   - Each fire: 10000 × 10% = 1000 directHeal. total = 5000.
//   - 'attacker' starts at full HP → effectiveHeal = 0, overheal = 5000.
//
// Test B: non-crit attacker — Second Wind never fires (crit filter).
//   - Same setup but enemyAttacker with crit 0 → no attacked events with didCrit:true.
//   - directHeal must be 0.
//
// NOTE: The Second Wind ability is injected DIRECTLY into the passive slot (not via the
// registry) to keep the integration test independent of the registry entry. The unit tests
// (buildEquipmentAbilities.test.ts) cover the registry. The injected ability shape matches
// the spec exactly (trigger, triggerCritFilter, basis, procChance) and exercises the real
// engine on-attacked reactive-heal path.

describe('D-PR5 integration — Second Wind reactive self-heal on crit-received', () => {
    afterEach(() => resetRateGateRng());
    const ATTACKER_HP = 10_000;
    const NUM_ROUNDS = 10;
    const SW_PROC = 0.5;
    // `installBackloadedAccumulator` (below) documents the historical rate-0.5 back-loaded
    // schedule (floor(10×0.5)=5 fires); under SP-0 the keyed `attacker:proc` sub-stream instead
    // fires 9 of 10 rounds (a real Bernoulli(0.5) outcome — see the test body for the trace).
    const EXPECTED_FIRES = 9;
    const PER_FIRE = ATTACKER_HP * (10 / 100); // 1000 (10% of max HP)
    const EXPECTED_TOTAL = EXPECTED_FIRES * PER_FIRE; // 9000

    /** Second Wind ability injected directly into passive slot (procChance 0.5 for determinism). */
    const secondWindAbility: Ability = {
        id: 'equip-implant-SECOND_WIND',
        type: 'heal',
        target: 'self',
        trigger: 'on-attacked',
        triggerCritFilter: 'crit',
        conditions: [],
        procChance: SW_PROC,
        config: { type: 'heal', pct: 10, basis: 'hp' },
        autoFilled: true,
    };

    /** No-op active for the 'attacker' (focus) — it deals no damage, just keeps the round cadence. */
    const noopActive: Ability = {
        id: 'noop-active',
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier: 0 },
    };

    /** ShipSkills with Second Wind in passive slot and a no-op active. */
    const shipSkillsWithSW: ShipSkills = {
        slots: [
            { slot: 'active', abilities: [noopActive] },
            { slot: 'passive', abilities: [secondWindAbility] },
        ],
    };

    /** ShipSkills without Second Wind (control). */
    const shipSkillsNoSW: ShipSkills = {
        slots: [{ slot: 'active', abilities: [noopActive] }],
    };

    /** A positioned enemy attacker that crits the 'attacker' (healTarget) every turn.
     *  Attack must be > 0 so the engine emits `attacked` events (the emit is gated on damage > 0). */
    function makeEnemyAttacker(critRate: number) {
        return {
            id: 'sw-enemy',
            stats: {
                attack: 1, // minimal attack so damage > 0 → attacked event is emitted
                crit: critRate,
                critDamage: 0,
                speed: 1,
                defence: 0,
                hp: 1_000_000_000,
            },
            chargeCount: 0,
            startCharged: false,
            shipSkills: {
                slots: [
                    {
                        slot: 'active' as const,
                        abilities: [
                            {
                                id: 'sw-enemy-hit',
                                type: 'damage' as const,
                                target: 'enemy' as const,
                                trigger: 'on-cast' as const,
                                conditions: [],
                                config: { type: 'damage' as const, multiplier: 100, hits: 1 },
                            },
                        ],
                    },
                ],
            } as ShipSkills,
        };
    }

    /** Base engine input for Second Wind integration: healing mode, 'attacker' is the healTarget. */
    const SW_BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: shipSkillsNoSW,
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds: NUM_ROUNDS,
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
        hp: ATTACKER_HP,
        healTargetId: 'attacker',
        ...overrides,
    });

    it(
        'A. Crit attacker: Second Wind fires 9 times (rate 0.5 × 10 crits); ' +
            'total directHeal = 9000, effectiveHeal = 0 (full HP → all overheal)',
        () => {
            // NOTE: `installBackloadedAccumulator`'s `setRateGateRng` override is dead for this
            // gate under SP-0 — the Second Wind proc gate now carries an `${ownerId}:proc`
            // stream key (triggers.ts), and the keyed test provider (installed globally in
            // setupTests.ts) takes precedence over a bare `setRateGateRng` override whenever a
            // key is supplied. Left in place as historical intent documentation (originally
            // scripted a back-loaded rate-0.5 accumulator firing on rounds 2,4,6,8,10); the
            // actual fire schedule now comes from the keyed `attacker:proc` sub-stream under
            // the fixed test seed, which instead fires 9 of 10 rounds (all but round 4).
            installBackloadedAccumulator({ rate: SW_PROC, isGateOfInterest: (d) => d % 3 === 0 });
            const result = runCombat(
                SW_BASE({
                    shipSkills: shipSkillsWithSW,
                    enemyAttackers: [makeEnemyAttacker(100)],
                })
            );

            expect(result.healing).toBeDefined();
            expect(result.healing!.rounds).toHaveLength(NUM_ROUNDS);

            // Verify the gated schedule: fires on rounds 1,2,3,5,6,7,8,9,10 (all but round 4).
            const firedRounds = result
                .healing!.rounds.map((rd, i) => ({
                    round: i + 1,
                    heal: rd.perActor.get('attacker')?.directHeal ?? 0,
                }))
                .filter((r) => r.heal > 0);
            // directHeal = 9 fires × (ATTACKER_HP × 10%) = 9 × 1000 = 9000.
            // basis 'hp' resolves to effectiveMaxHp (unchanged regardless of current HP).
            expect(sumHeal(result, 'directHeal')).toBeCloseTo(EXPECTED_TOTAL, 6);
            expect(firedRounds).toHaveLength(EXPECTED_FIRES);
            expect(firedRounds[0].round).toBe(1);
            expect(firedRounds[EXPECTED_FIRES - 1].round).toBe(NUM_ROUNDS);
            for (const r of firedRounds) {
                expect(r.heal).toBeCloseTo(PER_FIRE, 6);
            }
        }
    );

    it('B. Non-crit attacker: Second Wind (crit filter) never fires — directHeal = 0', () => {
        const result = runCombat(
            SW_BASE({
                shipSkills: shipSkillsWithSW,
                enemyAttackers: [makeEnemyAttacker(0)],
            })
        );

        expect(result.healing).toBeDefined();
        // No crits → no on-attacked+crit triggers → Second Wind never fires.
        expect(sumHeal(result, 'directHeal')).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// D-PR5 Task 6: heal-cast amplification fold (Nourishment / Vivacious)
// ---------------------------------------------------------------------------
//
// A heal-amplification ability in the CASTER's passive slot boosts the cast repair's
// raw when its condition is met at cast time. The fold multiplies the existing 6-factor
// `raw` by (1 + ampPct/100), so directHeal scales linearly with the boost.
//
// Harness shape (deterministic):
//   - The FOCUS actor ('attacker') is the HEALER. It is never attacked (the enemy drains
//     all of its damage into the heal target), so the healer's HP% stays at 100.
//   - The heal target is a TEAM actor ('tank'), set as healTargetId. The healer casts a
//     `target: 'ally'` repair, which routes to healing.targetId === 'tank'.
//   - An enemy attacker (faster than the healer) damages 'tank' at the round top, so by the
//     time the healer acts, the heal target's HP% is BELOW the healer's 100%.
//   - The repair basis is 'hp' → the raw equals the HEALER's effective max HP × pct, which
//     is CONSTANT regardless of the target's current HP. Only the amp CONDITION reads the
//     target/healer HP%, so directHeal_with / directHeal_without isolates the amp factor.
//
// selfHpPct (engine buildTurnArgs) = the ACTING actor's live HP% = the healer's 100.
// targetHpPct = the heal target's live HP% (healTargetHpPctNow()).

describe('D-PR5 integration — heal-cast amplification fold (Nourishment / Vivacious)', () => {
    afterEach(() => resetRateGateRng());
    const HEALER_HP = 10_000;
    const TANK_HP = 10_000;
    const HEAL_PCT = 10; // repair = HEALER_HP × 10% = 1000 per cast (basis 'hp', no other folds)
    const BASE_PER_CAST = HEALER_HP * (HEAL_PCT / 100); // 1000

    /** The healer's active repair, targeting an ally (routes to the heal target). noCrit so
     *  the heal crit gate never perturbs raw — the only variable is the amp factor. */
    const repairAlly: Ability = {
        id: 'repair-ally',
        type: 'heal',
        target: 'ally',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'heal', pct: HEAL_PCT, basis: 'hp', noCrit: true },
    };

    /** A passive-slot heal-amplification ability. */
    const healAmp = (
        condition: 'target-hp-below-self' | 'target-below-25',
        ampPct: number,
        procChance?: number
    ): Ability => ({
        id: `equip-implant-AMP-${condition}`,
        type: 'heal-amplification',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'heal-amplification',
            condition,
            ampPct,
            ...(procChance !== undefined ? { procChance } : {}),
        },
        autoFilled: true,
    });

    /** Healer ship skills: active repair + optional heal-amp passive. */
    const healerSkills = (ampAbility?: Ability): ShipSkills => ({
        slots: [
            { slot: 'active', abilities: [repairAlly] },
            ...(ampAbility ? [{ slot: 'passive' as const, abilities: [ampAbility] }] : []),
        ],
    });

    /** Team-actor heal target (the tank). Inert skills — it just receives the heal & enemy hits. */
    const tankActor = (speed: number): TeamActorEngineInput => ({
        id: 'tank',
        speed,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        walk: {
            shipSkills: { slots: [] },
            stats: {
                attack: 1,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: TANK_HP,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });

    /** An enemy attacker that damages the heal target ('tank') for `dmgPerRound` each round.
     *  attack === multiplier-scaled damage; speed high so it acts before the healer. */
    const enemyHitter = (dmgPerRound: number, speed = 1_000) => ({
        id: 'amp-enemy',
        stats: {
            attack: dmgPerRound,
            crit: 0,
            critDamage: 0,
            speed,
            defence: 0,
            hp: 1_000_000_000,
        },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active' as const,
                    abilities: [
                        {
                            id: 'amp-enemy-hit',
                            type: 'damage' as const,
                            target: 'enemy' as const,
                            trigger: 'on-cast' as const,
                            conditions: [],
                            config: { type: 'damage' as const, multiplier: 100, hits: 1 },
                        },
                    ],
                },
            ],
        } as ShipSkills,
    });

    /** Base input: healing mode, focus 'attacker' is the HEALER (slow), heal target is 'tank'. */
    const AMP_BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
        attack: 1,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: healerSkills(),
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
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
        defence: 0,
        hp: HEALER_HP,
        speed: 10, // healer is slow → acts AFTER the enemy hit each round
        healTargetId: 'tank',
        teamActors: [tankActor(20)], // tank also acts before the healer (inert)
        ...overrides,
    });

    // ── Control: no implant → byte-identical to the bare baseline ────────────────
    it('Control: no heal-amp implant → directHeal = base per-cast (1000), unchanged', () => {
        const result = runCombat(
            AMP_BASE({
                shipSkills: healerSkills(),
                enemyAttackers: [enemyHitter(3000)], // damage tank below healer, but no amp ability
            })
        );
        expect(result.healing).toBeDefined();
        expect(sumHeal(result, 'directHeal')).toBeCloseTo(BASE_PER_CAST, 6);
    });

    // ── Nourishment (deterministic, +30%) ────────────────────────────────────────
    it('Nourishment: target HP% BELOW healer → cast repair ×1.30', () => {
        // Enemy drops tank to 70% (< healer 100%) before the healer casts.
        const withAmp = runCombat(
            AMP_BASE({
                shipSkills: healerSkills(healAmp('target-hp-below-self', 30)),
                enemyAttackers: [enemyHitter(3000)],
            })
        );
        const without = runCombat(
            AMP_BASE({
                shipSkills: healerSkills(),
                enemyAttackers: [enemyHitter(3000)],
            })
        );
        const ampHeal = sumHeal(withAmp, 'directHeal');
        const baseHeal = sumHeal(without, 'directHeal');
        expect(baseHeal).toBeCloseTo(BASE_PER_CAST, 6);
        expect(ampHeal).toBeCloseTo(baseHeal * 1.3, 6);
    });

    it('Nourishment: target HP% NOT below healer → no boost (equals baseline)', () => {
        // No enemy → tank stays at 100%; healer at 100% → target-hp-below-self is FALSE.
        const withAmp = runCombat(
            AMP_BASE({
                shipSkills: healerSkills(healAmp('target-hp-below-self', 30)),
            })
        );
        const without = runCombat(AMP_BASE({ shipSkills: healerSkills() }));
        expect(sumHeal(withAmp, 'directHeal')).toBeCloseTo(sumHeal(without, 'directHeal'), 6);
        expect(sumHeal(withAmp, 'directHeal')).toBeCloseTo(BASE_PER_CAST, 6);
    });

    // ── Vivacious (proc'd, target-below-25) ──────────────────────────────────────
    it('Vivacious: target <25% HP → repair roughly doubles at the gated frequency', () => {
        const NUM_ROUNDS = 10;
        const VIV_PROC = 0.5;
        const VIV_AMP = 100; // +100% → ×2 when it fires
        // NOTE: `installBackloadedAccumulator`'s `setRateGateRng` override is dead for this gate
        // under SP-0 — the heal-amp proc gate now carries an `${ownerId}:proc` stream key
        // (triggers.ts), and the keyed test provider (installed globally in setupTests.ts)
        // takes precedence over a bare `setRateGateRng` override whenever a key is supplied.
        // Left in place as historical intent documentation (originally scripted a back-loaded
        // rate-0.5 accumulator firing exactly 5 of 10 casts); the actual fire count now comes
        // from the keyed `healer:proc` sub-stream under the fixed test seed, which instead
        // fires 8 of 10 casts (a real Bernoulli(0.5) outcome). The test sums total heal so only
        // the fire COUNT matters, not which specific casts fired.
        installBackloadedAccumulator({
            rate: VIV_PROC,
            isGateOfInterest: (d) => d === 4 || (d >= 7 && d % 2 === 1),
            nonGate: 0.99, // non-proc draws: enemy crit is rate 0 (never fires); no crit on the noCrit heal
        });
        // Enemy hits hard enough to keep tank below 25% (heal basis 'hp' restores only 1000/round
        // into a 10000 tank → with 8000 dmg/round the tank stays pinned far below 25%).
        const withAmp = runCombat(
            AMP_BASE({
                numRounds: NUM_ROUNDS,
                shipSkills: healerSkills(healAmp('target-below-25', VIV_AMP, VIV_PROC)),
                enemyAttackers: [enemyHitter(8000)],
            })
        );
        const without = runCombat(
            AMP_BASE({
                numRounds: NUM_ROUNDS,
                shipSkills: healerSkills(),
                enemyAttackers: [enemyHitter(8000)],
            })
        );
        const baseHeal = sumHeal(without, 'directHeal');
        const ampHeal = sumHeal(withAmp, 'directHeal');
        // Baseline: 10 casts × 1000 = 10000. With 8 proc'd ×2 fires: 2 normal + 8 doubled =
        // 2×1000 + 8×2000 = 18000.
        expect(baseHeal).toBeCloseTo(NUM_ROUNDS * BASE_PER_CAST, 6);
        const ACTUAL_FIRES = 8;
        const expectedAmp =
            NUM_ROUNDS * BASE_PER_CAST + ACTUAL_FIRES * BASE_PER_CAST * (VIV_AMP / 100);
        expect(ampHeal).toBeCloseTo(expectedAmp, 6);
        expect(ampHeal).toBeGreaterThan(baseHeal);
    });

    it('Vivacious: target ≥25% HP → never doubles (equals baseline)', () => {
        const NUM_ROUNDS = 5;
        // No enemy → tank stays at 100% (≥25%) → target-below-25 never met.
        const withAmp = runCombat(
            AMP_BASE({
                numRounds: NUM_ROUNDS,
                shipSkills: healerSkills(healAmp('target-below-25', 100, 0.5)),
            })
        );
        const without = runCombat(AMP_BASE({ numRounds: NUM_ROUNDS, shipSkills: healerSkills() }));
        expect(sumHeal(withAmp, 'directHeal')).toBeCloseTo(sumHeal(without, 'directHeal'), 6);
        expect(sumHeal(withAmp, 'directHeal')).toBeCloseTo(NUM_ROUNDS * BASE_PER_CAST, 6);
    });
});

// ---------------------------------------------------------------------------
// D-PR6 Task 6: Exuberance implant — recipient-side incoming-heal amplification fold
// ---------------------------------------------------------------------------
//
// Exuberance is a RECIPIENT-side, unconditional ("when repaired") incoming-heal
// amplification: each repair landing on the carrier rolls a combat-lifetime proc gate
// (keyed `${recipientId}:${abilityId}`); when it fires, the repair's raw is multiplied
// by (1 + ampPct/100). The gate is SHARED across every repair source the unit receives
// (one probability stream), so cast heals, reactive heals, and HoT ticks all draw from it.
//
// Harness shape (deterministic): the FOCUS actor ('attacker') is the HEALER AND the
// recipient — it self-casts a `target: 'self'` repair (basis 'hp' → raw = own max HP × pct,
// a CONSTANT per cast). Exuberance lives in its OWN passive slot, so the engine's
// incomingHealAmpAbilitiesById picks it up. With procChance 0.5 over N rounds the gate fires
// floor(N × 0.5) times (back-loaded: calls 2,4,6,8,10 for N=10), so exactly that many casts
// are boosted by ampPct, and the rest land at baseline.
//
// Because the basis is 'hp' (constant raw) and the cast is noCrit, the ONLY variable between
// the Exuberance and no-Exuberance runs is the amplification factor → the difference isolates
// EXACTLY (number of procs) × baseRaw × (ampPct/100).

describe('D-PR6 integration — Exuberance recipient-side incoming-heal amplification', () => {
    afterEach(() => resetRateGateRng());
    const SELF_HP = 10_000;
    const HEAL_PCT = 10; // self-repair = SELF_HP × 10% = 1000 per cast (basis 'hp', no other folds)
    const BASE_PER_CAST = SELF_HP * (HEAL_PCT / 100); // 1000
    const EXU_PROC = 0.5; // deterministic: floor(N × 0.5) procs (back-loaded calls 2,4,...)
    const EXU_AMP = 50; // +50% per boosted repair

    /** The actor's self-repair (basis 'hp' → constant raw; noCrit so the crit gate never perturbs). */
    const selfRepair: Ability = {
        id: 'self-repair',
        type: 'heal',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'heal', pct: HEAL_PCT, basis: 'hp', noCrit: true },
    };

    /** Exuberance passive ability (recipient-side incoming-heal amplification). */
    const exuberance = (ampPct: number, procChance: number): Ability => ({
        id: 'equip-implant-EXUBERANCE',
        type: 'incoming-heal-amplification',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'incoming-heal-amplification', ampPct, procChance },
        autoFilled: true,
    });

    /** Ship skills: self-repair active + optional Exuberance passive. */
    const skills = (exuAbility?: Ability): ShipSkills => ({
        slots: [
            { slot: 'active', abilities: [selfRepair] },
            ...(exuAbility ? [{ slot: 'passive' as const, abilities: [exuAbility] }] : []),
        ],
    });

    /** Base input: healing mode, focus 'attacker' is healer + recipient (self-heal). Never attacked. */
    const EXU_BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
        attack: 1,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: skills(),
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds: 10,
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
        hp: SELF_HP,
        healModifier: 0,
        healTargetId: 'attacker',
        ...overrides,
    });

    it(
        'Carrier repaired by cast heals: boosted repairs land at the gated frequency; ' +
            'total received exceeds baseline by ampPct × (number of procs)',
        () => {
            const NUM_ROUNDS = 10;
            // NOTE: `installBackloadedAccumulator`'s `setRateGateRng` override is dead for this
            // gate under SP-0 — the Exuberance recipient gate now carries an `${ownerId}:proc`
            // stream key (triggers.ts), and the keyed test provider (installed globally in
            // setupTests.ts) takes precedence over a bare `setRateGateRng` override whenever a
            // key is supplied. Left in place as historical intent documentation (originally
            // scripted a back-loaded rate-0.5 accumulator boosting rounds 2,4,6,8,10 — 5 procs);
            // the actual proc count now comes from the keyed `attacker:proc` sub-stream under
            // the fixed test seed, which instead boosts 4 of the 10 casts.
            const EXPECTED_PROCS = 4;

            installBackloadedAccumulator({ rate: EXU_PROC, isGateOfInterest: (d) => d % 2 === 0 });
            const withExu = runCombat(
                EXU_BASE({
                    numRounds: NUM_ROUNDS,
                    shipSkills: skills(exuberance(EXU_AMP, EXU_PROC)),
                })
            );
            const baseline = runCombat(EXU_BASE({ numRounds: NUM_ROUNDS, shipSkills: skills() }));

            const baseHeal = sumHeal(baseline, 'directHeal');
            const exuHeal = sumHeal(withExu, 'directHeal');

            // Baseline: NUM_ROUNDS casts × 1000.
            expect(baseHeal).toBeCloseTo(NUM_ROUNDS * BASE_PER_CAST, 6);
            // With Exuberance: EXPECTED_PROCS casts boosted by +50% → the rest at baseline.
            const expectedExu =
                NUM_ROUNDS * BASE_PER_CAST + EXPECTED_PROCS * BASE_PER_CAST * (EXU_AMP / 100);
            expect(exuHeal).toBeCloseTo(expectedExu, 6);
            expect(exuHeal).toBeGreaterThan(baseHeal);

            // The boost lands on exactly EXPECTED_PROCS rounds (back-loaded gate schedule),
            // each boosted round crediting baseRaw × (1 + ampPct/100).
            const boostedRounds = withExu
                .healing!.rounds.map((rd, i) => ({
                    round: i + 1,
                    heal: rd.perActor.get('attacker')?.directHeal ?? 0,
                }))
                .filter((r) => r.heal > BASE_PER_CAST + 1e-6);
            expect(boostedRounds).toHaveLength(EXPECTED_PROCS);
            for (const r of boostedRounds) {
                expect(r.heal).toBeCloseTo(BASE_PER_CAST * (1 + EXU_AMP / 100), 6);
            }
        }
    );

    it('No Exuberance: every cast lands at baseline (control, byte-identical fold)', () => {
        const NUM_ROUNDS = 10;
        const result = runCombat(EXU_BASE({ numRounds: NUM_ROUNDS, shipSkills: skills() }));
        expect(result.healing).toBeDefined();
        expect(sumHeal(result, 'directHeal')).toBeCloseTo(NUM_ROUNDS * BASE_PER_CAST, 6);
        // Every round credits exactly the unboosted base.
        for (const rd of result.healing!.rounds) {
            expect(rd.perActor.get('attacker')?.directHeal ?? 0).toBeCloseTo(BASE_PER_CAST, 6);
        }
    });

    // ── Second-source assertion: reactive self-heal on an Exuberance carrier ──────
    //
    // Proves the REACTIVE repair-apply fold (triggers.ts) also draws from the recipient's
    // single Exuberance gate. The focus 'attacker' carries BOTH a reactive Second-Wind-style
    // self-heal (on-attacked + crit, basis 'hp') AND Exuberance. An enemy crits it every
    // round; the reactive heal fires at its own rate and — when Exuberance's gate fires —
    // the landed reactive repair is boosted.

    /** Reactive self-heal: fires on a crit received (basis 'hp' → constant raw). */
    const reactiveSelfHeal = (procChance: number): Ability => ({
        id: 'equip-implant-REACTIVE_HEAL',
        type: 'heal',
        target: 'self',
        trigger: 'on-attacked',
        triggerCritFilter: 'crit',
        conditions: [],
        procChance,
        config: { type: 'heal', pct: HEAL_PCT, basis: 'hp' },
        autoFilled: true,
    });

    /** A no-op active so the focus actor still takes a turn each round (deals no damage). */
    const noopActive: Ability = {
        id: 'noop-active',
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier: 0 },
    };

    /** Enemy that crits the focus actor every round (minimal attack so `attacked` is emitted). */
    const critEnemy = {
        id: 'exu-enemy',
        stats: { attack: 1, crit: 100, critDamage: 0, speed: 1, defence: 0, hp: 1_000_000_000 },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active' as const,
                    abilities: [
                        {
                            id: 'exu-enemy-hit',
                            type: 'damage' as const,
                            target: 'enemy' as const,
                            trigger: 'on-cast' as const,
                            conditions: [],
                            config: { type: 'damage' as const, multiplier: 100, hits: 1 },
                        },
                    ],
                },
            ],
        } as ShipSkills,
    };

    it(
        'Reactive self-heal on an Exuberance carrier is boosted (proves the reactive site folds ' +
            'and shares the recipient gate)',
        () => {
            const NUM_ROUNDS = 10;
            // Reactive heal fires every round (procChance 1.0) → a repair lands each round →
            // the recipient gate is rolled once per landed reactive repair.
            // NOTE: `installBackloadedAccumulator`'s `setRateGateRng` override is dead for this
            // gate under SP-0 — the Exuberance recipient gate now carries an `${ownerId}:proc`
            // stream key (triggers.ts), and the keyed test provider (installed globally in
            // setupTests.ts) takes precedence over a bare `setRateGateRng` override whenever a
            // key is supplied. Left in place as historical intent documentation (originally
            // scripted a back-loaded rate-0.5 accumulator boosting 5 of the 10 landed repairs);
            // the actual proc count now comes from the keyed `attacker:proc` sub-stream under
            // the fixed test seed, which instead boosts 4 of the 10 landed repairs.
            installBackloadedAccumulator({ rate: EXU_PROC, isGateOfInterest: (d) => d % 3 === 0 });
            const withExu = runCombat(
                EXU_BASE({
                    numRounds: NUM_ROUNDS,
                    shipSkills: {
                        slots: [
                            { slot: 'active', abilities: [noopActive] },
                            {
                                slot: 'passive',
                                abilities: [reactiveSelfHeal(1.0), exuberance(EXU_AMP, EXU_PROC)],
                            },
                        ],
                    },
                    enemyAttackers: [critEnemy],
                })
            );
            const baseline = runCombat(
                EXU_BASE({
                    numRounds: NUM_ROUNDS,
                    shipSkills: {
                        slots: [
                            { slot: 'active', abilities: [noopActive] },
                            { slot: 'passive', abilities: [reactiveSelfHeal(1.0)] },
                        ],
                    },
                    enemyAttackers: [critEnemy],
                })
            );

            const baseHeal = sumHeal(baseline, 'directHeal');
            const exuHeal = sumHeal(withExu, 'directHeal');
            // Reactive heal fires every round → NUM_ROUNDS landed repairs of baseRaw each.
            expect(baseHeal).toBeCloseTo(NUM_ROUNDS * BASE_PER_CAST, 6);
            // Exuberance boosts 4 of the 10 landed repairs (see NOTE above — keyed sub-stream,
            // not the floor(NUM_ROUNDS × 0.5) back-loaded formula).
            const EXPECTED_PROCS = 4;
            const expectedExu =
                NUM_ROUNDS * BASE_PER_CAST + EXPECTED_PROCS * BASE_PER_CAST * (EXU_AMP / 100);
            expect(exuHeal).toBeCloseTo(expectedExu, 6);
            expect(exuHeal).toBeGreaterThan(baseHeal);
        }
    );
});

// ---------------------------------------------------------------------------
// D-PR7 Task 4: Martyrdom implant — on-destroyed debuff routes to the killer
// ---------------------------------------------------------------------------
//
// Martyrdom is an on-destroyed DEBUFF reaction: "Applies Disable on the enemy that
// killed this Unit." It fires only when the carrier is killed by DIRECT damage, and
// the Disable debuff must land on the KILLER — not the engine's default enemy sink.
//
// Harness shape (mirrors the Second Wind crit-received scenario):
//   - The FOCUS actor ('attacker') is the heal target (healTargetId), carries the
//     legendary Martyrdom implant in its passive slot (via buildShipAbilitiesWithEquipment),
//     and has a tiny HP pool so a single enemy hit is lethal.
//   - A named enemy attacker ('mart-killer') deals a lethal DIRECT hit on round 1.
//     recordDestroyed stamps ship-destroyed with killerId='mart-killer', byDirectDamage:true.
//   - The on-destroyed listener (post-change) routes the Disable debuff's counterTargetId
//     to the killer → debuff-applied.targetId === 'mart-killer' (NOT the default 'enemy').
//
// Test A: lethal DIRECT kill → a Disable debuff-applied fires, targeting the KILLER.
// Test B: lethal NON-direct (DoT) kill → no Disable debuff-applied fires (byDirectDamage:false).

describe('D-PR7 Task 4 integration — Martyrdom routes on-destroyed Disable to the killer', () => {
    const KILLER_ID = 'mart-killer';
    const FOCUS_HP = 1_000;

    /** No-op active for the focus — deals no damage, just keeps the round cadence. */
    const noopActive: Ability = {
        id: 'noop-active',
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier: 0 },
    };

    /** Build focus ship skills: no-op active + the legendary Martyrdom passive (from the registry). */
    function buildMartyrdomShipSkills(): ShipSkills {
        const ship = makeShip({ implants: { implant_major: 'mart-legendary' } });
        const martyrdomPiece = makePiece({
            id: 'mart-legendary',
            slot: 'implant_major',
            rarity: 'legendary',
            setBonus: 'MARTYRDOM',
        });
        const getGearPiece = makeGetGearPiece({ 'mart-legendary': martyrdomPiece });
        const baseSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece);
        const passive = baseSkills.slots.find((s) => s.slot === 'passive');
        // Pre-condition: the Martyrdom on-destroyed debuff landed in the passive slot.
        const martyrdom = passive?.abilities.find((a) =>
            a.id.startsWith('equip-implant-MARTYRDOM')
        );
        expect(martyrdom).toBeDefined();
        expect(martyrdom!.trigger).toBe('on-destroyed');
        expect(martyrdom!.config.type).toBe('debuff');

        return {
            slots: [
                { slot: 'active', abilities: [noopActive] },
                ...(passive ? [{ slot: passive.slot, abilities: passive.abilities }] : []),
            ],
        };
    }

    /** A fast enemy attacker that lands a lethal DIRECT hit on the focus each round. */
    const directKiller = {
        id: KILLER_ID,
        stats: {
            attack: 1_000_000, // dwarfs FOCUS_HP → guaranteed lethal direct hit
            crit: 0,
            critDamage: 0,
            speed: 1_000, // acts before the slow focus
            defence: 0,
            hp: 1_000_000_000,
        },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active' as const,
                    abilities: [
                        {
                            id: 'mart-killer-hit',
                            type: 'damage' as const,
                            target: 'enemy' as const,
                            trigger: 'on-cast' as const,
                            conditions: [],
                            config: { type: 'damage' as const, multiplier: 100, hits: 1 },
                        },
                    ],
                },
            ],
        } as ShipSkills,
    };

    /** A fast enemy attacker that lands a corrosion DoT (no direct damage) which kills the focus. */
    const dotKiller = {
        id: KILLER_ID,
        stats: {
            attack: 1_000_000,
            crit: 0,
            critDamage: 0,
            speed: 1_000,
            defence: 0,
            hp: 1_000_000_000,
        },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active' as const,
                    abilities: [
                        // DoT only — no direct-damage ability → the kill comes from the
                        // turn-start DoT tick (byDirectDamage:false), never a direct hit.
                        {
                            id: 'mart-killer-dot',
                            type: 'dot' as const,
                            target: 'enemy' as const,
                            trigger: 'on-cast' as const,
                            conditions: [],
                            config: {
                                type: 'dot' as const,
                                dotType: 'corrosion' as const,
                                tier: 8, // 5 stacks × (8/100) × 1 000 maxHp = 400 dmg/tick → fatal by tick 3 (within 6 rounds)
                                stacks: 5,
                                duration: 5,
                            },
                        },
                    ],
                },
            ],
        } as ShipSkills,
    };

    /** Base engine input: healing mode, slow focus 'attacker' is the heal target. */
    const MART_BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [] },
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds: 3,
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
        hp: FOCUS_HP,
        speed: 1, // focus is slow → the enemy acts (and kills it) first
        healTargetId: 'attacker',
        ...overrides,
    });

    /** Collect debuff-applied + ship-destroyed events from a runCombat with the given input. */
    function collect(input: CombatEngineInput) {
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        bus.on('debuff-applied', (e) => events.push(e as CombatEvent));
        bus.on('ship-destroyed', (e) => events.push(e as CombatEvent));
        runCombat({ ...input, bus });
        return events;
    }

    it(
        'A. Focus killed by a DIRECT hit: a Disable debuff-applied fires and targets the KILLER ' +
            "(not the default 'enemy')",
        () => {
            const events = collect(
                MART_BASE({
                    shipSkills: buildMartyrdomShipSkills(),
                    enemyAttackers: [directKiller],
                })
            );

            // Sanity: the focus actually died to a DIRECT-damage kill attributed to the killer.
            const destroyed = events.filter(
                (e) => e.type === 'ship-destroyed' && e.actorId === 'attacker'
            );
            expect(destroyed.length).toBeGreaterThanOrEqual(1);

            // The Disable debuff must be applied, and it must target the KILLER actor id.
            const disableEvents = events.filter(
                (e) => e.type === 'debuff-applied' && e.buffName === 'Disable'
            );
            expect(disableEvents.length).toBeGreaterThanOrEqual(1);
            for (const e of disableEvents) {
                if (e.type !== 'debuff-applied') continue;
                expect(e.targetId).toBe(KILLER_ID); // implicitly NOT the default enemy sink
                // Sourced by the dying carrier.
                expect(e.sourceId).toBe('attacker');
            }
        }
    );

    it('B. Focus killed by NON-direct (DoT) damage: NO Disable debuff-applied fires', () => {
        const events = collect(
            MART_BASE({
                numRounds: 6, // give the DoT time to tick the focus to death
                shipSkills: buildMartyrdomShipSkills(),
                enemyAttackers: [dotKiller],
            })
        );

        // Sanity: the focus did die (so the on-destroyed listener fired at all).
        const destroyed = events.filter(
            (e) => e.type === 'ship-destroyed' && e.actorId === 'attacker'
        );
        expect(destroyed.length).toBeGreaterThanOrEqual(1);

        // A DoT kill is byDirectDamage:false → Martyrdom's debuff gate must NOT fire.
        const disableEvents = events.filter(
            (e) => e.type === 'debuff-applied' && e.buffName === 'Disable'
        );
        expect(disableEvents).toHaveLength(0);
    });

    // -----------------------------------------------------------------------
    // D-PR13 Task 5: END-TO-END consequence — the disabled killer SKIPS its turns
    // -----------------------------------------------------------------------
    //
    // APPROACH A (the faithful design): a dying TEAM-actor Martyrdom carrier +
    // a surviving tank focus + an enemy killer. Tests A/B above proved Martyrdom
    // EMITS a Disable targeting the killer. THIS test proves the CONSEQUENCE:
    // once the Disable lands, the killer actually skips its scheduled turns
    // (observed via the absence of its `ability-performed` in the disabled rounds),
    // and a non-Martyrdom CONTROL run shows the killer WOULD have acted — so the
    // observed absence is genuine turn-suppression, not a vacuous artefact.
    //
    // Board / roster (uses the module-level positional helpers defined below:
    // `playerActorAt`, `offensiveEnemyAt`, `parsedTargetFront`, `lineRange1`, `POS_BASE`):
    //   - Focus 'attacker' (heal target, the TANK): huge HP, positioned BACK at M1,
    //     no offense (POS_BASE's basicAttackSlot fires but deals 0 with attack:0). It
    //     outlives the whole battle so it stays a valid `front` target after the martyr dies.
    //   - Team actor 'martyr' at the FRONT cell M4, tiny HP (MARTYR_HP), carrying the
    //     legendary Martyrdom passive in its `walk.shipSkills`. It is the front-most
    //     player → the killer's `front` target in round 1 → dies to the lethal hit.
    //   - Enemy 'mart-killer' at M1, fast (speed 1000 ≫ player speed 1), attack ≫ HP,
    //     firing a Line-Range-1 hit at `front`. Round 1 it one-shots the front-most
    //     player (the martyr). From round 2 on, the only living player is the tank at
    //     M1, so absent Disable the killer keeps emitting `ability-performed`.
    //
    // Turn order per round: the fast killer acts first, then the slow players.
    //   Round 1: killer fires → kills 'martyr' → Martyrdom on-destroyed routes a
    //            Disable onto the killer. The killer's round-1 `ability-performed`
    //            IS emitted (the disable lands during/after that turn's kill).
    //   Round 2: the killer is Disabled → its scheduled turn is SUPPRESSED → NO
    //            `ability-performed` from the killer. (The Disable is also decremented
    //            on this skipped turn and expires at its tail.)
    //   Round 3: the Disable has expired → the killer acts again (attacks the tank).
    //
    // numRounds: 3 — enough to observe act(R1) → skip(R2) → resume(R3).
    //
    // NOTE ON DURATION: the legendary Martyrdom Disable is duration 2, but the engine's
    // timed-status decrement runs on the skipped turn too (the documented decrement-
    // timing behaviour — a debuff applied during an actor's turn is decremented again at
    // that actor's NEXT post-turn, i.e. the skipped one). The Disable is applied during
    // the killer's round-1 turn, so it covers exactly ONE scheduled action (round 2) and
    // expires before round 3. This test LOCKS the engine's actual end-to-end behaviour
    // (one observable skipped turn for a legendary carrier), not a hand-computed turn count.
    //
    // NON-VACUITY CONTROL: an identical run where 'martyr' carries NO Martyrdom (a
    // plain basic-attack slot only) → no Disable is ever applied → the killer emits
    // `ability-performed` in round 2 (and every round). This proves the absence in the
    // main run is genuine Disable suppression, not the killer simply having nothing to do.

    const MARTYR_HP = 1_000; // tiny → the front origin hit one-shots the martyr
    const TANK_HP = 1_000_000_000; // huge → the tank survives every round it is hit
    const SKIP_NUM_ROUNDS = 4;

    /** Martyr team-actor slots: a basic attack footprint + the legendary Martyrdom passive. */
    function buildMartyrdomSlots(): ShipSkills['slots'] {
        const ship = makeShip({ implants: { implant_major: 'mart-skip' } });
        const martPiece = makePiece({
            id: 'mart-skip',
            slot: 'implant_major',
            rarity: 'legendary',
            setBonus: 'MARTYRDOM',
        });
        const getGearPiece = makeGetGearPiece({ 'mart-skip': martPiece });
        const baseSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece);
        const passive = baseSkills.slots.find((s) => s.slot === 'passive');
        const mart = passive?.abilities.find((a) => a.id.startsWith('equip-implant-MARTYRDOM'));
        expect(mart).toBeDefined();
        expect(mart!.trigger).toBe('on-destroyed');
        return [
            basicAttackSlot(),
            ...(passive ? [{ slot: passive.slot, abilities: passive.abilities }] : []),
        ];
    }

    /** A fast positional enemy killer firing a lethal Line-Range-1 hit at `front`. */
    const skipKiller = () => offensiveEnemyAt(KILLER_ID, 'M1', 1_000_000);

    /** Run the positional skip scenario; collect ability-performed + ship-destroyed + debuff-applied. */
    function runSkip(martyrSlots: ShipSkills['slots']) {
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        bus.on('ability-performed', (e) => events.push(e as CombatEvent));
        bus.on('ship-destroyed', (e) => events.push(e as CombatEvent));
        bus.on('debuff-applied', (e) => events.push(e as CombatEvent));
        runCombat({
            ...POS_BASE({
                numRounds: SKIP_NUM_ROUNDS,
                hp: TANK_HP, // the focus tank survives the whole battle
                position: 'M1', // tank sits at the BACK
                teamActors: [playerActorAt('martyr', 'M4', martyrSlots, MARTYR_HP)],
                enemyAttackers: [skipKiller()],
            }),
            bus,
        });
        return events;
    }

    const killerActedInRound = (events: CombatEvent[], r: number) =>
        events.some(
            (e) => e.type === 'ability-performed' && e.actorId === KILLER_ID && e.round === r
        );

    it(
        'C. End-to-end: after killing a Martyrdom carrier the killer is Disabled and SKIPS its turn ' +
            '(acts round 1, suppressed rounds 2 AND 3 for legendary Disable(2), resumes round 4) — non-Martyrdom control proves non-vacuity',
        () => {
            // --- Main run: martyr carries legendary Martyrdom -----------------
            const main = runSkip(buildMartyrdomSlots());

            // Sanity: the martyr died in round 1 ...
            const martyrDeath = main.filter(
                (e) => e.type === 'ship-destroyed' && e.actorId === 'martyr'
            );
            expect(martyrDeath.length).toBeGreaterThanOrEqual(1);
            expect(martyrDeath.some((e) => e.type === 'ship-destroyed' && e.round === 1)).toBe(
                true
            );
            // ... and a Disable debuff landed on the killer (the cause of the skip).
            const disableOnKiller = main.filter(
                (e) =>
                    e.type === 'debuff-applied' &&
                    e.buffName === 'Disable' &&
                    e.targetId === KILLER_ID
            );
            expect(disableOnKiller.length).toBeGreaterThanOrEqual(1);

            // The CONSEQUENCE: the killer acts in round 1 (the kill), is SUPPRESSED in
            // rounds 2 AND 3 (legendary Disable lasts its FULL two turns — #6b: the Disable
            // landed during the killer's own turn but is given an own-turn reprieve so its
            // first tick is not eaten by the same-turn Post-Turn), and acts again in round 4
            // (Disable expired).
            expect(killerActedInRound(main, 1)).toBe(true);
            expect(killerActedInRound(main, 2)).toBe(false);
            expect(killerActedInRound(main, 3)).toBe(false);
            expect(killerActedInRound(main, 4)).toBe(true);

            // --- Control run: martyr carries NO Martyrdom (plain basic attack only) ---
            // No Disable is ever applied → the killer must keep acting every round it
            // has a living target (the tank). This is what makes the main-run absence
            // in round 2 a genuine suppression rather than a vacuous artefact.
            const control = runSkip([basicAttackSlot()]);

            // No Disable in the control.
            expect(
                control.filter((e) => e.type === 'debuff-applied' && e.buffName === 'Disable')
            ).toHaveLength(0);
            // The killer acts in every round 1-3 — crucially round 2, exactly where the
            // main run was suppressed.
            for (let r = 1; r <= SKIP_NUM_ROUNDS; r++) {
                expect(killerActedInRound(control, r)).toBe(true);
            }
        }
    );
});

// ---------------------------------------------------------------------------
// D-PR7 Task 5: Last Wish + Battlecry engine integration + enemy-side mirror
// ---------------------------------------------------------------------------
//
// These tests exercise the on-destroyed REACTIVE path for a NON-focus team ally
// carrying an on-death implant. Killing a non-focus ally requires the POSITIONAL
// apply path (the non-positional model lands every enemy hit on the heal target),
// so the fixtures mirror perVictimLeech.test.ts: positioned focus + walked team
// actor + an offensive positional enemy firing a Line-Range-1 AoE at `front`.
//
// Board layout (player side): the DYING carrier sits at the front-most cell (M4 =
// origin victim → full damage → lethal). The SURVIVOR focus sits one step back (M3
// = covered victim → half damage → survives) and is the heal target. The enemy at
// M1 fires `front`, anchoring on the front-most player (the carrier), covering the
// survivor.

// --- Positional helpers (shared by the Last Wish + Battlecry blocks) ----------

const parsedTargetFront = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
// Line-Range-1: origin + one covered cell one step toward the back (origin full, covered half).
const lineRange1 = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

/** Single-hit 100% basic attack (so a positioned actor has a damage skill / footprint). */
const basicAttackSlot = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'basic-atk',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 100, hits: 1 },
        },
    ],
});

/** A walked PLAYER team actor at a board position, with optional skill slots + HP. */
function playerActorAt(
    id: string,
    position: Position,
    slots: ShipSkills['slots'],
    hp: number
): TeamActorEngineInput {
    return {
        id,
        speed: 1,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parsedTargetFront(),
        pattern: lineRange1(),
        walk: {
            shipSkills: { slots },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
            healModifier: 0,
        },
    };
}

/** An OFFENSIVE positioned enemy firing a Line-Range-1 AoE at `front`. */
function offensiveEnemyAt(id: string, position: Position, attack: number) {
    return {
        id,
        stats: { attack, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1_000 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTargetFront(),
        pattern: lineRange1(),
        shipSkills: { slots: [basicAttackSlot()] },
    };
}

/** Positional base input: healing mode, focus 'attacker' is the heal-target SURVIVOR at M3. */
const POS_BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicAttackSlot()] },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
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
    defence: 0,
    hp: 1_000_000, // default focus pool; overridden per-test
    healModifier: 0,
    healTargetId: 'attacker',
    position: 'M3', // focus is the COVERED survivor
    target: parsedTargetFront(),
    pattern: lineRange1(),
    ...overrides,
});

describe('D-PR7 Task 5 integration — Last Wish repairs living allies on death', () => {
    const DYER_HP = 1_000; // tiny pool → the front origin hit is lethal
    const FOCUS_HP = 1_000_000; // large pool → the covered (half) hit is survivable, leaves a deficit

    /** Build the dying ally's skills with the legendary Last Wish implant (via the registry). */
    function buildLastWishSlots(): ShipSkills['slots'] {
        const ship = makeShip({ implants: { implant_major: 'lw-legendary' } });
        const lwPiece = makePiece({
            id: 'lw-legendary',
            slot: 'implant_major',
            rarity: 'legendary',
            setBonus: 'LAST_WISH',
        });
        const getGearPiece = makeGetGearPiece({ 'lw-legendary': lwPiece });
        const baseSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece);
        const passive = baseSkills.slots.find((s) => s.slot === 'passive');
        // Pre-condition: the Last Wish on-destroyed heal landed in the passive slot.
        const lw = passive?.abilities.find((a) => a.id.startsWith('equip-implant-LAST_WISH'));
        expect(lw).toBeDefined();
        expect(lw!.trigger).toBe('on-destroyed');
        expect(lw!.target).toBe('all-allies');
        expect(lw!.config.type).toBe('heal');

        return [
            basicAttackSlot(),
            ...(passive ? [{ slot: passive.slot, abilities: passive.abilities }] : []),
        ];
    }

    // Last Wish legendary: target-hp basis, pct 32, noCrit. Per LIVING recipient the gross is
    //   recipientMaxHp × 0.32 × (1 + healModifier/100) × (1 + outgoingHeal/100) × (1 + incomingHeal/100)
    // and every fold factor here is 1 (dier healModifier 0, no heal-up/incoming-heal buffs).
    // The ONLY living recipient is the focus survivor ('attacker', maxHP FOCUS_HP) — the dead
    // caster ('dier', maxHP DYER_HP) is skipped by the recipientHp<=0 guard in the executor.
    const LW_LEGENDARY_PCT = 32;
    // Gross over living recipients only = FOCUS_HP × 0.32 = 320_000.
    const EXPECTED_GROSS = FOCUS_HP * (LW_LEGENDARY_PCT / 100); // 320_000
    // If the dead caster were wrongly counted as a living recipient, its target-hp share
    // (DYER_HP × 0.32 = 320) would be ADDED → 320_320. The upper bound below excludes that.
    const DEAD_CASTER_SHARE = DYER_HP * (LW_LEGENDARY_PCT / 100); // 320
    // The covered (half-damage) hit the survivor takes: enemy attack 5000 × 100% × ½ = 2500,
    // mitigated by the focus's defence 0 → 2500. This is the deficit the repair fills, so
    // effectiveHeal is capped at exactly this (320_000 >> 2500).
    const SCRATCH_DAMAGE = 2_500;

    it(
        'A non-focus ally carrying Last Wish dies → only the LIVING focus is repaired (dead caster ' +
            "excluded from the gross); the survivor's scratch deficit is filled",
        () => {
            // Dying carrier at the front origin (M4, lethal full hit). Focus survivor at M3 (covered).
            // The enemy attack must one-shot the 1000-HP carrier (origin = full) while leaving the
            // 1_000_000-HP focus alive (covered = half = 2500, a survivable scratch leaving a deficit).
            const result = runCombat(
                POS_BASE({
                    hp: FOCUS_HP,
                    teamActors: [playerActorAt('dier', 'M4', buildLastWishSlots(), DYER_HP)],
                    enemyAttackers: [offensiveEnemyAt('enemy-atk', 'M1', 5_000)],
                })
            );

            expect(result.healing).toBeDefined();

            // The dead caster ('dier') is credited with the gross Last Wish repair (the engine keys
            // all reactive-heal credit by the casting owner, summed over LIVING recipients only). The
            // gross must equal EXACTLY the focus survivor's share (320_000) and NOT include the dead
            // caster's own 320 share. The lower bound + upper bound window
            // [EXPECTED_GROSS − 1, EXPECTED_GROSS + DEAD_CASTER_SHARE/2) pins the value AND excludes
            // the dead-caster-included total (320_320): 320_320 fails the < (EXPECTED_GROSS + 160)
            // upper bound. A bare `> 100_000` (the old assertion) would pass for BOTH 320_000 and
            // 320_320 — this window is what makes the exclusion load-bearing.
            expect(sumHeal(result, 'directHeal', 'dier')).toBeGreaterThan(EXPECTED_GROSS - 1);
            expect(sumHeal(result, 'directHeal', 'dier')).toBeLessThan(
                EXPECTED_GROSS + DEAD_CASTER_SHARE / 2
            );
            // Belt-and-suspenders exact pin: toBeCloseTo digits −2 ⇒ tolerance 0.5×10² = ±50, well
            // under the 320 gap to the dead-caster-included total, so 320_320 would also fail here.
            expect(sumHeal(result, 'directHeal', 'dier')).toBeCloseTo(EXPECTED_GROSS, -2);

            // The heal-target survivor's pool was actually filled: effectiveHeal (credited under the
            // dead caster) equals the survivor's deficit = the SCRATCH_DAMAGE it took from the covered
            // hit. The 320_000 repair vastly exceeds the 2500 deficit, so effectiveHeal is capped at
            // exactly the deficit. Asserting ≈ SCRATCH_DAMAGE distinguishes "pool actually filled"
            // from a residual/near-zero credit (which a `> 0` check would also accept).
            expect(sumHeal(result, 'effectiveHeal', 'dier')).toBeCloseTo(SCRATCH_DAMAGE, 6);

            // No OTHER actor id is credited with directHeal — all reactive-heal credit is keyed to
            // the dead caster ('dier'), never the focus or the enemy.
            expect(sumHeal(result, 'directHeal', 'attacker')).toBe(0);
        }
    );
});

describe('D-PR7 Task 5 integration — Battlecry emits Inc. Damage Down II on living allies (emit-only)', () => {
    const DYER_HP = 1_000;
    const FOCUS_HP = 1_000_000;
    const ALLY_HP = 1_000_000;
    const BATTLECRY_NAME = 'Inc. Damage Down II';
    const LEGENDARY_DURATION = 3; // BATTLECRY_DURATION.legendary

    /** Build the dying ally's skills with the legendary Battlecry implant (via the registry). */
    function buildBattlecrySlots(): ShipSkills['slots'] {
        const ship = makeShip({ implants: { implant_major: 'bc-legendary' } });
        const bcPiece = makePiece({
            id: 'bc-legendary',
            slot: 'implant_major',
            rarity: 'legendary',
            setBonus: 'BATTLECRY',
        });
        const getGearPiece = makeGetGearPiece({ 'bc-legendary': bcPiece });
        const baseSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece);
        const passive = baseSkills.slots.find((s) => s.slot === 'passive');
        // Pre-condition: the Battlecry on-destroyed buff grant landed in the passive slot.
        const bc = passive?.abilities.find((a) => a.id.startsWith('equip-implant-BATTLECRY'));
        expect(bc).toBeDefined();
        expect(bc!.trigger).toBe('on-destroyed');
        expect(bc!.target).toBe('all-allies');
        expect(bc!.config.type).toBe('buff');

        return [
            basicAttackSlot(),
            ...(passive ? [{ slot: passive.slot, abilities: passive.abilities }] : []),
        ];
    }

    /** Collect buff-applied + ship-destroyed events. */
    function collect(input: CombatEngineInput) {
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        bus.on('buff-applied', (e) => events.push(e as CombatEvent));
        bus.on('ship-destroyed', (e) => events.push(e as CombatEvent));
        runCombat({ ...input, bus });
        return events;
    }

    it(
        'A Battlecry carrier dies → a Inc. Damage Down II buff-applied fires once for each living ' +
            'ally, carrying the legendary duration (3); no damage-reduction asserted (emit-only)',
        () => {
            // Dying carrier at the front origin (M4). Two SURVIVORS: focus at M3 (covered, survives)
            // and a second team ally at M2 (outside the AoE footprint → untouched, survives).
            const events = collect(
                POS_BASE({
                    hp: FOCUS_HP,
                    teamActors: [
                        playerActorAt('dier', 'M4', buildBattlecrySlots(), DYER_HP),
                        playerActorAt('ally-2', 'M2', [basicAttackSlot()], ALLY_HP),
                    ],
                    enemyAttackers: [offensiveEnemyAt('enemy-atk', 'M1', 5_000)],
                })
            );

            // Sanity: the carrier actually died (so the on-destroyed buff grant fired at all).
            const destroyed = events.filter(
                (e) => e.type === 'ship-destroyed' && e.actorId === 'dier'
            );
            expect(destroyed.length).toBeGreaterThanOrEqual(1);

            const battlecryEvents = events.filter(
                (e) => e.type === 'buff-applied' && e.buffName === BATTLECRY_NAME
            );
            expect(battlecryEvents.length).toBeGreaterThanOrEqual(1);

            // Each LIVING ally received exactly one Inc. Damage Down II buff-applied event.
            for (const livingId of ['attacker', 'ally-2']) {
                const forAlly = battlecryEvents.filter(
                    (e) => e.type === 'buff-applied' && e.actorId === livingId
                );
                expect(forAlly).toHaveLength(1);
            }

            // The event carries the legendary duration (3).
            for (const e of battlecryEvents) {
                if (e.type !== 'buff-applied') continue;
                expect(e.duration).toBe(LEGENDARY_DURATION);
            }
        }
    );
});

// ---------------------------------------------------------------------------
// D-PR7 Task 5: enemy-side mirror — an ENEMY Martyrdom carrier routes Disable to the PLAYER killer
// ---------------------------------------------------------------------------
//
// The engine is team-agnostic: an on-destroyed reaction carried by an ENEMY ship must fire the
// same path against the player side. We mirror the Task-4 Martyrdom scenario but flip the sides —
// a positioned ENEMY carries the legendary Martyrdom implant, the PLAYER focus lands a lethal
// DIRECT hit, and the resulting Disable debuff-applied must target the PLAYER killer ('attacker').

describe('D-PR7 Task 5 integration — enemy-side mirror: enemy Martyrdom routes Disable to the player killer', () => {
    const ENEMY_HP = 1_000; // tiny → the player's hit one-shots it

    /** Build the enemy's Martyrdom skills (legendary) via the registry. */
    function buildEnemyMartyrdomSlots(): ShipSkills['slots'] {
        const ship = makeShip({ implants: { implant_major: 'mart-enemy' } });
        const martPiece = makePiece({
            id: 'mart-enemy',
            slot: 'implant_major',
            rarity: 'legendary',
            setBonus: 'MARTYRDOM',
        });
        const getGearPiece = makeGetGearPiece({ 'mart-enemy': martPiece });
        const baseSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece);
        const passive = baseSkills.slots.find((s) => s.slot === 'passive');
        const mart = passive?.abilities.find((a) => a.id.startsWith('equip-implant-MARTYRDOM'));
        expect(mart).toBeDefined();
        expect(mart!.trigger).toBe('on-destroyed');

        return [
            basicAttackSlot(),
            ...(passive ? [{ slot: passive.slot, abilities: passive.abilities }] : []),
        ];
    }

    /** A positioned ENEMY carrier of Martyrdom (tiny HP, no offense needed). */
    function enemyMartyrdomCarrier() {
        return {
            id: 'enemy-mart',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: ENEMY_HP, speed: 1 },
            chargeCount: 0,
            startCharged: false,
            position: 'M4' as Position,
            target: parsedTargetFront(),
            pattern: lineRange1(),
            shipSkills: { slots: buildEnemyMartyrdomSlots() },
        };
    }

    /** Collect debuff-applied + ship-destroyed events. */
    function collect(input: CombatEngineInput) {
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        bus.on('debuff-applied', (e) => events.push(e as CombatEvent));
        bus.on('ship-destroyed', (e) => events.push(e as CombatEvent));
        runCombat({ ...input, bus });
        return events;
    }

    it(
        'An ENEMY Martyrdom carrier killed by a player DIRECT hit → a Disable debuff-applied fires ' +
            "targeting the PLAYER killer ('attacker'), proving the on-destroyed path is team-agnostic",
        () => {
            // Player focus at M4 fires a lethal Line-Range-1 hit at the front enemy (the carrier at M4).
            const events = collect(
                POS_BASE({
                    attack: 1_000_000, // dwarfs ENEMY_HP → guaranteed lethal direct hit
                    hp: 1_000_000_000,
                    position: 'M4', // focus fires from the front
                    shipSkills: { slots: [basicAttackSlot()] },
                    enemyAttackers: [enemyMartyrdomCarrier()],
                })
            );

            // Sanity: the enemy carrier died.
            const destroyed = events.filter(
                (e) => e.type === 'ship-destroyed' && e.actorId === 'enemy-mart'
            );
            expect(destroyed.length).toBeGreaterThanOrEqual(1);

            // The Disable debuff fired and targets the PLAYER killer (the focus 'attacker'),
            // sourced by the dying enemy carrier.
            const disableEvents = events.filter(
                (e) => e.type === 'debuff-applied' && e.buffName === 'Disable'
            );
            expect(disableEvents.length).toBeGreaterThanOrEqual(1);
            for (const e of disableEvents) {
                if (e.type !== 'debuff-applied') continue;
                expect(e.targetId).toBe('attacker'); // the player killer, NOT an enemy sink
                expect(e.sourceId).toBe('enemy-mart');
            }
        }
    );
});

// ---------------------------------------------------------------------------
// D-PR8 Task 4: not-hit-this-round gate — engine hit-tracking → drain-time gate
// ---------------------------------------------------------------------------
//
// Alacrity grants a self-buff at end-of-round ONLY if the owner took no DIRECT hit
// that round. We exercise the gate with a HAND-BUILT reactive buff ability (NOT the
// implant registry) so the test isolates the `not-hit-this-round` condition from any
// proc-gate timing: type 'buff', target 'self', trigger 'end-of-round', a single
// condition { subject:'not-hit-this-round', derivable:true }, NO procChance, a
// recognizable buffName, duration 2.
//
// The ability sits in the FOCUS actor's ('attacker', the heal target) passive slot.
// At round tail the engine drains the end-of-round queue; buildDrainContext reads the
// owner's wasHitThisRound (engine-populated from the combat-wide hitThisRound Set) into
// the gate. Met (not hit) → buff-applied for 'attacker' fires; not met (hit) → no grant.
//
// Scenarios:
//   (a) no direct hit  → buff IS granted (enemy with attack 0).
//   (b) direct HP hit  → buff NOT granted (enemy lands HP damage).
//   (c) shield-absorbed hit only → counts as a hit → NOT granted (focus self-grants a
//        large shield before the enemy lands a fully-absorbed hit).
//   (d) DoT tick only (no direct attack) → NOT a hit → buff granted (byDirectDamage:false).

describe('D-PR8 Task 4 integration — not-hit-this-round gate (engine hit-tracking)', () => {
    const BUFF_NAME = 'Speed Up III';
    const FOCUS_HP = 100_000;
    const NUM_ROUNDS = 1;

    /** The hand-built reactive self-buff gated solely on not-hit-this-round (no procChance). */
    const reactiveSelfBuff: Ability = {
        id: 'reactive-not-hit-buff',
        type: 'buff',
        target: 'self',
        trigger: 'end-of-round',
        conditions: [{ subject: 'not-hit-this-round', derivable: true }],
        config: {
            type: 'buff',
            buffName: BUFF_NAME,
            parsedEffects: {},
            stacks: 1,
            isStackable: false,
            duration: 2,
        },
    };

    /** A self-shield active (basis 'hp') so the focus can seed its own shield pool before a hit. */
    const selfShieldActive: Ability = {
        id: 'self-shield',
        type: 'shield',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'shield', pct: 100, basis: 'hp', noCrit: true },
    };

    /** A no-op active so the focus takes a turn each round (deals no damage). */
    const noopActive: Ability = {
        id: 'noop-active',
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier: 0 },
    };

    /** Build the focus ship skills: an active + the reactive buff in the passive slot. */
    const focusSkills = (active: Ability): ShipSkills => ({
        slots: [
            { slot: 'active', abilities: [active] },
            { slot: 'passive', abilities: [reactiveSelfBuff] },
        ],
    });

    /** An enemy attacker that lands a single-hit attack each round. attack 0 → no damage hit. */
    function makeEnemyAttacker(attack: number, speed = 1_000) {
        return {
            id: 'pr8-enemy',
            stats: { attack, crit: 0, critDamage: 0, speed, defence: 0, hp: 1_000_000_000 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: {
                slots: [
                    {
                        slot: 'active' as const,
                        abilities: [
                            {
                                id: 'pr8-enemy-hit',
                                type: 'damage' as const,
                                target: 'enemy' as const,
                                trigger: 'on-cast' as const,
                                conditions: [],
                                config: { type: 'damage' as const, multiplier: 100, hits: 1 },
                            },
                        ],
                    },
                ],
            } as ShipSkills,
        };
    }

    /** An enemy that lands ONLY a Corrosion DoT (no direct-damage ability). */
    function makeDotEnemy(speed = 1_000) {
        return {
            id: 'pr8-dot-enemy',
            stats: { attack: 10_000, crit: 0, critDamage: 0, speed, defence: 0, hp: 1_000_000_000 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: {
                slots: [
                    {
                        slot: 'active' as const,
                        abilities: [
                            {
                                id: 'pr8-dot',
                                type: 'dot' as const,
                                target: 'enemy' as const,
                                trigger: 'on-cast' as const,
                                conditions: [],
                                config: {
                                    type: 'dot' as const,
                                    dotType: 'corrosion' as const,
                                    tier: 2,
                                    stacks: 1,
                                    duration: 5,
                                },
                            },
                        ],
                    },
                ],
            } as ShipSkills,
        };
    }

    /** Base engine input: healing mode, 'attacker' is the heal target carrying the reactive buff. */
    const PR8_BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: focusSkills(noopActive),
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds: NUM_ROUNDS,
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
        hp: FOCUS_HP,
        healTargetId: 'attacker',
        ...overrides,
    });

    /** Collect buff-applied events for the focus carrier with the recognizable buff name. */
    function collectGrants(input: CombatEngineInput): CombatEvent[] {
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        bus.on('buff-applied', (e) => events.push(e as CombatEvent));
        runCombat({ ...input, bus });
        return events.filter(
            (e) => e.type === 'buff-applied' && e.actorId === 'attacker' && e.buffName === BUFF_NAME
        );
    }

    it('(a) no direct hit → not-hit-this-round met → buff IS granted', () => {
        // Enemy attack 0 → no damage hit lands on the focus → hitThisRound stays empty.
        const grants = collectGrants(PR8_BASE({ enemyAttackers: [makeEnemyAttacker(0)] }));
        expect(grants.length).toBeGreaterThanOrEqual(1);
    });

    it('(b) direct HP hit → not-hit-this-round NOT met → buff NOT granted', () => {
        // Enemy lands a real HP hit on the focus → hitThisRound.add('attacker') → gate fails.
        const grants = collectGrants(PR8_BASE({ enemyAttackers: [makeEnemyAttacker(5_000)] }));
        expect(grants).toHaveLength(0);
    });

    it('(c) shield-absorbed hit only → counts as a hit → buff NOT granted', () => {
        // Focus is FAST: it self-grants a shield (100% of max HP = 100_000) before the slow
        // enemy's 5_000 hit lands ENTIRELY on the shield (absorbed > 0, hpDamage 0). A shield
        // absorption still counts as a direct hit → gate fails.
        const grants = collectGrants(
            PR8_BASE({
                shipSkills: focusSkills(selfShieldActive),
                speed: 10_000, // focus acts BEFORE the enemy → shield is up when the hit lands
                enemyAttackers: [makeEnemyAttacker(5_000, 1_000)],
            })
        );
        expect(grants).toHaveLength(0);
    });

    it('(d) DoT tick only (no direct attack) → NOT a hit → buff IS granted', () => {
        // The enemy applies ONLY a Corrosion DoT (no direct-damage ability). The turn-start DoT
        // batch intake passes byDirectDamage:false → never recorded in hitThisRound → gate met.
        // Give the DoT time to tick at least once (numRounds 2: applied round 1, ticks round 2).
        // Capture dot-ticked alongside buff-applied: assert the DoT actually ticked on the focus,
        // otherwise this would pass vacuously — a round where the DoT never lands is indistinguishable
        // from scenario (a) (no hit at all → buff granted), proving nothing about the DoT path.
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        bus.on('buff-applied', (e) => events.push(e as CombatEvent));
        bus.on('dot-ticked', (e) => events.push(e as CombatEvent));
        runCombat({ ...PR8_BASE({ numRounds: 2, enemyAttackers: [makeDotEnemy()] }), bus });
        const dotTicks = events.filter((e) => e.type === 'dot-ticked' && e.targetId === 'attacker');
        const grants = events.filter(
            (e) => e.type === 'buff-applied' && e.actorId === 'attacker' && e.buffName === BUFF_NAME
        );
        expect(dotTicks.length).toBeGreaterThanOrEqual(1);
        expect(grants.length).toBeGreaterThanOrEqual(1);
    });
});

// ---------------------------------------------------------------------------
// D-PR8 Task 6: Synaptic Resonance (LIVE on-enemy-repaired) + Ambush gate (seeded Stealth)
// ---------------------------------------------------------------------------
//
// Two reactive self-buff-grant implants from the D-PR8 registry:
//
//   SYNAPTIC_RESONANCE — type:'buff', target:'self', trigger:'on-enemy-repaired',
//     grants 'Speed Up III' for 1 turn, DETERMINISTIC (no procChance). LIVE today:
//     enemies have real (symmetric) healing, so 'on-enemy-repaired' fires. We drive a
//     genuine enemy repair the way nayraEnemyRepairedPurge.test.ts does — an enemy ally
//     takes a dent and then self-heals (HP-restoring → heal-performed with an opposing
//     caster), which routes through the on-enemy-repaired listener to the player owner.
//
//   AMBUSH — type:'buff', target:'self', trigger:'start-of-round', grants 'Crit Power
//     Up III' for 1 turn, gated { subject:'self-buff', buffName:'Stealth', derivable:true }
//     + a procChance. DORMANT in normal play (nothing grants Stealth). To test the GATE in
//     isolation from proc timing, we (a) SEED a recurring 'Stealth' self-buff on the owner
//     ('attacker'), which surfaces in snapshot('attacker').activeSelfBuffs every round and
//     thus in the start-of-round drain gate's selfBuffNames, and (b) inject a HAND-BUILT
//     Ambush-shaped buff ability with procChance OMITTED (so the proc gate always passes —
//     the only variable is the Stealth gate).

describe('D-PR8 Task 6 integration — Synaptic Resonance fires on enemy repair (LIVE, deterministic)', () => {
    const OWNER_ID = 'attacker';
    const ENEMY_ALLY_ID = 'syn-enemy-ally';
    const SPEED_UP = 'Speed Up III';

    /** SYNAPTIC_RESONANCE legendary implant gear stub. */
    const synapticPiece = makePiece({
        id: 'syn-legendary',
        slot: 'implant_major',
        rarity: 'legendary',
        setBonus: 'SYNAPTIC_RESONANCE',
    });

    /** A basic 100% hit (so the focus dents the enemy ally → opens the deficit its self-heal fills). */
    const hitActive: Ability = {
        id: 'syn-hit',
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier: 100, hits: 1 },
    };

    /** Build the owner's ship skills: a damage active + the Synaptic Resonance passive (registry). */
    function buildSynapticShipSkills(): ShipSkills {
        const ship = makeShip({ implants: { implant_major: 'syn-legendary' } });
        const getGearPiece = makeGetGearPiece({ 'syn-legendary': synapticPiece });
        const baseSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece);
        const passive = baseSkills.slots.find((s) => s.slot === 'passive');
        // Pre-condition: the Synaptic Resonance on-enemy-repaired buff grant landed in the passive slot.
        const syn = passive?.abilities.find((a) =>
            a.id.startsWith('equip-implant-SYNAPTIC_RESONANCE')
        );
        expect(syn).toBeDefined();
        expect(syn!.trigger).toBe('on-enemy-repaired');
        expect(syn!.target).toBe('self');
        expect(syn!.config.type).toBe('buff');
        expect(syn!.procChance).toBeUndefined(); // deterministic — no proc gate

        return {
            slots: [
                { slot: 'active', abilities: [hitActive] },
                ...(passive ? [{ slot: passive.slot, abilities: passive.abilities }] : []),
            ],
        };
    }

    /** An enemy ally that takes the focus's dent each round and self-heals it back (HP-restoring
     *  → heal-performed with an opposing caster → on-enemy-repaired fires for the player owner).
     *  Mirrors nayraEnemyRepairedPurge.test.ts's deficit→self-heal sequence. Acts FIRST (fast) so
     *  by round 2 it consumes the round-1 deficit (> 0 → a real repair). */
    function makeRepairingEnemyAlly() {
        return {
            id: ENEMY_ALLY_ID,
            stats: { attack: 1, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 200 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: {
                slots: [
                    {
                        slot: 'active' as const,
                        abilities: [
                            // Self-heal 10% of own max HP — consumes any HP deficit (> 0 → repaired).
                            {
                                id: 'syn-enemy-self-heal',
                                type: 'heal' as const,
                                target: 'self' as const,
                                trigger: 'on-cast' as const,
                                conditions: [],
                                config: { type: 'heal' as const, pct: 10, basis: 'target-hp' },
                            },
                        ],
                    },
                ],
            } as ShipSkills,
        };
    }

    /** Collect buff-applied events for the owner with the Synaptic buff name. */
    function collectGrants(input: CombatEngineInput): CombatEvent[] {
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        bus.on('buff-applied', (e) => events.push(e as CombatEvent));
        runCombat({ ...input, bus });
        return events.filter(
            (e) => e.type === 'buff-applied' && e.actorId === OWNER_ID && e.buffName === SPEED_UP
        );
    }

    it(
        'Owner equipped with SYNAPTIC_RESONANCE gains Speed Up III when an enemy is directly ' +
            'repaired (on-enemy-repaired, deterministic — no proc flakiness)',
        () => {
            // The focus (slow, acts last) dents the enemy ally each round; the enemy ally (fast)
            // self-heals the prior-round deficit → a real enemy repair → heal-performed (opposing
            // caster) → Synaptic Resonance grants Speed Up III to the owner.
            const grants = collectGrants(
                BASE({
                    attack: 5_000,
                    crit: 0,
                    critDamage: 0,
                    numRounds: 3,
                    enemyHp: 1_000_000_000,
                    hp: 1_000_000,
                    speed: 100, // focus acts AFTER the enemy ally (200) — irrelevant for the listener,
                    // but mirrors the established deficit→heal cadence.
                    shipSkills: buildSynapticShipSkills(),
                    enemyAttackers: [makeRepairingEnemyAlly()],
                })
            );

            // The enemy was repaired → on-enemy-repaired fired → owner gained Speed Up III at least once.
            expect(grants.length).toBeGreaterThanOrEqual(1);
        }
    );

    it('Control: no enemy repair → Synaptic Resonance never fires (owner gains no Speed Up III)', () => {
        // Same owner + Synaptic implant, but the enemy ally NEVER self-heals (no heal-performed →
        // on-enemy-repaired never fires). The grant must be absent — proving the trigger is keyed
        // to a genuine enemy repair, not merely to the implant's presence.
        const nonHealingEnemyAlly = {
            id: ENEMY_ALLY_ID,
            stats: { attack: 1, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 200 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: {
                slots: [
                    {
                        slot: 'active' as const,
                        abilities: [
                            {
                                id: 'syn-enemy-hit',
                                type: 'damage' as const,
                                target: 'enemy' as const,
                                trigger: 'on-cast' as const,
                                conditions: [],
                                config: { type: 'damage' as const, multiplier: 100, hits: 1 },
                            },
                        ],
                    },
                ],
            } as ShipSkills,
        };

        const grants = collectGrants(
            BASE({
                attack: 5_000,
                crit: 0,
                critDamage: 0,
                numRounds: 3,
                enemyHp: 1_000_000_000,
                hp: 1_000_000,
                speed: 100,
                shipSkills: buildSynapticShipSkills(),
                enemyAttackers: [nonHealingEnemyAlly],
            })
        );

        expect(grants).toHaveLength(0);
    });
});

describe('D-PR8 Task 6 integration — Ambush gate via seeded Stealth (start-of-round self-buff)', () => {
    const OWNER_ID = 'attacker';
    const CRIT_POWER_UP = 'Crit Power Up III';
    const STEALTH = 'Stealth';
    const NUM_ROUNDS = 2;

    /** A no-op active so the owner takes a turn each round (deals no damage). */
    const noopActive: Ability = {
        id: 'amb-noop',
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier: 0 },
    };

    /** Hand-built Ambush-shaped reactive buff: procChance OMITTED so the proc gate always passes,
     *  isolating the self-buff/Stealth gate. start-of-round, self, Crit Power Up III for 1 turn. */
    const ambushBuff: Ability = {
        id: 'ambush-shaped-buff',
        type: 'buff',
        target: 'self',
        trigger: 'start-of-round',
        conditions: [{ subject: 'self-buff', buffName: STEALTH, derivable: true }],
        config: {
            type: 'buff',
            buffName: CRIT_POWER_UP,
            parsedEffects: {},
            stacks: 1,
            isStackable: false,
            duration: 1,
        },
    };

    /** Ship skills: a no-op active + the Ambush-shaped buff in the passive slot. */
    const ambushSkills: ShipSkills = {
        slots: [
            { slot: 'active', abilities: [noopActive] },
            { slot: 'passive', abilities: [ambushBuff] },
        ],
    };

    /** A recurring 'Stealth' self-buff seeded on the owner ('attacker'). Recurring (always-active)
     *  scheduled self-buffs surface in snapshot('attacker').activeSelfBuffs from round 1, so the
     *  start-of-round drain gate sees Stealth in its selfBuffNames. */
    const stealthSeed: SelectedGameBuff = {
        id: 'seed-stealth',
        buffName: STEALTH,
        stacks: 1,
        parsedEffects: {},
        isStackable: false,
        skillDuration: 'recurring',
        autoFilled: false,
    };

    /** Collect buff-applied events for the owner with the Crit Power Up buff name. */
    function collectGrants(input: CombatEngineInput): CombatEvent[] {
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        bus.on('buff-applied', (e) => events.push(e as CombatEvent));
        runCombat({ ...input, bus });
        return events.filter(
            (e) =>
                e.type === 'buff-applied' && e.actorId === OWNER_ID && e.buffName === CRIT_POWER_UP
        );
    }

    it('Stealth present on the owner → start-of-round self-buff gate met → Crit Power Up III IS granted', () => {
        const grants = collectGrants(
            BASE({
                attack: 0,
                numRounds: NUM_ROUNDS,
                hp: 100_000,
                shipSkills: ambushSkills,
                selfBuffs: [stealthSeed], // recurring Stealth → visible at start-of-round each round
            })
        );
        // Gate met every round → at least one Crit Power Up III grant.
        expect(grants.length).toBeGreaterThanOrEqual(1);
    });

    it('Stealth ABSENT → self-buff gate fails → Crit Power Up III is NOT granted', () => {
        const grants = collectGrants(
            BASE({
                attack: 0,
                numRounds: NUM_ROUNDS,
                hp: 100_000,
                shipSkills: ambushSkills,
                selfBuffs: [], // no Stealth → gate's selfBuffNames lacks Stealth → never fires
            })
        );
        expect(grants).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// D-PR9 — Spearhead: on-charged-cast all-allies Attack Up I grant
// ---------------------------------------------------------------------------
//
// Spearhead (legendary, procChance 0.32): "After using the charged skill, X% chance to
// grant all allies Attack Up I for 1 turn." It rides the `on-charged-cast` reactive
// trigger — a self-scoped listener on the `skill-fired` event matching
// (actorId === ownerId && slot === 'charged'). The reactive buff executor honors
// procChance via the deterministic makeRateGate accumulator keyed `${ownerId}:${abilityId}`.
//
// Driven through `simulateBattle` (not raw runCombat) because the grant targets ALL
// player allies — a multi-ship player team is required to prove "every ally (incl. the
// carrier) gets the buff" and to prove the LIVE damage effect on an ally.
//
// Determinism: with chargeSkillCharge=1 the focus fires its CHARGED skill on the even
// rounds (2, 4, 6, …) — charged casts ≈ floor(rounds / 2). procChance 0.32 over C charged
// casts fires floor(C × 0.32) times (back-loaded accumulator). At 16 rounds → 8 charged
// casts → floor(8 × 0.32) = 2 fires. There is NO proc=1 override; we run enough qualifying
// charged casts that the accumulator fires and assert presence + the LIVE effect.

// ---------------------------------------------------------------------------
// D-PR9 — Font of Power: on-own-repair-to-ally Power Infused Nanobots grant
// ---------------------------------------------------------------------------
//
// Font of Power (legendary, procChance 0.16): "When applying repair to another ally,
// there is a 16% chance to grant Power Infused Nanobots for 1 turn." It rides the
// `on-own-repair-to-ally` reactive trigger — a self-scoped listener on `heal-performed`
// matching casterId === ownerId with >= 1 NON-self recipient. One enqueue per qualifying
// repair cast → one proc-gate roll; the grant fans out to every repaired non-self ally
// via eventCtx.repairedAllyIds. Power Infused Nanobots now grants flat attack = 100% of
// the caster's attack (snapshotted at grant time, D-PR10); we assert PRESENCE + fan-out.
//
// Driven through `simulateBattle` because the carrier must repair an OTHER ally — the
// engine routes a non-focus team actor's bare ally-repair to the heal target (the focus
// 'attacker'), and an all-allies repair to every player id. The carrier is therefore
// player[1] (a minted p:… id), and the focus player[0] is the repaired non-self ally.
//
// Determinism: the proc rides a makeRateGate accumulator keyed `${ownerId}:${abilityId}`,
// firing floor(N × 0.16) over N qualifying repair casts (back-loaded). The carrier repairs
// once per round it acts, so over R rounds N ≈ R. At 16 rounds → floor(16 × 0.16) = 2 fires.
// There is NO proc=1 override; we run enough qualifying casts that the accumulator fires
// and assert presence + fan-out / self-exclusion / self-only-no-grant.

describe('Font of Power — on-own-repair-to-ally Power Infused Nanobots', () => {
    const NANOBOTS = 'Power Infused Nanobots';

    /** Legendary FONT_OF_POWER implant piece (proc 0.16). */
    const fontPiece = makePiece({
        id: 'font-legendary',
        slot: 'implant_major',
        rarity: 'legendary',
        setBonus: 'FONT_OF_POWER',
    });

    const getGearPiece = makeGetGearPiece({ 'font-legendary': fontPiece });

    /**
     * Build a player-team ship. `repair` controls the active skill text:
     *  - 'ally'        → bare repair (no damage) → the support-flip routes it to a single
     *                    ally; for a non-focus caster that ally is the heal target (focus).
     *  - 'all-allies'  → explicit "all allies" repair → every player id (caster + others).
     *  - 'self'        → explicit "itself" repair → self only (no other ally repaired).
     *  - 'damage'      → a plain 100% damage attacker (the focus punching the enemy).
     * Optionally carries the FONT_OF_POWER implant. Support type so the bare repair flips.
     */
    function makeTeamShip(
        id: string,
        name: string,
        opts: { repair?: 'ally' | 'all-allies' | 'self' | 'damage'; withFont?: boolean } = {}
    ): Ship {
        const repair = opts.repair ?? 'damage';
        const activeSkillText =
            repair === 'damage'
                ? 'This Unit deals <unit-damage>100% damage</unit-damage>.'
                : repair === 'all-allies'
                  ? 'This Unit repairs all allies for 30% of their Max HP.'
                  : repair === 'self'
                    ? 'This Unit repairs itself for 30% of its Max HP.'
                    : 'This Unit repairs 30% of its Max HP.';
        return makeShip({
            id,
            name,
            rarity: 'legendary',
            faction: 'TERRAN_COMBINE',
            type: repair === 'damage' ? 'Attacker' : 'Support',
            baseStats: {
                hp: 0,
                attack: 0,
                defence: 0,
                hacking: 200,
                security: 100,
                crit: 0,
                critDamage: 0,
                speed: 100,
            } as Ship['baseStats'],
            equipment: {},
            implants: opts.withFont ? { implant_major: 'font-legendary' } : {},
            refits: [],
            affinity: 'antimatter',
            activeSkillText,
            chargeSkillCharge: 0,
            // Bare/ally/all-allies repairs target the ally side; damage targets the front enemy.
            activeTarget: repair === 'damage' ? 'front' : 'allies',
            activePattern: 'Pattern-Base',
        } as Partial<Ship>);
    }

    const place = (
        ship: Ship,
        position: Position,
        attack: number,
        hp: number
    ): BattlePlacement => ({
        ship,
        position,
        statOverrides: {
            attack,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 200,
            defence: 0,
            hp,
        },
    });

    const ROUNDS = 16; // carrier repairs each round → floor(16 × 0.16) = 2 proc fires

    /** Collect every actorId that ever received a Power Infused Nanobots GRANT (combatLog). */
    function buffedActors(result: ReturnType<typeof simulateBattle>): Set<string> {
        const set = new Set<string>();
        for (const entry of flattenCombatLog(result)) {
            if (entry.kind === 'buff' && entry.note === NANOBOTS) set.add(entry.actorId);
        }
        return set;
    }

    it('carrier repairs another ally → the repaired NON-SELF ally gets Power Infused Nanobots; carrier does NOT', () => {
        // player[0] = focus (the heal target / repaired ally). player[1] = the Font-of-Power
        // carrier whose bare ally-repair routes to the focus each round. Over 16 casts the
        // accumulator fires → the focus carries the buff; the carrier (caster) never does.
        const result = simulateBattle(
            {
                playerTeam: [
                    place(
                        makeTeamShip('focus', 'Focus', { repair: 'damage' }),
                        'M4',
                        5000,
                        1_000_000_000
                    ),
                    place(
                        makeTeamShip('carrier', 'Carrier', { repair: 'ally', withFont: true }),
                        'M3',
                        0,
                        1_000_000_000
                    ),
                ],
                enemyTeam: [
                    place(
                        makeTeamShip('enemy', 'Enemy', { repair: 'damage' }),
                        'M4',
                        1,
                        1_000_000_000
                    ),
                ],
                rounds: ROUNDS,
            },
            getGearPiece
        );

        const buffed = buffedActors(result);
        const FOCUS = 'attacker';
        const CARRIER = 'p:carrier:1';

        // The repaired non-self ally (the focus) carries the buff at least once.
        expect(buffed.has(FOCUS)).toBe(true);
        // The carrier (the caster / repairer) is excluded — it is not a repaired non-self ally.
        expect(buffed.has(CARRIER)).toBe(false);
        // No enemy ever received the grant (ally-side only).
        const enemyIds = result.roster.filter((r) => r.side === 'enemy').map((r) => r.actorId);
        for (const id of enemyIds) expect(buffed.has(id)).toBe(false);
    });

    it('pure self-only repair (no other ally repaired) grants NOTHING', () => {
        // The carrier repairs ITSELF only → heal-performed targets = [carrier] → the
        // on-own-repair-to-ally listener finds zero non-self recipients → never enqueues.
        const result = simulateBattle(
            {
                playerTeam: [
                    place(
                        makeTeamShip('focus', 'Focus', { repair: 'damage' }),
                        'M4',
                        5000,
                        1_000_000_000
                    ),
                    place(
                        makeTeamShip('carrier', 'Carrier', { repair: 'self', withFont: true }),
                        'M3',
                        0,
                        1_000_000_000
                    ),
                ],
                enemyTeam: [
                    place(
                        makeTeamShip('enemy', 'Enemy', { repair: 'damage' }),
                        'M4',
                        1,
                        1_000_000_000
                    ),
                ],
                rounds: ROUNDS,
            },
            getGearPiece
        );

        expect(buffedActors(result).size).toBe(0);
    });

    it('AoE repair reaching multiple OTHER allies grants the buff to all of them (one proc, fan-out)', () => {
        // The carrier (player[2]) repairs ALL allies → recipients = every player id. The two
        // OTHER allies (focus + ally1) are repaired non-self → a single proc fan-outs to both.
        // Font of Power's on-own-repair-to-ally proc gate now carries a `${ownerId}:proc`
        // stream key (triggers.ts) — under SP-0's keyed test provider, this specific carrier's
        // `p:carrier:2:proc` sub-stream happens to fail all 16 rolls at the fixed test seed
        // (a real, if unlucky, Bernoulli(0.16) outcome — not a mis-keyed gate). This test only
        // asserts WHERE the grant lands (non-self recipients, not the caster), not an exact
        // proc count, so force always-fire to make that assertion deterministic and robust.
        setRateGateRng(() => 0);
        setKeyedRng(() => 0);
        const result = simulateBattle(
            {
                playerTeam: [
                    place(
                        makeTeamShip('focus', 'Focus', { repair: 'damage' }),
                        'M4',
                        5000,
                        1_000_000_000
                    ),
                    place(
                        makeTeamShip('ally1', 'Ally1', { repair: 'damage' }),
                        'M2',
                        5000,
                        1_000_000_000
                    ),
                    place(
                        makeTeamShip('carrier', 'Carrier', {
                            repair: 'all-allies',
                            withFont: true,
                        }),
                        'M3',
                        0,
                        1_000_000_000
                    ),
                ],
                enemyTeam: [
                    place(
                        makeTeamShip('enemy', 'Enemy', { repair: 'damage' }),
                        'M4',
                        1,
                        1_000_000_000
                    ),
                ],
                rounds: ROUNDS,
            },
            getGearPiece
        );

        const buffed = buffedActors(result);
        const FOCUS = 'attacker';
        const ALLY1 = 'p:ally1:1';
        const CARRIER = 'p:carrier:2';

        // Both OTHER allies received the grant; the carrier (caster) did not.
        expect(buffed.has(FOCUS)).toBe(true);
        expect(buffed.has(ALLY1)).toBe(true);
        expect(buffed.has(CARRIER)).toBe(false);
    });

    // ── D-PR10 Task 4 — caster-attack snapshot into the grant ────────────────
    //
    // PIN's description "Grants attack equal to 100% of the caster's attack" parses to the
    // `attackFlatPctOfCaster: 100` sentinel. At grant time the trigger must freeze a concrete
    // `attackFlat` = (CASTER's effective attack) × 100/100 into the per-instance payload, so
    // the recipient's effective attack — and thus its damage output — rises by the caster's
    // effective attack (NOT the recipient's own attack).
    //
    // Harness: the carrier is a Font-of-Power AoE-repair support with statOverrides.attack =
    // casterAttack; the FOCUS attacker (a non-self repaired recipient) has a DIFFERENT base
    // attack and is the only thing punching the enemy, so the focus's `damageDealt` isolates
    // the recipient's attack. PIN is 1-turn, granted on the carrier's turn → it folds into
    // the focus's same-round attack. Determinism mirrors the presence tests: floor(16×0.16)=2
    // proc fires, identical across runs (back-loaded makeRateGate accumulator), so the boosted
    // turn count is the same in every run → the damage delta tracks ONLY the caster's attack.
    describe('D-PR10 — caster-attack snapshot raises the recipient by the CASTER attack', () => {
        // The first player attacker's runtime actorId, which simulateBattle reassigns to
        // 'attacker' regardless of the makeTeamShip id passed in.
        const FOCUS = 'attacker';

        /** Sum the FOCUS recipient's per-round damageDealt across the whole battle. */
        const focusDamage = (result: ReturnType<typeof simulateBattle>): number => {
            let total = 0;
            for (const round of result.rounds) {
                for (const ship of round.ships) {
                    if (ship.actorId === FOCUS) total += ship.damageDealt;
                }
            }
            return total;
        };

        /**
         * Focus = a damage attacker (recipient, base attack 1000). Carrier = Font-of-Power
         * AoE-repair support at `casterAttack`. The enemy is a fat bag so the battle runs all
         * rounds. `withFont=false` drops the implant for a clean no-PIN baseline.
         */
        const run = (casterAttack: number, withFont: boolean) =>
            simulateBattle(
                {
                    playerTeam: [
                        place(
                            makeTeamShip('focus', 'Focus', { repair: 'damage' }),
                            'M4',
                            1000, // recipient's OWN base attack — deliberately != casterAttack
                            1_000_000_000
                        ),
                        place(
                            makeTeamShip('carrier', 'Carrier', {
                                repair: 'all-allies',
                                withFont,
                            }),
                            'M3',
                            casterAttack,
                            1_000_000_000
                        ),
                    ],
                    enemyTeam: [
                        place(
                            makeTeamShip('enemy', 'Enemy', { repair: 'damage' }),
                            'M4',
                            1,
                            1_000_000_000
                        ),
                    ],
                    rounds: ROUNDS,
                },
                getGearPiece
            );

        it('PIN raises the recipient damage above the no-PIN baseline, and the increase tracks the CASTER attack (not the recipient)', () => {
            // Font of Power's proc gate carries a `${ownerId}:proc` stream key (triggers.ts).
            // This test calls `run()` three times with the SAME carrier id, so under SP-0's
            // keyed test provider each call continues the prior call's `p:carrier:...:proc`
            // sub-stream rather than starting fresh — an unlucky continuation can make one run
            // proc more/less than another, breaking the cross-run delta comparison below (the
            // magnitude/source assertions need PIN to proc consistently in EVERY PIN run, not
            // "however many times this specific stream position happens to fire"). Force
            // always-fire so the comparison isolates the caster-attack snapshot, not proc luck.
            setRateGateRng(() => 0);
            setKeyedRng(() => 0);
            const baseline = focusDamage(run(8000, false)); // no Font → no PIN
            const withLowCaster = focusDamage(run(4000, true)); // PIN snapshots caster=4000
            const withHighCaster = focusDamage(run(20000, true)); // PIN snapshots caster=20000

            // (a) Magnitude: PIN can only ADD attack (crit=0 → otherwise-constant per-round
            // damage), so a granted run strictly exceeds the identical no-PIN baseline.
            expect(withLowCaster).toBeGreaterThan(baseline);
            expect(withHighCaster).toBeGreaterThan(baseline);

            // (b) Source: the only thing differing between the two PIN runs is the CASTER's
            // attack. If the snapshot wrongly used the recipient's own attack (1000, identical
            // in both runs), the two deltas would be EQUAL. A bigger caster attack must yield a
            // strictly bigger recipient-damage increase → the boost is sourced from the caster.
            const deltaLow = withLowCaster - baseline;
            const deltaHigh = withHighCaster - baseline;
            expect(deltaHigh).toBeGreaterThan(deltaLow);

            // The deltas scale ~5× with the 5× caster-attack change (4000 → 20000). Allow a
            // wide band (other folds, rounding) but require it is clearly proportional, not a
            // flat recipient-sourced offset.
            expect(deltaHigh).toBeGreaterThan(deltaLow * 3);
        });
    });
});

describe('Spearhead — on-charged-cast all-allies Attack Up I', () => {
    // Spearhead's all-allies grant is procChance-gated (0.32). Force always-fire so the grant
    // fans on each charged cast — recovers the deterministic "fires ≥ once" intent. crit:0 gates
    // never fire regardless (0 < 0 is false).
    afterEach(() => resetRateGateRng());
    const ATTACK_UP_I = 'Attack Up I';

    /** Legendary SPEARHEAD implant piece (proc 0.32). */
    const spearheadPiece = makePiece({
        id: 'spearhead-legendary',
        slot: 'implant_major',
        rarity: 'legendary',
        setBonus: 'SPEARHEAD',
    });

    /**
     * Build a player team ship where the focus optionally carries the SPEARHEAD implant
     * and has a CHARGED skill (chargeSkillCharge=1 → charged fires on even rounds). A plain
     * second ally proves the all-allies grant + LIVE effect. The enemy is a fat punching
     * bag so nobody dies and the battle runs full rounds.
     */
    function makeTeamShip(
        id: string,
        name: string,
        opts: { withSpearhead?: boolean; withCharge?: boolean } = {}
    ): Ship {
        return makeShip({
            id,
            name,
            rarity: 'legendary',
            faction: 'TERRAN_COMBINE',
            type: 'Attacker',
            baseStats: {
                hp: 0,
                attack: 0,
                defence: 0,
                hacking: 200,
                security: 100,
                crit: 0,
                critDamage: 0,
                speed: 100,
            } as Ship['baseStats'],
            equipment: {},
            implants: opts.withSpearhead ? { implant_major: 'spearhead-legendary' } : {},
            refits: [],
            affinity: 'antimatter',
            // Single-hit 100% active damage skill (real damage ability via skillTextParser).
            activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
            // A charged skill so the focus can fire CHARGED (chargeSkillCharge=1 → even rounds).
            ...(opts.withCharge
                ? {
                      chargeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
                      chargeSkillCharge: 1,
                  }
                : { chargeSkillCharge: 0 }),
            activeTarget: 'front',
            activePattern: 'Pattern-Base',
        } as Partial<Ship>);
    }

    const place = (
        ship: Ship,
        position: Position,
        attack: number,
        hp: number
    ): BattlePlacement => ({
        ship,
        position,
        statOverrides: {
            attack,
            crit: 0, // no crit variance → per-round damage is constant except when buffed
            critDamage: 0,
            defensePenetration: 0,
            hacking: 200,
            defence: 0,
            hp,
        },
    });

    const getGearPiece = makeGetGearPiece({ 'spearhead-legendary': spearheadPiece });

    const ROUNDS = 16; // 8 charged casts → floor(8 × 0.32) = 2 proc fires

    /** Run a battle with a 2-ship player team; the focus optionally carries Spearhead. */
    function runBattle(withSpearhead: boolean) {
        return simulateBattle(
            {
                playerTeam: [
                    // Focus: charged skill + (optionally) Spearhead.
                    place(
                        makeTeamShip('focus', 'Focus', { withSpearhead, withCharge: true }),
                        'M4',
                        5000,
                        1_000_000_000
                    ),
                    // Plain ally — receives the all-allies grant; proves the LIVE effect.
                    place(makeTeamShip('ally', 'Ally', {}), 'M3', 5000, 1_000_000_000),
                ],
                enemyTeam: [place(makeTeamShip('enemy', 'Enemy', {}), 'M4', 1, 1_000_000_000)],
                rounds: ROUNDS,
            },
            getGearPiece
        );
    }

    it('after charged-skill casts, the accumulator fires and grants Attack Up I to EVERY player ally (focus + ally)', () => {
        setRateGateRng(() => 0); // always-fire the Spearhead procChance gate
        const result = runBattle(true);

        // Player roster ids: focus is the reserved 'attacker'; the ally is a minted p:… id.
        const playerIds = result.roster.filter((r) => r.side === 'player').map((r) => r.actorId);
        expect(playerIds.length).toBe(2);

        // Collect every actorId that ever received an Attack Up I GRANT, via the round event
        // log's buff lines (the buff-applied source). The end-of-round `activeBuffs` snapshot is
        // unreliable for the carrier here: the carrier grants the 1-turn buff on its OWN turn,
        // so it has already expired by the round-end snapshot — but the application still
        // happened (and folded into that turn's damage). The buff log captures every recipient.
        const buffedActors = new Set(
            flattenCombatLog(result)
                .filter((e) => e.kind === 'buff' && e.note === ATTACK_UP_I)
                .map((e) => e.actorId)
        );

        // Every player ally — including the carrier — got the buff at least once.
        for (const id of playerIds) {
            expect(buffedActors.has(id)).toBe(true);
        }
        // No enemy ever received the grant (all-allies = the caster's side only).
        const enemyIds = result.roster.filter((r) => r.side === 'enemy').map((r) => r.actorId);
        for (const id of enemyIds) {
            expect(buffedActors.has(id)).toBe(false);
        }
    });

    it('LIVE: total player damage with Spearhead strictly exceeds the no-Spearhead baseline (Attack Up I folds into attack)', () => {
        const sumPlayerDamage = (result: ReturnType<typeof simulateBattle>): number => {
            let total = 0;
            for (const round of result.rounds) {
                for (const ship of round.ships) {
                    if (ship.side === 'player') total += ship.damageDealt;
                }
            }
            return total;
        };

        setRateGateRng(() => 0); // always-fire the Spearhead procChance gate
        const withSpear = sumPlayerDamage(runBattle(true));
        const without = sumPlayerDamage(runBattle(false));

        // crit=0 → per-round damage is otherwise constant; Attack Up I (+15% Attack) can only
        // ADD. At least one proc fire → strictly more total player damage.
        expect(withSpear).toBeGreaterThan(without);
    });

    it('when the carrier fires its ACTIVE skill (no charged skill), NO Attack Up I is granted', () => {
        // Focus WITH Spearhead but WITHOUT a charged skill → it only ever fires ACTIVE →
        // skill-fired.slot is always 'active' → on-charged-cast never matches → no grant.
        const result = simulateBattle(
            {
                playerTeam: [
                    place(
                        makeTeamShip('focus', 'Focus', { withSpearhead: true, withCharge: false }),
                        'M4',
                        5000,
                        1_000_000_000
                    ),
                    place(makeTeamShip('ally', 'Ally', {}), 'M3', 5000, 1_000_000_000),
                ],
                enemyTeam: [place(makeTeamShip('enemy', 'Enemy', {}), 'M4', 1, 1_000_000_000)],
                rounds: ROUNDS,
            },
            getGearPiece
        );

        const grantedAttackUp = flattenCombatLog(result).some(
            (e) => e.kind === 'buff' && e.note === ATTACK_UP_I
        );
        expect(grantedAttackUp).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// D-PR11 integration — Fortifying Shroud adjacent-allies buff: positional
//   recipient resolution through the real engine delegate (board positions wired).
//
// Goal: prove that when an owner with `target:'adjacent-allies'` + `trigger:'start-of-turn'`
// fires its start-of-turn reactive buff, ONLY the living allies on neighbouring board cells
// receive the buff — NOT the owner itself, NOT a non-adjacent ally.
//
// Board layout (M2 neighbours per board.ts: T1, T2, M1, M3, B1, B2):
//   Owner  : M2  (the focus 'attacker')
//   ally-T2: T2  (adjacent   → must receive the buff)
//   ally-M3: M3  (adjacent   → must receive the buff)
//   ally-B4: B4  (NON-adjacent → must NOT receive the buff — the crux non-vacuity assertion)
//
// Test strategy:
//   Inject the Fortifying-Shroud-shaped ability directly into the focus actor's passive slot
//   (procChance omitted → deterministic, fires every owner turn), run 1 round, and collect
//   'buff-applied' events via the event bus. Assert the actorId set exactly: {ally-T2, ally-M3}.
//   A second test mirrors this on the ENEMY SIDE to prove team-agnosticism.
//
// Why a test ability rather than the real registry implant:
//   The legendary Fortifying Shroud procChance (0.32) is non-deterministic over a single turn;
//   verifying adjacency via the real registry implant would require running enough rounds to
//   force a proc, making the test fragile. By dropping procChance we get determinism and keep
//   the assertion focused on the adjacency + trigger + engine-delegate path (which is exactly
//   what Task 5 registers and D-PR11 T3 already proved at the executor level — this task proves
//   it end-to-end through runCombat with real board positions).
// ---------------------------------------------------------------------------

/** Minimal walked team actor placed at a board position. No skills, high HP, no damage. */
function makePositionedAlly(id: string, position: Position): TeamActorEngineInput {
    return {
        id,
        speed: 50, // slower than the focus (100) so the focus always acts first
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        walk: {
            shipSkills: { slots: [] },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 1_000_000_000,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    };
}

/** The Fortifying Shroud ability with procChance OMITTED for determinism.
 *  Fires on start-of-turn (self-scoped) and grants 'Defense Up I' to adjacent allies. */
const fortifyingShroudAbility: Ability = {
    id: 'test-fortifying-shroud',
    type: 'buff',
    target: 'adjacent-allies',
    trigger: 'start-of-turn',
    conditions: [],
    // No procChance → the proc gate is absent → buff fires on every owner turn (deterministic).
    config: {
        type: 'buff',
        buffName: 'Defense Up I',
        stacks: 1,
        isStackable: false,
        duration: 1,
        parsedEffects: {},
    },
    autoFilled: true,
};

/** A no-op active so the focus actor takes a turn (required to emit turn-started). */
const noopDmgActive: Ability = {
    id: 'noop-dmg',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0 },
};

/** Base engine input for the Fortifying Shroud tests: focus at M2, healing mode (required
 *  for team actors), 1 round. The event bus is injected per-call so we can observe events. */
function makeShroudInput(
    bus: ReturnType<typeof createEventBus>,
    teamActors: TeamActorEngineInput[],
    opts: { focusPosition?: Position; side?: 'player' } = {}
): CombatEngineInput {
    return {
        attack: 1,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: {
            slots: [
                { slot: 'active', abilities: [noopDmgActive] },
                { slot: 'passive', abilities: [fortifyingShroudAbility] },
            ],
        },
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
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
        defence: 0,
        hp: 1_000_000_000,
        // Healing mode is required to use team actors.
        healTargetId: 'attacker',
        position: opts.focusPosition ?? 'M2',
        teamActors,
        bus,
        speed: 100,
    };
}

describe('D-PR11 integration — Fortifying Shroud: positional adjacent-allies buff (player side)', () => {
    /**
     * Board layout:
     *   Owner  : M2  (focus 'attacker')
     *   ally-T2: T2  (adjacent to M2 — receives Defense Up I)
     *   ally-M3: M3  (adjacent to M2 — receives Defense Up I)
     *   ally-B4: B4  (NON-adjacent to M2 — must NOT receive the buff; the crux assertion)
     *
     * After the owner's first turn (start-of-turn fires the ability), we expect exactly:
     *   - ally-T2 got Defense Up I
     *   - ally-M3 got Defense Up I
     *   - 'attacker' (owner) did NOT get the buff
     *   - ally-B4 (non-adjacent) did NOT get the buff
     */
    it('buff lands on exactly the two adjacent allies (T2, M3) — NOT the owner, NOT the non-adjacent ally (B4)', () => {
        const bus = createEventBus();

        const buffGrantedTo = new Set<string>();
        bus.on('buff-applied', (e) => {
            if (e.buffName === 'Defense Up I') buffGrantedTo.add(e.actorId);
        });

        const teamActors: TeamActorEngineInput[] = [
            makePositionedAlly('ally-T2', 'T2'),
            makePositionedAlly('ally-M3', 'M3'),
            makePositionedAlly('ally-B4', 'B4'),
        ];

        runCombat(makeShroudInput(bus, teamActors));

        // Adjacent allies get the buff.
        expect(buffGrantedTo.has('ally-T2')).toBe(true);
        expect(buffGrantedTo.has('ally-M3')).toBe(true);

        // Non-vacuity: the non-adjacent ally must NOT have the buff.
        expect(buffGrantedTo.has('ally-B4')).toBe(false);

        // The owner must NOT grant the buff to itself.
        expect(buffGrantedTo.has('attacker')).toBe(false);

        // Exactly two recipients — no spurious extras.
        expect(buffGrantedTo.size).toBe(2);
    });

    it('without board positions (non-positional): buff falls back to all same-side allies (all-allies)', () => {
        // When no positions are wired, adjacentAllyIds falls back to all living same-side
        // allies (owner excluded). The ability still fires (start-of-turn, no procChance),
        // and all three team actors receive the buff.
        const bus = createEventBus();

        const buffGrantedTo = new Set<string>();
        bus.on('buff-applied', (e) => {
            if (e.buffName === 'Defense Up I') buffGrantedTo.add(e.actorId);
        });

        // Team actors without position (non-positional path).
        const teamActors: TeamActorEngineInput[] = [
            makePositionedAlly('ally-A', 'T2'),
            makePositionedAlly('ally-B', 'M3'),
            makePositionedAlly('ally-C', 'B4'),
        ].map((a) => ({ ...a, position: undefined }));

        // Focus also without position.
        const input: CombatEngineInput = {
            ...makeShroudInput(bus, teamActors),
            position: undefined,
        };

        runCombat(input);

        // Without positions all three allies get the buff (all-allies fallback).
        expect(buffGrantedTo.has('ally-A')).toBe(true);
        expect(buffGrantedTo.has('ally-B')).toBe(true);
        expect(buffGrantedTo.has('ally-C')).toBe(true);
        // Owner still excluded (adjacentAllyIds always excludes the owner).
        expect(buffGrantedTo.has('attacker')).toBe(false);
        expect(buffGrantedTo.size).toBe(3);
    });
});

describe('D-PR11 integration — Fortifying Shroud: enemy-side mirror (team-agnosticism)', () => {
    /**
     * Mirror test: place the Fortifying Shroud owner on the ENEMY side to prove the engine's
     * `adjacentAllyIdsFor` delegate is correctly wired for enemy actors too.
     *
     * Setup: one enemy attacker at M2 carries the test ability; two enemy bystanders at T2
     * and M3 (adjacent); one enemy bystander at B4 (non-adjacent). The player team is the
     * focus ('attacker') and two passive allies, all with enough HP to survive.
     *
     * Observable: 'buff-applied' events — the enemy actor at M2 fires its start-of-turn
     * reactive buff; the engine's enemy-side sideCtx.adjacentAllyIdsFor routes the recipients
     * to exactly the enemy actors at T2 and M3, and B4 is excluded.
     *
     * Why we can observe enemy-side buffs: the status engine and bus are shared between player
     * and enemy turns, so enemy buff-applied events are emitted on the same bus.
     */
    it('enemy owner at M2 grants Defense Up I to enemy-side adjacent allies (T2, M3) — NOT B4', () => {
        const bus = createEventBus();

        const buffGrantedTo = new Set<string>();
        bus.on('buff-applied', (e) => {
            if (e.buffName === 'Defense Up I') buffGrantedTo.add(e.actorId);
        });

        /** A positioned enemy attacker (active skill: deal 0 damage; passive: Fortifying Shroud). */
        const shroudEnemy = (
            id: string,
            position: Position,
            withShroud: boolean
        ): NonNullable<CombatEngineInput['enemyAttackers']>[number] => ({
            id,
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                speed: 10, // all enemies slower than the focus (100); order within enemy side is speed-based
                defence: 0,
                hp: 1_000_000_000,
            },
            chargeCount: 0,
            startCharged: false,
            position,
            shipSkills: {
                slots: withShroud
                    ? [
                          { slot: 'active', abilities: [noopDmgActive] },
                          { slot: 'passive', abilities: [fortifyingShroudAbility] },
                      ]
                    : [{ slot: 'active', abilities: [noopDmgActive] }],
            },
        });

        const input: CombatEngineInput = {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: {
                slots: [{ slot: 'active', abilities: [noopDmgActive] }],
            },
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
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
            defence: 0,
            hp: 1_000_000_000,
            // Healing mode is required for enemy attackers to be populated.
            healTargetId: 'attacker',
            speed: 100,
            bus,
            enemyAttackers: [
                shroudEnemy('enemy-M2', 'M2', true), // the owner: carries Fortifying Shroud
                shroudEnemy('enemy-T2', 'T2', false), // adjacent to M2 → should receive buff
                shroudEnemy('enemy-M3', 'M3', false), // adjacent to M2 → should receive buff
                shroudEnemy('enemy-B4', 'B4', false), // NON-adjacent → must NOT receive buff
            ],
        };

        runCombat(input);

        // Adjacent enemy-side allies receive the buff.
        expect(buffGrantedTo.has('enemy-T2')).toBe(true);
        expect(buffGrantedTo.has('enemy-M3')).toBe(true);

        // Non-vacuity: the non-adjacent enemy ally must NOT have the buff.
        expect(buffGrantedTo.has('enemy-B4')).toBe(false);

        // The owner must NOT grant the buff to itself.
        expect(buffGrantedTo.has('enemy-M2')).toBe(false);

        // No player-side actor should ever receive an enemy-side buff grant.
        expect(buffGrantedTo.has('attacker')).toBe(false);

        // Exactly two recipients.
        expect(buffGrantedTo.size).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// D-PR (reactive cleanse) — Reactive Ward + Warpstrike duration-reduction
// ---------------------------------------------------------------------------
//
// Two implants resolve through the REAL equipment registry
// (buildShipAbilitiesWithEquipment / simulateBattle's getGearPiece arg):
//
//   Reactive Ward (REACTIVE_WARD): on-attacked reactive cleanse — when the carrier is
//     directly damaged, an X% chance (per rarity) to REMOVE 1 of the carrier's OWN debuffs,
//     or 2 if the triggering hit CRIT. Registry shape: trigger 'on-attacked', cleanse config
//     { mode:'remove', count:1, critCount:2, procChance:<rarity> }.
//
//   Warpstrike (WARPSTRIKE): TWO abilities —
//     (1) D-PR2 +X% outgoing-damage modifier while self-debuffed (on-cast modifier), and
//     (2) NEW: on-deal-damage reactive cleanse in 'reduce-duration' mode — each damage-dealing
//         turn while self-debuffed reduces the carrier's NEWEST own debuff by 1 turn
//         (durationTurns 1, DETERMINISTIC — no procChance).
//
// DETERMINISM THROUGH THE REAL REGISTRY (the D-PR16 lesson): the abilities below are built
// by `buildShipAbilitiesWithEquipment(makeShip({ setBonus }), getGearPiece)` and read out of
// the passive slot — NOT hand-rolled. For Reactive Ward (procChance < 1) we override the
// built ability's `procChance` to 1 for single-event determinism WHILE keeping every other
// field the registry produced (mode/count/critCount/trigger), so a registry mutation still
// fails a test. Warpstrike's reduce-duration half is already deterministic (no procChance).
//
// CARRIER SELF-DEBUFFS: a player carrier's OWN debuffs live in its per-target debuff store
// (statusEngine.enemyMaps[carrierId]), populated when an ENEMY applies a debuff to it
// (application:'apply' → always lands). Both implants act on / gate off that store. Healing
// mode (healTargetId='attacker') is required so the carrier is a heal-target whose
// cleanseCount credit is recorded per round.

describe('D-PR reactive cleanse — Reactive Ward (on-attacked) cleanses 1 / 2-on-crit', () => {
    const CARRIER_HP = 10_000;

    /** Legendary Reactive Ward implant piece (procChance 0.16 per registry). */
    const reactiveWardPiece = makePiece({
        id: 'rw-legendary',
        slot: 'implant_major',
        rarity: 'legendary',
        setBonus: 'REACTIVE_WARD',
    });

    /**
     * Build the Reactive Ward passive slot through the REAL registry, then override the built
     * ability's procChance to 1 for single-event determinism. The mode/count/critCount fields
     * stay exactly as the registry produced them, so a registry mutation (e.g. critCount→1)
     * still changes test behaviour.
     */
    function buildReactiveWardSlots(): ShipSkills['slots'] {
        const ship = makeShip({ implants: { implant_major: 'rw-legendary' } });
        const getGearPiece = makeGetGearPiece({ 'rw-legendary': reactiveWardPiece });
        const baseSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece);
        const passive = baseSkills.slots.find((s) => s.slot === 'passive');
        expect(passive).toBeDefined();
        const ward = passive!.abilities.find((a) => a.id.startsWith('equip-implant-REACTIVE_WARD'));
        // Pre-condition: the registry produced the on-attacked remove cleanse with crit-count 2.
        expect(ward).toBeDefined();
        expect(ward!.trigger).toBe('on-attacked');
        expect(ward!.config.type).toBe('cleanse');
        if (ward!.config.type === 'cleanse') {
            expect(ward!.config.mode ?? 'remove').toBe('remove');
            expect(ward!.config.count).toBe(1);
            expect(ward!.config.critCount).toBe(2);
        }
        // Force determinism for the single-hit assertion WITHOUT leaving the registry path:
        // mutate only procChance on the built ability (keeps mode/count/critCount/trigger).
        const determinized: Ability = { ...ward!, procChance: 1 };
        return [
            { slot: 'active', abilities: [noopWardActive] },
            { slot: 'passive', abilities: [determinized] },
        ];
    }

    /** No-op active so the carrier takes a turn (the cleanse itself fires reactively to the hit). */
    const noopWardActive: Ability = {
        id: 'noop-ward-active',
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier: 0 },
    };

    /**
     * A FAST enemy that, in one turn, applies THREE distinct removable debuffs to the carrier
     * (apply → always lands, distinct families so they coexist) AND lands one damaging hit.
     * `crit` controls whether that hit crits (→ critCount path). attack > 0 so the `attacked`
     * event is emitted and the on-attacked cleanse enqueues.
     */
    function debufferHitter(crit: number) {
        const debuff = (name: string): Ability => ({
            id: `rw-debuff-${name}`,
            type: 'debuff',
            target: 'enemy', // from the enemy's view the carrier is its enemy
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'debuff',
                buffName: name,
                parsedEffects: {},
                stacks: 1,
                isStackable: false,
                application: 'apply',
                duration: 9, // long enough to outlive the single round
            },
        });
        return {
            id: 'rw-enemy',
            stats: {
                attack: 200, // > 0 → attacked event emitted; small so it never kills the carrier
                crit,
                critDamage: 0,
                speed: 1_000, // faster than the carrier (acts first)
                defence: 0,
                hp: 1_000_000_000,
            },
            chargeCount: 0,
            startCharged: false,
            shipSkills: {
                slots: [
                    {
                        slot: 'active' as const,
                        abilities: [
                            // Three distinct debuffs (≥2 so the crit path can remove 2).
                            debuff('Attack Down'),
                            debuff('Defense Down'),
                            debuff('Speed Down'),
                            // A damaging hit that emits `attacked` (with didCrit per `crit`).
                            {
                                id: 'rw-enemy-hit',
                                type: 'damage' as const,
                                target: 'enemy' as const,
                                trigger: 'on-cast' as const,
                                conditions: [],
                                config: { type: 'damage' as const, multiplier: 100, hits: 1 },
                            },
                        ],
                    },
                ],
            },
        };
    }

    /** Healing-mode base for the Reactive Ward carrier ('attacker' is the heal target). */
    const WARD_BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [] },
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
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
        defence: 0,
        hp: CARRIER_HP,
        healTargetId: 'attacker',
        speed: 1,
        ...overrides,
    });

    /** Sum the round-1 cleanseCount credited to the carrier ('attacker'). */
    function round1Cleanse(result: ReturnType<typeof runCombat>): number {
        return result.healing?.rounds[0]?.perActor.get('attacker')?.cleanseCount ?? 0;
    }

    it('NON-crit incoming hit cleanses exactly 1 of the carrier’s own debuffs', () => {
        const result = runCombat(
            WARD_BASE({
                shipSkills: { slots: buildReactiveWardSlots() },
                enemyAttackers: [debufferHitter(0)], // crit 0 → didCrit:false → count path (1)
            })
        );
        expect(result.healing).toBeDefined();
        // procChance forced to 1 → the on-attacked cleanse fires; non-crit → removes count=1.
        expect(round1Cleanse(result)).toBe(1);
    });

    it('CRIT incoming hit cleanses exactly 2 of the carrier’s own debuffs (critCount path)', () => {
        const result = runCombat(
            WARD_BASE({
                shipSkills: { slots: buildReactiveWardSlots() },
                enemyAttackers: [debufferHitter(100)], // crit 100 → didCrit:true → critCount path (2)
            })
        );
        expect(result.healing).toBeDefined();
        // CRIT → removes critCount=2 (not count=1). This is the load-bearing crit-count assertion:
        // if the registry's critCount were mutated to 1, this would read 1 and fail.
        expect(round1Cleanse(result)).toBe(2);
    });
});

describe('D-PR reactive cleanse — Warpstrike duration-reduction + damage half', () => {
    const CARRIER_HP = 1_000_000_000;
    const ATTACK = 10_000;
    const NUM_ROUNDS = 4;

    /** Legendary Warpstrike implant piece (outgoingDamage +5% half; reduce-duration half). */
    const warpstrikeLegendaryPiece = makePiece({
        id: 'ws-legendary',
        slot: 'implant_major',
        rarity: 'legendary',
        setBonus: 'WARPSTRIKE',
    });

    /**
     * Build the Warpstrike passive slot through the REAL registry (BOTH halves) and return the
     * full passive abilities. No procChance override is needed — the reduce-duration half is
     * deterministic, and the modifier half is unconditional-once per self-debuffed cast.
     */
    function buildWarpstrikePassive(): Ability[] {
        const ship = makeShip({ implants: { implant_major: 'ws-legendary' } });
        const getGearPiece = makeGetGearPiece({ 'ws-legendary': warpstrikeLegendaryPiece });
        const baseSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece);
        const passive = baseSkills.slots.find((s) => s.slot === 'passive');
        expect(passive).toBeDefined();
        return passive!.abilities;
    }

    /** A single-hit 100% damage active so the carrier deals direct damage each turn. */
    const dmgActive: Ability = {
        id: 'ws-dmg-active',
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier: 100, hits: 1 },
    };

    /**
     * Carrier ship skills: the damage active + (optionally) the Warpstrike passive halves.
     * The control omits the passive entirely (no implant) so the delta isolates Warpstrike.
     */
    function carrierSkills(withWarpstrike: boolean): ShipSkills {
        return {
            slots: [
                { slot: 'active', abilities: [dmgActive] },
                ...(withWarpstrike
                    ? [{ slot: 'passive' as const, abilities: buildWarpstrikePassive() }]
                    : []),
            ],
        };
    }

    /**
     * A FAST enemy whose only job is to keep the carrier self-debuffed: it lands TWO distinct
     * self-debuffs on the carrier each round (apply → always lands) and acts BEFORE the carrier
     * so the carrier is already self-debuffed when it deals its OWN damage (which is what gates
     * both Warpstrike halves — the duration-reduction rides the carrier's on-deal-damage, not the
     * enemy's hit). attack:1 keeps any incidental damage from killing the fat carrier. The two
     * debuffs are applied in a fixed order ('Older' then 'Newer') so 'Newer' is the newest → the
     * one Warpstrike's reduce-duration half targets.
     */
    function selfDebuffer() {
        const debuff = (name: string): Ability => ({
            id: `ws-debuff-${name}`,
            type: 'debuff',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'debuff',
                buffName: name,
                parsedEffects: {},
                stacks: 1,
                isStackable: false,
                application: 'apply',
                duration: 9,
            },
        });
        return {
            id: 'ws-enemy',
            stats: {
                attack: 1, // token damage → never kills the fat carrier
                crit: 0,
                critDamage: 0,
                speed: 1_000, // acts before the carrier each round
                defence: 0,
                hp: 1_000_000_000,
            },
            chargeCount: 0,
            startCharged: false,
            shipSkills: {
                slots: [
                    {
                        slot: 'active' as const,
                        abilities: [debuff('Older'), debuff('Newer')],
                    },
                ],
            },
        };
    }

    /** Healing-mode base: the carrier 'attacker' is the heal target (so cleanseCount is recorded). */
    const WS_BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
        attack: ATTACK,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [] },
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds: NUM_ROUNDS,
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
        hp: CARRIER_HP,
        healTargetId: 'attacker',
        speed: 1,
        ...overrides,
    });

    /** Total cleanseCount credited to the carrier across all rounds (= count of newest-debuff
     *  duration reductions Warpstrike performed). */
    function totalCleanse(result: ReturnType<typeof runCombat>): number {
        return (result.healing?.rounds ?? []).reduce(
            (sum, rd) => sum + (rd.perActor.get('attacker')?.cleanseCount ?? 0),
            0
        );
    }

    it(
        'reduce-duration half fires once per self-debuffed damage turn (control credits 0); ' +
            'the credited reduction count = Warpstrike’s extra ticks on the newest debuff',
        () => {
            const withWarp = runCombat(
                WS_BASE({
                    shipSkills: carrierSkills(true),
                    enemyAttackers: [selfDebuffer()],
                })
            );
            const control = runCombat(
                WS_BASE({
                    shipSkills: carrierSkills(false),
                    enemyAttackers: [selfDebuffer()],
                })
            );

            expect(withWarp.healing).toBeDefined();
            // Control (no Warpstrike) → no duration reductions credited.
            expect(totalCleanse(control)).toBe(0);

            // Warpstrike: each round the carrier is already self-debuffed (enemy acts first) and
            // deals direct damage → on-deal-damage reduce-duration fires once, reducing the NEWEST
            // debuff by 1 turn → cleanseCount += 1 each round. reduceNewestDebuffDuration returns 1
            // per fire (a SINGLE debuff — the newest — is reduced, never bulk). Over NUM_ROUNDS
            // self-debuffed damage turns the total extra ticks = NUM_ROUNDS.
            expect(totalCleanse(withWarp)).toBe(NUM_ROUNDS);

            // Per-round shape: exactly 1 reduction per round (one debuff — the newest — reduced),
            // never 0 (would mean the reduce half never fired) and never >1 (would mean it bulk-
            // reduced rather than targeting only the newest).
            for (let r = 0; r < NUM_ROUNDS; r++) {
                expect(withWarp.healing!.rounds[r]?.perActor.get('attacker')?.cleanseCount).toBe(1);
            }
        }
    );

    it('D-PR2 damage half is STILL live: outgoing damage is boosted while self-debuffed', () => {
        // Same self-debuffer setup; compare total direct damage WITH vs WITHOUT Warpstrike.
        // Warpstrike legendary = +5% outgoingDamage while self-debuffed. crit=0 → per-round damage
        // is otherwise constant, so the +5% modifier can only ADD → withWarp strictly exceeds the
        // control. This proves BOTH halves are live (the reduce-duration test above proves the 2nd).
        const withWarp = runCombat(
            WS_BASE({
                shipSkills: carrierSkills(true),
                enemyAttackers: [selfDebuffer()],
            })
        );
        const control = runCombat(
            WS_BASE({
                shipSkills: carrierSkills(false),
                enemyAttackers: [selfDebuffer()],
            })
        );
        expect(withWarp.rawTotals.direct).toBeGreaterThan(control.rawTotals.direct);
    });
});

// ---------------------------------------------------------------------------
// Registry-shape assertions (mutation-probe defense) — REACTIVE_WARD + WARPSTRIKE
// ---------------------------------------------------------------------------
//
// These assert the SHAPE the registry produces, independent of any engine run, so a mutation
// that drops/changes a wire (e.g. removing WARPSTRIKE's 2nd ability, or flipping REACTIVE_WARD
// critCount) fails here even if the engine integration runs happened to still pass.

describe('D-PR reactive cleanse — registry shape (buildShipAbilitiesWithEquipment)', () => {
    it('WARPSTRIKE yields BOTH the on-cast outgoingDamage modifier AND the on-deal-damage reduce-duration cleanse', () => {
        const ship = makeShip({ implants: { implant_major: 'ws-shape' } });
        const piece = makePiece({
            id: 'ws-shape',
            slot: 'implant_major',
            rarity: 'legendary',
            setBonus: 'WARPSTRIKE',
        });
        const baseSkills = buildShipAbilitiesWithEquipment(
            ship,
            makeGetGearPiece({ 'ws-shape': piece })
        );
        const passive = baseSkills.slots.find((s) => s.slot === 'passive');
        expect(passive).toBeDefined();
        const warps = passive!.abilities.filter((a) => a.id.startsWith('equip-implant-WARPSTRIKE'));
        // BOTH halves present.
        expect(warps).toHaveLength(2);

        // Half 1: the D-PR2 outgoing-damage modifier (on-cast).
        const modifier = warps.find((a) => a.config.type === 'modifier');
        expect(modifier).toBeDefined();
        expect(modifier!.trigger).toBe('on-cast');
        if (modifier!.config.type === 'modifier') {
            expect(modifier!.config.channel).toBe('outgoingDamage');
            expect(modifier!.config.value).toBe(5); // legendary WARPSTRIKE_PCT
        }

        // Half 2: the NEW on-deal-damage reduce-duration cleanse (deterministic, no procChance).
        const cleanse = warps.find((a) => a.config.type === 'cleanse');
        expect(cleanse).toBeDefined();
        expect(cleanse!.trigger).toBe('on-deal-damage');
        expect(cleanse!.procChance).toBeUndefined();
        if (cleanse!.config.type === 'cleanse') {
            expect(cleanse!.config.mode).toBe('reduce-duration');
            expect(cleanse!.config.durationTurns).toBe(1);
        }
    });

    it('REACTIVE_WARD yields the on-attacked remove cleanse with count 1, critCount 2, and a per-rarity procChance', () => {
        const ship = makeShip({ implants: { implant_major: 'rw-shape' } });
        const piece = makePiece({
            id: 'rw-shape',
            slot: 'implant_major',
            rarity: 'legendary',
            setBonus: 'REACTIVE_WARD',
        });
        const baseSkills = buildShipAbilitiesWithEquipment(
            ship,
            makeGetGearPiece({ 'rw-shape': piece })
        );
        const passive = baseSkills.slots.find((s) => s.slot === 'passive');
        expect(passive).toBeDefined();
        const ward = passive!.abilities.find((a) => a.id.startsWith('equip-implant-REACTIVE_WARD'));
        expect(ward).toBeDefined();
        expect(ward!.trigger).toBe('on-attacked');
        // procChance is the legendary rarity value (0.16) — present and < 1 (real-registry proc).
        expect(ward!.procChance).toBeCloseTo(0.16);
        expect(ward!.config.type).toBe('cleanse');
        if (ward!.config.type === 'cleanse') {
            expect(ward!.config.mode).toBe('remove');
            expect(ward!.config.count).toBe(1);
            expect(ward!.config.critCount).toBe(2);
        }
    });
});

// ---------------------------------------------------------------------------
// Cloaking gear set — start-of-combat Stealth (Task 5: engine integration)
// ---------------------------------------------------------------------------
//
// The CLOAKING set ability grants the equipped ship the 'Stealth' self-buff for 2 turns,
// once per combat, on the `start-of-round` trigger. The engine drains start-of-round intents
// at "drain point (a)" BEFORE the first turn of the round, so in round 1 the Stealth buff
// lands before any ship acts (buildEquipmentAbilities.ts CLOAKING; engine.ts round-started +
// "Drain point (a)").
//
// Cloaking is the FIRST in-engine source of 'Stealth'. These tests exercise the REAL
// resolution→merge→engine path (buildShipAbilitiesWithEquipment → passive merge → runCombat),
// NOT hand-rolled abilities, and assert the dormant positional-targeting consumer
// (positionalBinding.ts resolvePositionalTarget stealth filter; engine.ts isStealthed) actually
// fires: a stealthed actor is untargetable while Stealth is active and becomes targetable once
// it expires.
//
// OBSERVABLE: every test runs in HEALING mode (required for the positioned enemy roster) and
// reads `RoundData.perTargetDamage` — the per-round map of landed direct damage keyed by victim
// id (set only when the positional path recorded victim damage; positionalDamage.integration.test
// uses the same observable). A stealthed victim's id is absent / zero in that map for the rounds
// it is untargetable, and present/non-zero once it is targetable again.
//
// EMPIRICAL TIMING (observed from a first run, documented here — NOT a guessed hard-code; the
// known project_buff_duration_decrement_timing quirk means a duration-2 buff does NOT expire on
// the naive round 3):
//   - PLAYER-side carrier (focus 'attacker'): Stealth granted at round-1 drain (a), turnsRemaining
//     decrements at the carrier's Post Turn each round → active round 1 ONLY (expires at the
//     round-2 Post Turn, buff-expired emitted at round 2). So the carrier is untargetable in
//     round 1 and targetable from round 2 onward.
//   - ENEMY-side carrier: the enemy decrement cadence differs → Stealth is active rounds 1 AND 2,
//     and the cloaked enemy first becomes targetable at round 3.
//   Both confirmed empirically; both grant Stealth exactly ONCE (round 1).

describe('Cloaking integration — start-of-combat Stealth', () => {
    /** Two CLOAKING-set pieces → activates the set ability (>=2 pieces). */
    const cloakPieceA = makePiece({ id: 'cloak-1', slot: 'weapon', setBonus: 'CLOAKING' });
    const cloakPieceB = makePiece({ id: 'cloak-2', slot: 'hull', setBonus: 'CLOAKING' });

    /** A single-hit 100% basic-attack active slot. */
    const basicAttack = (): ShipSkills['slots'][number] => ({
        slot: 'active',
        abilities: [
            {
                id: 'cloak-basic-atk',
                type: 'damage',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [],
                config: { type: 'damage', multiplier: 100, hits: 1 },
            },
        ],
    });

    const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
        raw: selection,
        side: 'enemy',
        selection,
    });
    /** Origin-only (single-target) pattern: anchors on the front-most VISIBLE candidate. */
    const basePattern = (): ParsedPattern => ({
        raw: 'base',
        shape: 'base',
        range: 0,
        modifiers: {},
    });

    /** Build the CLOAKING-equipped focus ship's skills via the REAL registry path:
     *  resolution → passive merge → (active basic attack appended). */
    function cloakingFocusSkills(activeSlot: ShipSkills['slots'][number]): ShipSkills {
        const ship = makeShip({ equipment: { weapon: 'cloak-1', hull: 'cloak-2' } });
        const getGearPiece = makeGetGearPiece({ 'cloak-1': cloakPieceA, 'cloak-2': cloakPieceB });
        const baseSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece);
        const passive = baseSkills.slots.find((s) => s.slot === 'passive');
        // Pre-condition: the Cloaking set ability landed in the passive slot.
        expect(passive).toBeDefined();
        const cloak = passive!.abilities.find((a) => a.id === 'equip-set-CLOAKING');
        expect(cloak).toBeDefined();
        return {
            slots: [activeSlot, { slot: passive!.slot, abilities: passive!.abilities }],
        };
    }

    /** A passive, positioned player ally (a walked team actor with no offense). */
    const passivePlayerAt = (id: string, position: Position, hp: number): TeamActorEngineInput => ({
        id,
        speed: 50,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        walk: {
            shipSkills: { slots: [basicAttack()] },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });

    type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

    /** A positioned enemy attacker firing `base front` (origin-only) at the player roster. */
    const offensiveEnemyAt = (
        id: string,
        position: Position,
        selection: ParsedTarget['selection'],
        pattern: ParsedPattern,
        attack = 5000
    ): EnemyAttacker =>
        ({
            id,
            stats: { attack, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
            chargeCount: 0,
            startCharged: false,
            position,
            target: parsedTarget(selection),
            pattern,
            shipSkills: { slots: [basicAttack()] },
        }) as EnemyAttacker;

    /** Base healing-mode input: focus 'attacker' positioned, plenty of HP, multi-round. */
    const CLOAK_BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [basicAttack()] },
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
        healTargetId: 'attacker',
        position: 'M4',
        speed: 50,
        ...overrides,
    });

    /** Collect per-round incoming direct damage for two actor ids from `perTargetDamage`. */
    function perRoundIncoming(
        result: ReturnType<typeof runCombat>,
        idA: string,
        idB: string
    ): Array<{ round: number; a: number; b: number }> {
        return result.rounds.map((rd, i) => ({
            round: i + 1,
            a: rd.perTargetDamage?.[idA] ?? 0,
            b: rd.perTargetDamage?.[idB] ?? 0,
        }));
    }

    /** Collect 'Stealth' buff-applied events (actorId + round) across a run. */
    function stealthApplications(
        input: CombatEngineInput
    ): Array<{ actorId: string; round: number }> {
        const bus = createEventBus();
        const out: Array<{ actorId: string; round: number }> = [];
        bus.on('buff-applied', (e) => {
            if (e.buffName === 'Stealth') out.push({ actorId: e.actorId, round: e.round });
        });
        runCombat({ ...input, bus });
        return out;
    }

    // ── Case 1: untargetable while stealthed, targetable after expiry ─────────────
    it(
        'untargetable while Stealth is active: a non-stealthed ally soaks the enemy hit during the ' +
            'stealthed round(s); the cloaking ship is hit only AFTER Stealth expires (empirical expiry)',
        () => {
            // Player roster: CLOAKING focus 'attacker' at M4 (front) + a non-stealthed ally at M3.
            // An enemy at M1 fires `base front` (origin-only) → it would anchor on the front-most
            // VISIBLE player. While 'attacker' is stealthed it is dropped from the candidate set →
            // the anchor falls to the next visible front-most cell (the M3 ally). Once Stealth
            // expires, the front-most visible player is 'attacker' again → it takes the hit.
            const input = CLOAK_BASE({
                shipSkills: cloakingFocusSkills(basicAttack()),
                teamActors: [passivePlayerAt('ally-mid', 'M3', 1_000_000_000)],
                enemyAttackers: [offensiveEnemyAt('enemy-1', 'M1', 'front', basePattern())],
            });
            const result = runCombat(input);
            const perRound = perRoundIncoming(result, 'attacker', 'ally-mid');

            // Empirically observed (player-side decrement cadence): Stealth covers round 1 ONLY
            // (expires at the round-2 Post Turn — the project_buff_duration_decrement_timing quirk
            // means the duration-2 buff does NOT survive to round 3). Determine the expiry round
            // from the data rather than hard-coding it: the first round the cloaking ship is hit.
            const firstHitRound = perRound.find((r) => r.a > 0)?.round;
            expect(firstHitRound).toBeDefined();
            // Sanity: the observed expiry matches the documented empirical timing (round 2).
            expect(firstHitRound).toBe(2);

            // During every stealthed round (before firstHitRound) the cloaking ship takes ZERO
            // incoming direct damage and the non-stealthed ally soaks the redirected hit instead.
            for (const r of perRound.filter((x) => x.round < firstHitRound!)) {
                expect(r.a).toBe(0); // cloaking ship untargetable → no incoming damage
                expect(r.b).toBeGreaterThan(0); // the ally soaked the redirected hit
            }
            // From the expiry round onward the cloaking ship IS targeted (non-zero incoming).
            for (const r of perRound.filter((x) => x.round >= firstHitRound!)) {
                expect(r.a).toBeGreaterThan(0);
            }
        }
    );

    // ── Case 2: Stealth granted exactly once (oncePerCombat) ─────────────────────
    it('granted once: Stealth is applied a single time (oncePerCombat) — not refreshed each round', () => {
        const input = CLOAK_BASE({
            shipSkills: cloakingFocusSkills(basicAttack()),
            teamActors: [passivePlayerAt('ally-mid', 'M3', 1_000_000_000)],
            enemyAttackers: [offensiveEnemyAt('enemy-1', 'M1', 'front', basePattern())],
        });
        const applications = stealthApplications(input);
        // Exactly one Stealth application, on the cloaking carrier, at round 1.
        expect(applications).toHaveLength(1);
        expect(applications[0].actorId).toBe('attacker');
        expect(applications[0].round).toBe(1);
    });

    // ── Case 4: enemy-side mirror — enemy Cloaking untargetable to the player ─────
    it(
        'enemy-side mirror: an enemy equipped with Cloaking is untargetable to the player while ' +
            'stealthed — the player attack redirects to the non-stealthed enemy until expiry',
        () => {
            // Player focus 'attacker' at M4 fires `base front` at the enemy roster. Enemy roster:
            // a CLOAKING-equipped enemy at the front (M4) + a non-stealthed enemy behind (M3).
            // The engine is team-agnostic (registerReactiveListeners runs both sides), so the enemy
            // gains Stealth at round 1 and is dropped from the player's targeting candidates while
            // active → the player's anchor falls to the non-stealthed enemy at M3.
            const ship = makeShip({ equipment: { weapon: 'cloak-1', hull: 'cloak-2' } });
            const getGearPiece = makeGetGearPiece({
                'cloak-1': cloakPieceA,
                'cloak-2': cloakPieceB,
            });
            const enemyBase = buildShipAbilitiesWithEquipment(ship, getGearPiece);
            const enemyPassive = enemyBase.slots.find((s) => s.slot === 'passive');
            expect(enemyPassive).toBeDefined();
            expect(enemyPassive!.abilities.some((a) => a.id === 'equip-set-CLOAKING')).toBe(true);

            const cloakEnemy: EnemyAttacker = {
                id: 'enemy-cloak',
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    defence: 0,
                    hp: 1_000_000_000,
                    speed: 1,
                },
                chargeCount: 0,
                startCharged: false,
                position: 'M4',
                // No active offense; the CLOAKING passive grants the enemy Stealth at round 1.
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [] },
                        { slot: enemyPassive!.slot, abilities: enemyPassive!.abilities },
                    ],
                },
            } as EnemyAttacker;
            const plainEnemy: EnemyAttacker = {
                id: 'enemy-plain',
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    defence: 0,
                    hp: 1_000_000_000,
                    speed: 1,
                },
                chargeCount: 0,
                startCharged: false,
                position: 'M3',
                shipSkills: { slots: [] },
            } as EnemyAttacker;

            const input = CLOAK_BASE({
                // Focus fires `base front` at the enemy roster (positional).
                shipSkills: cloakingFocusSkills(basicAttack()),
                // Re-point the focus' OWN attack at the enemy roster (it is positional via target/pattern).
                target: parsedTarget('front'),
                pattern: basePattern(),
                enemyAttackers: [cloakEnemy, plainEnemy],
            });
            // The focus carries the CLOAKING passive too (so it would also be stealthed), but that
            // is irrelevant here: the assertion is purely about which ENEMY the player's attack
            // lands on. Use a fresh focus WITHOUT Cloaking to keep the enemy-side mirror isolated.
            const isolatedInput: CombatEngineInput = {
                ...input,
                shipSkills: { slots: [basicAttack()] },
            };

            const bus = createEventBus();
            const applications: Array<{ actorId: string; round: number }> = [];
            bus.on('buff-applied', (e) => {
                if (e.buffName === 'Stealth')
                    applications.push({ actorId: e.actorId, round: e.round });
            });
            const result = runCombat({ ...isolatedInput, bus });
            const perRound = perRoundIncoming(result, 'enemy-cloak', 'enemy-plain');

            // Stealth granted exactly once, on the enemy carrier, at round 1.
            expect(applications).toHaveLength(1);
            expect(applications[0].actorId).toBe('enemy-cloak');
            expect(applications[0].round).toBe(1);

            // Empirical expiry: the first round the player's attack lands on the cloaked enemy.
            // (Enemy decrement cadence → Stealth covers rounds 1 AND 2; first hit at round 3.)
            const firstHitRound = perRound.find((r) => r.a > 0)?.round;
            expect(firstHitRound).toBeDefined();
            expect(firstHitRound).toBe(3);

            // While stealthed (before firstHitRound) the player attack redirects to the
            // non-stealthed enemy — the cloaked enemy takes ZERO incoming damage.
            for (const r of perRound.filter((x) => x.round < firstHitRound!)) {
                expect(r.a).toBe(0); // cloaked enemy untargetable
                expect(r.b).toBeGreaterThan(0); // redirected onto the non-stealthed enemy
            }
            // After expiry the player's attack lands on the (now front-most visible) cloaked enemy.
            for (const r of perRound.filter((x) => x.round >= firstHitRound!)) {
                expect(r.a).toBeGreaterThan(0);
            }
        }
    );

    // ── Case 3: Cloaking + Ambush synergy ────────────────────────────────────────
    //
    // Cloaking supplies the 'Stealth' self-buff (ability-sourced, payload-carrying) → Ambush's
    // start-of-round gate `{subject:'self-buff', buffName:'Stealth', derivable:true}` is satisfied
    // and Ambush grants 'Crit Power Up III' to the carrier. The Ambush gate is evaluated at drain
    // time via buildDrainContext → buildActorConditionContext; with `includeAbilitySelfNames:true`
    // the drain-time `selfBuffNames` now includes ability-sourced timed self statuses (Cloaking's
    // Stealth), so the gate sees it. This is the behaviour the triggers.ts fix unlocks.
    //
    // Legendary AMBUSH implant on the same carrier as the CLOAKING set. We override ONLY the built
    // Ambush ability's `procChance` to 1 for determinism (the established REACTIVE_WARD/LAST_STAND
    // device) — every other field (gate, buffName, trigger) comes straight from the registry.
    it(
        'Cloaking + Ambush synergy: Cloaking-supplied Stealth satisfies Ambush’s self-buff gate ' +
            '→ Ambush grants Crit Power Up III to the carrier while Stealth is active',
        () => {
            const ambushPiece = makePiece({
                id: 'ambush-1',
                slot: 'implant_major',
                rarity: 'legendary',
                setBonus: 'AMBUSH',
            });
            const ship = makeShip({
                equipment: { weapon: 'cloak-1', hull: 'cloak-2' },
                implants: { implant_major: 'ambush-1' },
            });
            const getGearPiece = makeGetGearPiece({
                'cloak-1': cloakPieceA,
                'cloak-2': cloakPieceB,
                'ambush-1': ambushPiece,
            });
            const baseSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece);
            const passive = baseSkills.slots.find((s) => s.slot === 'passive');
            expect(passive).toBeDefined();
            // Pre-conditions: both the Cloaking set ability and the Ambush implant ability landed
            // in the passive slot.
            const cloak = passive!.abilities.find((a) => a.id === 'equip-set-CLOAKING');
            expect(cloak).toBeDefined();
            const ambush = passive!.abilities.find((a) => a.id.startsWith('equip-implant-AMBUSH'));
            expect(ambush).toBeDefined();
            // Sanity: Ambush is the start-of-round self-buff grant gated on self-buff/Stealth.
            expect(ambush!.trigger).toBe('start-of-round');
            expect(ambush!.config.type).toBe('buff');
            if (ambush!.config.type === 'buff') {
                expect(ambush!.config.buffName).toBe('Crit Power Up III');
            }
            expect(
                ambush!.conditions.some(
                    (c) => c.subject === 'self-buff' && c.buffName === 'Stealth'
                )
            ).toBe(true);

            // Force determinism WITHOUT leaving the registry path: mutate only procChance.
            const determinizedAmbush: Ability = { ...ambush!, procChance: 1 };
            const otherPassives = passive!.abilities.filter(
                (a) => !a.id.startsWith('equip-implant-AMBUSH')
            );

            const input = CLOAK_BASE({
                shipSkills: {
                    slots: [
                        basicAttack(),
                        { slot: 'passive', abilities: [...otherPassives, determinizedAmbush] },
                    ],
                },
            });

            // Collect 'Crit Power Up III' buff-applied events (Ambush firing on the carrier).
            const bus = createEventBus();
            const ambushFires: Array<{ actorId: string; round: number }> = [];
            bus.on('buff-applied', (e) => {
                if (e.buffName === 'Crit Power Up III')
                    ambushFires.push({ actorId: e.actorId, round: e.round });
            });
            runCombat({ ...input, bus });

            // Ambush fires on the carrier. Empirically observed: a SINGLE fire at round 1 — the
            // player-side Stealth window is round 1 only (Cloaking grants Stealth at the round-1
            // start-of-round, and the Ambush start-of-round drain in that same round sees it via
            // the ability-sourced self-buff inclusion; it expires before round 2's gate per the
            // project_buff_duration_decrement_timing quirk seen in case 1).
            expect(ambushFires.length).toBeGreaterThan(0);
            expect(ambushFires.every((f) => f.actorId === 'attacker')).toBe(true);
            expect(ambushFires.some((f) => f.round === 1)).toBe(true);
        }
    );
});

// ---------------------------------------------------------------------------
// H1 Task 10: Arcane Siege goes LIVE with a real in-sim shield
// ---------------------------------------------------------------------------
//
// Arcane Siege grants +X% outgoing direct damage WHILE the carrier holds a shield
// (registry: buildEquipmentAbilities.ts ~559 — a passive `modifier` ability on channel
// 'outgoingDamage', gated on the derivable `self-shield` condition). The gate reads
// `actor.shieldPool > 0` at the moment the carrier's per-turn modifier context is built
// (playerTurn.ts ~1157, `selfShielded`). Before sub-project H, no in-sim shield source
// existed, so `shieldPool` was always 0 → the gate never passed → Arcane Siege was DORMANT.
// H1 makes shields reachable; this test proves the bonus now ACTIVATES.
//
// TIMING NOTE: the modifier context is built BEFORE the carrier executes its own cast, so a
// shield the carrier grants itself ON its own turn would land too late to be seen by that
// same turn's gate. To put the shield up BEFORE the measured attack, a FASTER team ally
// (speed 200 > focus speed 100) casts an `all-allies` shield first within round 1 — exactly
// the cross-actor grant proven by shieldGrantBattleSim.test.ts. By the time the focus acts,
// its `shieldPool > 0` and the gate passes.
//
// Mutation-resistant control: BOTH runs are byte-identical (same Arcane-Siege-equipped focus,
// same faster ally) EXCEPT the ally's active — a shield-granting cast (WITH) vs an inert
// self-buff that never touches the focus (WITHOUT, so the focus's shieldPool stays 0). The
// ONLY thing that differs is whether the carrier holds a shield, so the damage delta is
// attributable solely to the Arcane Siege gate. This routes through the REAL registry
// (buildShipAbilitiesWithEquipment + setBonus resolution), so the test bites if the gate or
// the registry entry breaks. Deterministic stats (crit 0) keep the damage comparison clean.

describe('H1 Task 10 integration — Arcane Siege activates with a live shield', () => {
    const ATTACK = 10_000;
    const ARCANE_SIEGE_EPIC_PCT = 15; // matches ARCANE_SIEGE_PCT.epic in buildEquipmentAbilities.ts

    /** Single-hit 100% damage active for the Arcane Siege carrier (the focus / measured attacker). */
    const dmgActiveAbility: Ability = {
        id: 'dmg-active',
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier: 100, hits: 1 },
    };

    /** Focus ship skills: damage active + Arcane Siege passive resolved through the REAL registry. */
    function buildArcaneSiegeShipSkills(): ShipSkills {
        const ship = makeShip({ implants: { implant_minor: 'arcane-siege-epic' } });
        const getGearPiece = makeGetGearPiece({ 'arcane-siege-epic': arcaneSiegePiece });
        const baseSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece);
        const passive = baseSkills.slots.find((s) => s.slot === 'passive');

        // Pre-condition: the Arcane Siege modifier ability landed in the passive slot.
        const arcaneSiege = passive?.abilities.find((a) =>
            a.id.startsWith('equip-implant-ARCANE_SIEGE')
        );
        expect(arcaneSiege).toBeDefined();

        return {
            slots: [
                { slot: 'active', abilities: [dmgActiveAbility] },
                ...(passive ? [{ slot: passive.slot, abilities: passive.abilities }] : []),
            ],
        };
    }

    /** A faster team ally. `grantShield: true` → casts an all-allies shield (lands on the focus
     *  before it acts); otherwise it casts an inert self-buff that never touches the focus. */
    function shieldAlly(grantShield: boolean): TeamActorInput {
        const allyActive: Ability = grantShield
            ? {
                  id: 'ally-shield',
                  type: 'shield',
                  target: 'all-allies',
                  trigger: 'on-cast',
                  conditions: [],
                  config: { type: 'shield', pct: 25, basis: 'hp' },
              }
            : {
                  // Control: a self-only buff. Acts in the same slot/cadence but grants NO shield
                  // to the focus, so the focus's shieldPool stays 0 and the Arcane Siege gate fails.
                  id: 'ally-noop-buff',
                  type: 'buff',
                  target: 'self',
                  trigger: 'on-cast',
                  conditions: [],
                  config: {
                      type: 'buff',
                      buffName: 'Attack Up',
                      parsedEffects: {},
                      stacks: 1,
                      isStackable: false,
                      duration: 1,
                  },
              };
        return {
            id: 'shield-ally',
            speed: 200, // faster than the focus (100) → acts first within round 1
            selfBuffs: [],
            enemyDebuffs: [],
            chargeCount: 0,
            startCharged: false,
            shipSkills: { slots: [{ slot: 'active', abilities: [allyActive] }] },
            stats: {
                attack: 1,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                shieldPenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 50_000,
            },
        };
    }

    /** Base engine input: focus 'attacker' carries Arcane Siege, deals deterministic damage. */
    const AS_BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput =>
        BASE({
            attack: ATTACK,
            crit: 0,
            critDamage: 0,
            numRounds: 1,
            speed: 100, // slower than the shield ally → acts AFTER the shield lands
            hp: 10_000,
            shipSkills: buildArcaneSiegeShipSkills(),
            ...overrides,
        });

    it(
        'Arcane Siege boosts outgoing direct damage by exactly +15% (epic) when a faster ally ' +
            'shields the carrier before it attacks; no boost without the shield',
        () => {
            // WITH shield: ally grants an all-allies shield → focus.shieldPool > 0 before it acts.
            const withShield = runCombat(
                AS_BASE({
                    teamActors: deriveTeamEngineActors([shieldAlly(true)], undefined),
                })
            );

            // WITHOUT shield: identical setup, but the ally casts an inert self-buff → the focus's
            // shieldPool stays 0 → Arcane Siege gate fails → no outgoing-damage bonus.
            const withoutShield = runCombat(
                AS_BASE({
                    teamActors: deriveTeamEngineActors([shieldAlly(false)], undefined),
                })
            );

            const boosted = withShield.rawTotals.direct;
            const baseline = withoutShield.rawTotals.direct;

            // Sanity: the carrier actually dealt damage in both runs.
            expect(baseline).toBeGreaterThan(0);

            // The gate ACTIVATES with a live shield: boosted damage is strictly higher.
            expect(boosted).toBeGreaterThan(baseline);

            // And the delta is EXACTLY the Arcane Siege epic outgoingDamage% (+15%).
            expect(boosted).toBeCloseTo(baseline * (1 + ARCANE_SIEGE_EPIC_PCT / 100), 6);
        }
    );
});

// ---------------------------------------------------------------------------
// H2 Task H2.2: Shield gear set — accrues a 4% maxHP shield pool via full build→sim path
// ---------------------------------------------------------------------------
//
// The Shield gear set ("Generate 4% shield each turn") resolves through the registry
// (GEAR_SET_ABILITIES.SHIELD, H2.1) into an ability:
//   { type:'shield', target:'self', trigger:'start-of-turn', config:{ type:'shield', pct:4, basis:'hp' } }
// id `equip-set-SHIELD`. trigger 'start-of-turn' is a LIVE trigger → it partitions into
// reactiveAbilities and fires via the reactive executor on the carrier's OWN turn, landing the
// pool on the carrier via the per-recipient routing (Phase 0.1).
//
// This test exercises the FULL build→engine path, not just the registry:
//   1. Equip a ship with the minimum SHIELD-set pieces (2; default minPieces).
//   2. buildShipAbilitiesWithEquipment merges `equip-set-SHIELD` into the passive slot.
//      (pre-condition assertion mirrors the LEECH test).
//   3. Feed those built skills to a NON-focus team ally so its start-of-turn fires within
//      round 1; read its live shieldPool via __testTapActors after the run settles.
//
// grantShieldToTarget does NOT floor: it adds raw and caps at maxHp, with raw = maxHp × 4/100.
// Ally maxHp = 50_000 → pool = 0.04 × 50_000 = 2_000 exactly (well under the maxHp cap).

const shieldPieceA = makePiece({ id: 'shield-1', slot: 'weapon', setBonus: 'SHIELD' });
const shieldPieceB = makePiece({ id: 'shield-2', slot: 'hull', setBonus: 'SHIELD' });

describe('H2.2 integration — Shield gear set grants 4% maxHP shield pool (full build→sim path)', () => {
    it('a Shield-equipped acting ship accrues shieldPool = 0.04 × maxHp after its turn', () => {
        const ALLY_HP = 50_000;
        const SHIELD_PCT = 4; // GEAR_SETS.SHIELD stat value
        const EXPECTED_POOL = (SHIELD_PCT / 100) * ALLY_HP; // 2_000, NOT floored

        // ── 1+2: real resolution+merge path (build→merge) with 2 SHIELD-set pieces ──────────
        const ship = makeShip({ equipment: { weapon: 'shield-1', hull: 'shield-2' } });
        const getGearPiece = makeGetGearPiece({
            'shield-1': shieldPieceA,
            'shield-2': shieldPieceB,
        });
        const baseSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece);

        // Pre-condition: the SHIELD set ability landed in the passive slot via the build path.
        const passive = baseSkills.slots.find((s) => s.slot === 'passive');
        expect(passive).toBeDefined();
        const shieldAbility = passive!.abilities.find((a) => a.id === 'equip-set-SHIELD');
        expect(shieldAbility).toBeDefined();
        expect(shieldAbility!.trigger).toBe('start-of-turn');
        expect(shieldAbility!.config).toMatchObject({ type: 'shield', pct: 4, basis: 'hp' });

        // ── 3: feed the BUILT skills to a non-focus team ally; it acts within round 1 ────────
        const teamActors: TeamActorInput[] = [
            {
                id: 'shield-carrier',
                speed: 200, // acts before the focus so its start-of-turn fires within round 1
                selfBuffs: [],
                enemyDebuffs: [],
                chargeCount: 0,
                startCharged: false,
                shipSkills: baseSkills,
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    shieldPenetration: 0,
                    hacking: 0,
                    defence: 0,
                    hp: ALLY_HP,
                },
            },
        ];
        const engineTeam = deriveTeamEngineActors(teamActors, undefined);

        // LIVE references — read shieldPool AFTER the run settles.
        let captured: CombatActor[] = [];
        runCombat(
            BASE({
                // Focus is inert: no damage, IS the heal target, NOT the shield carrier.
                attack: 0,
                crit: 0,
                critDamage: 0,
                numRounds: 1,
                hp: 40_000,
                enemyHp: 1_000_000_000,
                shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
                teamActors: engineTeam,
                __testTapActors: (actors) => {
                    captured = actors;
                },
            })
        );

        const focus = captured.find((a) => a.id === 'attacker');
        const carrier = captured.find((a) => a.id === 'shield-carrier');

        // Sanity / non-vacuous: the inert focus casts nothing and owns no shield → pool stays 0.
        expect(focus?.shieldPool ?? 0).toBe(0);

        // The H2 assertion: the Shield-set carrier accrued a 4%-of-maxHP pool on its turn.
        // Exact (grantShieldToTarget does not floor; raw = maxHp × 4/100, well below the cap).
        expect(carrier?.shieldPool).toBeGreaterThan(0);
        expect(carrier?.shieldPool).toBeCloseTo(EXPECTED_POOL, 6);
    });
});

// ---------------------------------------------------------------------------
// H3 Task H3.2: Adaptive Plating implant — once-per-round shield off the damage taken
// ---------------------------------------------------------------------------
//
// Adaptive Plating (legendary) resolves through the registry (IMPLANT_ABILITIES.ADAPTIVE_PLATING,
// H3.2) into a reactive ability:
//   { type:'shield', target:'self', trigger:'on-attacked', procChance:0.19, oncePerRound:true,
//     config:{ type:'shield', pct:42, basis:'damage-taken' } }
// 'on-attacked' is a LIVE trigger → it partitions into reactiveAbilities and fires when the carrier
// is directly hit. basis 'damage-taken' scales the grant off the triggering hit's damage
// (eventCtx.triggerDamage, threaded by the on-attacked listener in H3.1), landing the pool on the
// carrier via the per-recipient routing (Phase 0.1).
//
// THE KEY INVARIANT (oncePerRound cap): the `attacked` event's `damage` is the per-attack AGGREGATE
// and on-attacked fires ONCE PER HIT. So for an N-hit attack the on-attacked listener enqueues N
// shield intents, EACH carrying triggerDamage === the full aggregate. WITHOUT oncePerRound this would
// grant up to N times per round (one per proc-passing hit). Adaptive Plating's oncePerRound gate must
// cap it to EXACTLY ONE grant per round.
//
// Determinism of the proc: the per-(owner,ability) RateGate accumulates +0.19 per qualifying hit and
// fires when the accumulator crosses 1. With an 11-hit attack per round (11 × 0.19 = 2.09) the proc
// gate would pass TWICE within a single round (it crosses 1 at hit ~6 and again at hit ~11) — so the
// oncePerRound gate (not the proc gate) is the BINDING constraint that caps the round to one grant.
// We read each round's post-cap `granted` (RoundData.perActorShield[carrier].granted) and assert it
// is NEVER more than ONE share (0.42 × aggregate), and that at least one round actually fired.
//
// Pinning the damage taken D: enemy attack A=1000, multiplier 100%, hits=11, no defence/crit/pen on
// either side → per-attack aggregate damage D = 1000 × 1.0 × 11 = 11_000. One grant = 0.42 × 11_000
// = 4_620 (well under the carrier's max HP cap → no clamping).

const adaptivePlatingPiece = makePiece({
    id: 'ap-legendary',
    slot: 'implant_major',
    rarity: 'legendary',
    setBonus: 'ADAPTIVE_PLATING',
});

describe('H3.2 integration — Adaptive Plating once-per-round shield off the damage taken', () => {
    const CARRIER_HP = 100_000_000; // huge: carrier survives every round; shield never caps
    const NUM_ROUNDS = 10;
    const ENEMY_ATTACK = 1_000;
    const ENEMY_HITS = 11; // 11 × 0.19 = 2.09 → proc would pass TWICE/round → oncePerRound is binding
    const D = ENEMY_ATTACK * ENEMY_HITS; // per-attack aggregate damage taken = 11_000
    const AP_PCT = 42; // legendary
    const ONE_GRANT = (AP_PCT / 100) * D; // 4_620 — exactly ONE share

    /** An enemy attacker that hits the carrier (the focus / heal target) with an 11-hit attack
     *  each round. attack 1000, multiplier 100, no crit → aggregate damage taken = 11_000. */
    const enemyHitter = () => ({
        id: 'ap-enemy',
        stats: {
            attack: ENEMY_ATTACK,
            crit: 0,
            critDamage: 0,
            speed: 1, // acts before the (slower) carrier so the hit lands at round top
            defence: 0,
            hp: 1_000_000_000,
        },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active' as const,
                    abilities: [
                        {
                            id: 'ap-enemy-hit',
                            type: 'damage' as const,
                            target: 'enemy' as const,
                            trigger: 'on-cast' as const,
                            conditions: [],
                            config: {
                                type: 'damage' as const,
                                multiplier: 100,
                                hits: ENEMY_HITS,
                            },
                        },
                    ],
                },
            ],
        } as ShipSkills,
    });

    it(
        'grants ≈ 0.42 × damageTaken when it fires, and AT MOST ONCE per round (oncePerRound caps ' +
            'the 11-hit attack to a single grant)',
        () => {
            // Carrier = focus (the heal target) equipped with legendary Adaptive Plating via the
            // real build→merge path. A no-op active keeps the round cadence; the passive slot
            // carries the reactive Adaptive Plating shield.
            const ship = makeShip({ implants: { implant_major: 'ap-legendary' } });
            const getGearPiece = makeGetGearPiece({ 'ap-legendary': adaptivePlatingPiece });
            const baseSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece);

            // Pre-condition: the Adaptive Plating ability landed in the passive slot.
            const passive = baseSkills.slots.find((s) => s.slot === 'passive');
            expect(passive).toBeDefined();
            const ap = passive!.abilities.find((a) =>
                a.id.startsWith('equip-implant-ADAPTIVE_PLATING')
            );
            expect(ap).toBeDefined();
            expect(ap!.trigger).toBe('on-attacked');
            expect(ap!.procChance).toBeCloseTo(0.19);
            expect(ap!.oncePerRound).toBe(true);
            expect(ap!.config).toMatchObject({ type: 'shield', pct: 42, basis: 'damage-taken' });

            // Append a no-op active so the focus keeps the round cadence (deals no damage itself).
            const noopActive: Ability = {
                id: 'noop-active',
                type: 'damage',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [],
                config: { type: 'damage', multiplier: 0 },
            };
            const shipSkills: ShipSkills = {
                slots: [
                    { slot: 'active', abilities: [noopActive] },
                    ...(passive ? [{ slot: passive.slot, abilities: passive.abilities }] : []),
                ],
            };

            const result = runCombat(
                BASE({
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    numRounds: NUM_ROUNDS,
                    hp: CARRIER_HP,
                    // No carrier defence → the enemy's 11-hit attack lands its full nominal
                    // aggregate (1000 × 11 = 11_000) as the damage taken, so the grant pins to
                    // 0.42 × 11_000 = 4_620 exactly (no mitigation arithmetic in the assertion).
                    defence: 0,
                    enemyHp: 1_000_000_000,
                    healTargetId: 'attacker',
                    shipSkills,
                    enemyAttackers: [enemyHitter()],
                })
            );

            // Per-round post-cap grant for the carrier (the heal target / focus).
            const grantedPerRound = result.rounds.map(
                (rd) => rd.perActorShield?.['attacker']?.granted ?? 0
            );

            // (1) THE CAP: no round ever grants more than ONE share. WITHOUT oncePerRound, the
            // 11-hit attack would let the proc gate pass twice in a round → ~2 × ONE_GRANT.
            for (const granted of grantedPerRound) {
                expect(granted).toBeLessThanOrEqual(ONE_GRANT + 1e-6);
            }

            // (2) NON-VACUOUS: the proc actually fired at least once, and every firing round
            // granted EXACTLY one share (≈ 0.42 × damage taken), proving both the damage-taken
            // basis and the once-per-round cap.
            const firingRounds = grantedPerRound.filter((g) => g > 0);
            expect(firingRounds.length).toBeGreaterThan(0);
            for (const granted of firingRounds) {
                expect(granted).toBeCloseTo(ONE_GRANT, 6);
            }

            // (3) CONTROL — the cap is doing real work (oncePerRound is the BINDING constraint):
            // an OTHERWISE-IDENTICAL ability WITHOUT oncePerRound, on the same 11-hit attack, lets
            // the proc gate pass TWICE in a round → that round grants 2 × ONE_GRANT. This proves the
            // 11-hit setup actually exercises the multi-grant path that oncePerRound suppresses above.
            const noCapShield: Ability = {
                id: 'equip-implant-ADAPTIVE_PLATING-nocap',
                type: 'shield',
                target: 'self',
                trigger: 'on-attacked',
                conditions: [],
                procChance: 0.19,
                // oncePerRound deliberately OMITTED.
                config: { type: 'shield', pct: AP_PCT, basis: 'damage-taken' },
                autoFilled: true,
            };
            const noCapResult = runCombat(
                BASE({
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    numRounds: NUM_ROUNDS,
                    hp: CARRIER_HP,
                    defence: 0,
                    enemyHp: 1_000_000_000,
                    healTargetId: 'attacker',
                    shipSkills: {
                        slots: [
                            { slot: 'active', abilities: [noopActive] },
                            { slot: 'passive', abilities: [noCapShield] },
                        ],
                    },
                    enemyAttackers: [enemyHitter()],
                })
            );
            const noCapGranted = noCapResult.rounds.map(
                (rd) => rd.perActorShield?.['attacker']?.granted ?? 0
            );
            // At least one round grants MORE than a single share (the proc gate passed ≥ 2× that
            // round) — the exact scenario the real ability's oncePerRound gate caps to one above.
            expect(noCapGranted.some((g) => g > ONE_GRANT + 1e-6)).toBe(true);
        }
    );
});

// ---------------------------------------------------------------------------
// H3 Task H3.4: Abundant Renewal implant — overheal→shield to the over-repaired ally
// ---------------------------------------------------------------------------
//
// Abundant Renewal (legendary) resolves through the registry (IMPLANT_ABILITIES.ABUNDANT_RENEWAL,
// H3.4) into a DETERMINISTIC reactive ability (no procChance, no oncePerRound):
//   { type:'shield', target:'ally', trigger:'on-own-repair-to-ally',
//     config:{ type:'shield', pct:30, basis:'overheal' } }
// 'on-own-repair-to-ally' is a LIVE trigger → it partitions into reactiveAbilities and fires when
// the carrier (owner) repairs >= 1 NON-self ally. basis 'overheal' scales the grant off the CLIPPED
// over-repair (eventCtx.overhealAmount, threaded from heal-performed.overheal by the listener in
// H3.3). target 'ally' → reactiveRecipients falls back to healing.targetId (the over-repaired ally),
// so the pool lands on that ally via the per-recipient routing (Phase 0.1).
//
// FULL build→sim path (not just the registry):
//   - The FOCUS actor ('attacker') is the HEALER/carrier — Abundant Renewal merged into its passive
//     slot via buildShipAbilitiesWithEquipment, plus a hand-built active ally-repair (basis 'hp',
//     noCrit). It is slow → acts AFTER the enemy each round.
//   - The over-repaired ally is the heal target ('tank', a team actor set as healTargetId).
//   - A fast enemy attacker drops the tank to a KNOWN currentHp BEFORE the healer casts, so the
//     repair clips to a KNOWN overheal.
//
// Pinning the overheal exactly (1 round, no folds):
//   - healer effectiveMaxHp (hp) = 10_000; repair pct 50, basis 'hp', healModifier 0, noCrit →
//     raw R = 10_000 × 50/100 = 5_000.
//   - tank maxHp = 10_000; enemy deals G = 2_000 (attack 2000 × mult 100, no defence/crit) →
//     tank currentHp = 8_000 BEFORE the heal.
//   - consumed = min(R, maxHp − currentHp) = min(5_000, 2_000) = 2_000;
//     overheal = R − consumed = 5_000 − 2_000 = 3_000.
//   - shield granted to the tank = 0.30 × overheal = 0.30 × 3_000 = 900 (well under the tank's max
//     HP cap → no clamping).

const abundantRenewalPiece = makePiece({
    id: 'ar-legendary',
    slot: 'implant_ultimate',
    rarity: 'legendary',
    setBonus: 'ABUNDANT_RENEWAL',
});

describe('H3.4 integration — Abundant Renewal grants overheal→shield to the over-repaired ally (full build→sim path)', () => {
    const HEALER_HP = 10_000;
    const TANK_HP = 10_000;
    const REPAIR_PCT = 50; // raw R = HEALER_HP × 50% = 5_000 (basis 'hp', noCrit, healModifier 0)
    const RAW_REPAIR = HEALER_HP * (REPAIR_PCT / 100); // 5_000
    const GAP = 2_000; // enemy damage to the tank before the healer casts
    const EXPECTED_OVERHEAL = RAW_REPAIR - GAP; // 3_000 (R clips the 2_000 gap, overheals by 3_000)
    const AR_PCT = 30; // legendary
    const EXPECTED_SHIELD = (AR_PCT / 100) * EXPECTED_OVERHEAL; // 900

    /** The healer's active repair, targeting an ally (routes to the heal target 'tank').
     *  basis 'hp' + noCrit so raw = healer effectiveMaxHp × pct with no crit/heal-modifier folds. */
    const repairAlly: Ability = {
        id: 'ar-repair-ally',
        type: 'heal',
        target: 'ally',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'heal', pct: REPAIR_PCT, basis: 'hp', noCrit: true },
    };

    /** Team-actor heal target (the tank). Inert skills — it just receives the heal + the enemy hit. */
    const tankActor = (speed: number): TeamActorEngineInput => ({
        id: 'tank',
        speed,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        walk: {
            shipSkills: { slots: [] },
            stats: {
                attack: 1,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: TANK_HP,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });

    /** A fast enemy attacker that deals exactly GAP to the heal target ('tank') each round.
     *  attack === GAP, multiplier 100, no crit/defence → damage taken = GAP. */
    const enemyHitter = () => ({
        id: 'ar-enemy',
        stats: {
            attack: GAP,
            crit: 0,
            critDamage: 0,
            speed: 1_000, // acts BEFORE the (slow) healer so the gap exists at cast time
            defence: 0,
            hp: 1_000_000_000,
        },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active' as const,
                    abilities: [
                        {
                            id: 'ar-enemy-hit',
                            type: 'damage' as const,
                            target: 'enemy' as const,
                            trigger: 'on-cast' as const,
                            conditions: [],
                            config: { type: 'damage' as const, multiplier: 100, hits: 1 },
                        },
                    ],
                },
            ],
        } as ShipSkills,
    });

    it('an Abundant-Renewal healer over-repairing the heal target grants that ally a 0.30 × overheal shield', () => {
        // ── Real resolution+merge path (build→merge): legendary Abundant Renewal implant ──────
        const ship = makeShip({ implants: { implant_ultimate: 'ar-legendary' } });
        const getGearPiece = makeGetGearPiece({ 'ar-legendary': abundantRenewalPiece });
        const baseSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece);

        // Pre-condition: the Abundant Renewal ability landed in the passive slot via the build path.
        const passive = baseSkills.slots.find((s) => s.slot === 'passive');
        expect(passive).toBeDefined();
        const ar = passive!.abilities.find((a) =>
            a.id.startsWith('equip-implant-ABUNDANT_RENEWAL')
        );
        expect(ar).toBeDefined();
        expect(ar!.type).toBe('shield');
        expect(ar!.target).toBe('ally');
        expect(ar!.trigger).toBe('on-own-repair-to-ally');
        expect(ar!.procChance).toBeUndefined(); // deterministic — no proc gate
        expect(ar!.config).toMatchObject({ type: 'shield', pct: 30, basis: 'overheal' });

        // Healer ship skills: active ally-repair + the merged Abundant Renewal passive.
        const shipSkills: ShipSkills = {
            slots: [
                { slot: 'active', abilities: [repairAlly] },
                ...(passive ? [{ slot: passive.slot, abilities: passive.abilities }] : []),
            ],
        };

        // LIVE references — read the tank's shieldPool AFTER the run settles.
        let captured: CombatActor[] = [];
        const result = runCombat(
            BASE({
                // Focus 'attacker' is the HEALER: slow (acts after the enemy hit), full HP itself,
                // basis-'hp' repair scales off ITS max HP (10_000).
                attack: 1,
                crit: 0,
                critDamage: 0,
                healModifier: 0,
                numRounds: 1,
                hp: HEALER_HP,
                speed: 10, // healer is slow → enemy + tank act first
                enemyHp: 1_000_000_000,
                healTargetId: 'tank', // the over-repaired ally is a team actor, NOT the focus
                teamActors: [tankActor(20)], // tank acts before the healer (inert)
                shipSkills,
                enemyAttackers: [enemyHitter()],
                __testTapActors: (actors) => {
                    captured = actors;
                },
            })
        );

        // ── Pin the overheal: heal-performed.overheal credited to the healer must equal 3_000 ──
        // The focus 'attacker' is the applier (creditId), so its overheal bucket carries the clip.
        expect(result.healing).toBeDefined();
        expect(sumHeal(result, 'overheal', 'attacker')).toBeCloseTo(EXPECTED_OVERHEAL, 6);

        // ── The H3.4 assertion: the over-repaired ally (the tank) accrued 0.30 × overheal ───────
        // Read both the post-cap per-round `granted` AND the live tank pool — they must agree.
        const tankGranted = result.rounds.reduce(
            (sum, rd) => sum + (rd.perActorShield?.['tank']?.granted ?? 0),
            0
        );
        expect(tankGranted).toBeCloseTo(EXPECTED_SHIELD, 6);

        const tank = captured.find((a) => a.id === 'tank');
        expect(tank?.shieldPool).toBeGreaterThan(0);
        expect(tank?.shieldPool).toBeCloseTo(EXPECTED_SHIELD, 6);

        // Non-vacuous / routing: the healer (carrier) is NOT the over-repaired ally → no pool on it.
        const focus = captured.find((a) => a.id === 'attacker');
        expect(focus?.shieldPool ?? 0).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// H3 Task H3.8: Resonating Fury implant — Crit Power Up III to shield recipients
// ---------------------------------------------------------------------------
//
// Resonating Fury (legendary) resolves through the registry
// (IMPLANT_ABILITIES.RESONATING_FURY, H3.8) into a reactive ability:
//   { type:'buff', target:'all-allies', trigger:'on-shield-applied', procChance:0.16,
//     config:{ type:'buff', buffName:'Crit Power Up III', duration:1 } }
// 'on-shield-applied' is a LIVE trigger → it partitions into reactiveAbilities. When the carrier
// applies a shield (its OWN cast, or a reactive shield off another implant/gear set), H3.6 emits
// ONE `shield-applied` event keyed on the granter listing the recipients whose pool grew. The
// H3.7 listener (granter-scoped) threads recipientIds into eventCtx.shieldRecipientIds; the buff
// executor's 'all-allies' routing fans the grant to EXACTLY those recipients (NOT every ally).
//
// Forcing the proc DETERMINISTICALLY: the per-(owner,ability) RateGate accumulates +procChance per
// qualifying event and fires when it crosses 1. The established device (Ambush/REACTIVE_WARD/Last
// Stand integration tests) is to mutate ONLY the built ability's `procChance` to 1 — every other
// field (trigger, buffName, target, duration) comes straight from the registry, so the test still
// bites if the registry entry breaks. We capture RF firing via 'buff-applied' events filtered to
// the buff name, exactly as the Ambush integration test does.
//
// In-game the implant text reads "Crit Power Up 3"; "3" is the canonical "III" tier — the only
// matching BUFFS entry is 'Crit Power Up III' (the Ambush implant carries the same in-game buff and
// the registry resolves both to 'Crit Power Up III'). The buff value, not the literal "3", is what
// matters.

const resonatingFuryPiece = makePiece({
    id: 'rf-legendary',
    slot: 'implant_major',
    rarity: 'legendary',
    setBonus: 'RESONATING_FURY',
});

const RF_BUFF = 'Crit Power Up III';

/**
 * Build the focus's ship skills with a legendary Resonating Fury merged into the passive slot via
 * the REAL build→merge path, plus the supplied active. The built RF ability is determinized
 * (procChance → 1) so every qualifying shield cast fires; all other fields come from the registry.
 */
function buildRfShipSkills(active: Ability) {
    const ship = makeShip({ implants: { implant_major: 'rf-legendary' } });
    const getGearPiece = makeGetGearPiece({ 'rf-legendary': resonatingFuryPiece });
    const baseSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece);
    const passive = baseSkills.slots.find((s) => s.slot === 'passive');
    expect(passive).toBeDefined();

    const rf = passive!.abilities.find((a) => a.id.startsWith('equip-implant-RESONATING_FURY'));
    expect(rf).toBeDefined();
    // Sanity: the registry entry is the on-shield-applied all-allies Crit Power Up III grant.
    expect(rf!.type).toBe('buff');
    expect(rf!.target).toBe('all-allies');
    expect(rf!.trigger).toBe('on-shield-applied');
    expect(rf!.procChance).toBeCloseTo(0.16);
    if (rf!.config.type === 'buff') {
        expect(rf!.config.buffName).toBe(RF_BUFF);
        expect(rf!.config.duration).toBe(1);
    }

    // Determinize: mutate ONLY procChance (the established Ambush/REACTIVE_WARD device).
    const determinizedRf: Ability = { ...rf!, procChance: 1 };
    const otherPassives = passive!.abilities.filter(
        (a) => !a.id.startsWith('equip-implant-RESONATING_FURY')
    );
    const shipSkills: ShipSkills = {
        slots: [
            { slot: 'active', abilities: [active] },
            { slot: 'passive', abilities: [...otherPassives, determinizedRf] },
        ],
    };
    return shipSkills;
}

/** Collect RF_BUFF buff-applied events (actorId + round) across a run driven by `input`. */
function collectRfFires(input: CombatEngineInput): Array<{ actorId: string; round: number }> {
    const bus = createEventBus();
    const out: Array<{ actorId: string; round: number }> = [];
    bus.on('buff-applied', (e) => {
        if (e.buffName === RF_BUFF) out.push({ actorId: e.actorId, round: e.round });
    });
    runCombat({ ...input, bus });
    return out;
}

describe('H3.8 integration — Resonating Fury grants Crit Power Up III to shield recipients', () => {
    /** A team ally that does nothing — just exists to be a shield recipient. */
    const passiveAlly = (id: string, hp: number): TeamActorEngineInput => ({
        id,
        speed: 1, // slow → the focus acts first and casts the shield
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        walk: {
            shipSkills: { slots: [] },
            stats: {
                attack: 1,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });

    // ── Test 1: the carrier casts a shield → the recipients get Crit Power Up III ───────────
    it('shield cast → Crit Power Up III lands on every recipient of that cast (one proc roll)', () => {
        // Focus 'attacker' carries Resonating Fury and casts an `all-allies` shield as its active.
        // The cast shields the focus + both allies → ONE shield-applied event listing all three →
        // RF (forced proc) grants Crit Power Up III to all three recipients from that single cast.
        const shieldActive: Ability = {
            id: 'rf-shield-cast',
            type: 'shield',
            target: 'all-allies',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'shield', pct: 25, basis: 'hp' },
        };
        const shipSkills = buildRfShipSkills(shieldActive);

        const fires = collectRfFires(
            BASE({
                attack: 1,
                crit: 0,
                critDamage: 0,
                numRounds: 1,
                hp: 10_000,
                speed: 100, // focus acts first → casts the shield before allies
                enemyHp: 1_000_000_000,
                shipSkills,
                teamActors: [passiveAlly('rf-ally-1', 10_000), passiveAlly('rf-ally-2', 10_000)],
            })
        );

        // Crit Power Up III landed on all three shield recipients (focus + both allies), and the
        // grants are confined to round 1 (the single cast). Recipients are the shield recipients,
        // not "every ally" by coincidence — here all three allies are recipients, so the next test
        // pins the routing with a SELF-only shield.
        const recipients = new Set(fires.map((f) => f.actorId));
        expect(recipients).toEqual(new Set(['attacker', 'rf-ally-1', 'rf-ally-2']));
        expect(fires.every((f) => f.round === 1)).toBe(true);
    });

    // ── Test 1b: SELF-only shield → buff lands on the granter ONLY (recipient routing, not team) ─
    it('self-only shield cast → Crit Power Up III lands on the granter ONLY, not the idle allies', () => {
        // The focus shields ITSELF only → recipientIds === [focus]. RF's all-allies grant must route
        // to EXACTLY that recipient (shieldRecipientIds), proving it does NOT fan to every ally.
        const selfShieldActive: Ability = {
            id: 'rf-self-shield',
            type: 'shield',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'shield', pct: 25, basis: 'hp' },
        };
        const shipSkills = buildRfShipSkills(selfShieldActive);

        const fires = collectRfFires(
            BASE({
                attack: 1,
                crit: 0,
                critDamage: 0,
                numRounds: 1,
                hp: 10_000,
                speed: 100,
                enemyHp: 1_000_000_000,
                shipSkills,
                teamActors: [passiveAlly('rf-ally-1', 10_000), passiveAlly('rf-ally-2', 10_000)],
            })
        );

        expect(fires.length).toBeGreaterThan(0);
        expect(fires.every((f) => f.actorId === 'attacker')).toBe(true);
    });

    // ── Test 2 (KEY): reactive → reactive hop ───────────────────────────────────────────────
    // The focus carries BOTH a legendary Adaptive Plating (on-attacked self shield) AND Resonating
    // Fury. An enemy directly hits the focus → Adaptive Plating grants a self-shield → H3.6 emits a
    // `shield-applied` event → RF (forced proc) reacts to it and grants Crit Power Up III to the
    // shield recipient (the focus). This proves the reactive→reactive hop: a reactive shield re-emits
    // an event that drives ANOTHER reactive ability, with the second intent enqueued mid-drain and
    // drained by the same multi-generation `while (queue.length > 0)` loop in drainQueue.
    it('reactive→reactive hop: Adaptive-Plating self-shield re-fires Resonating Fury onto the carrier', () => {
        // Build both implants through the real registry; Adaptive Plating in implant_minor so both
        // resolve. (The build path keys implants by slot; AP determinism comes from its own proc gate
        // — to make the AP shield reliably land we force AP's procChance to 1 too.)
        const adaptivePiece = makePiece({
            id: 'rf-ap-legendary',
            slot: 'implant_minor',
            rarity: 'legendary',
            setBonus: 'ADAPTIVE_PLATING',
        });
        const ship = makeShip({
            implants: { implant_major: 'rf-legendary', implant_minor: 'rf-ap-legendary' },
        });
        const getGearPiece = makeGetGearPiece({
            'rf-legendary': resonatingFuryPiece,
            'rf-ap-legendary': adaptivePiece,
        });
        const baseSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece);
        const passive = baseSkills.slots.find((s) => s.slot === 'passive');
        expect(passive).toBeDefined();

        const rf = passive!.abilities.find((a) => a.id.startsWith('equip-implant-RESONATING_FURY'));
        const ap = passive!.abilities.find((a) =>
            a.id.startsWith('equip-implant-ADAPTIVE_PLATING')
        );
        expect(rf).toBeDefined();
        expect(ap).toBeDefined();
        expect(ap!.trigger).toBe('on-attacked');
        expect(rf!.trigger).toBe('on-shield-applied');

        // Force BOTH procs to 1 so the chain is deterministic: AP self-shields on the hit, RF reacts
        // to the resulting shield-applied. Everything else stays from the registry.
        const determinizedRf: Ability = { ...rf!, procChance: 1 };
        const determinizedAp: Ability = { ...ap!, procChance: 1 };
        const otherPassives = passive!.abilities.filter(
            (a) =>
                !a.id.startsWith('equip-implant-RESONATING_FURY') &&
                !a.id.startsWith('equip-implant-ADAPTIVE_PLATING')
        );
        // A no-op active keeps the round cadence; the focus deals no damage itself.
        const noopActive: Ability = {
            id: 'rf-noop-active',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 0 },
        };
        const shipSkills: ShipSkills = {
            slots: [
                { slot: 'active', abilities: [noopActive] },
                { slot: 'passive', abilities: [...otherPassives, determinizedAp, determinizedRf] },
            ],
        };

        // An enemy that directly hits the focus each round → drives Adaptive Plating's on-attacked.
        const enemyHitter = () => ({
            id: 'rf-enemy',
            stats: {
                attack: 1_000,
                crit: 0,
                critDamage: 0,
                speed: 1, // acts before the (slower) focus so the hit lands at round top
                defence: 0,
                hp: 1_000_000_000,
            },
            chargeCount: 0,
            startCharged: false,
            shipSkills: {
                slots: [
                    {
                        slot: 'active' as const,
                        abilities: [
                            {
                                id: 'rf-enemy-hit',
                                type: 'damage' as const,
                                target: 'enemy' as const,
                                trigger: 'on-cast' as const,
                                conditions: [],
                                config: { type: 'damage' as const, multiplier: 100, hits: 1 },
                            },
                        ],
                    },
                ],
            } as ShipSkills,
        });

        const fires = collectRfFires(
            BASE({
                attack: 0,
                crit: 0,
                critDamage: 0,
                numRounds: 3,
                hp: 100_000_000, // huge → focus survives; the AP shield never caps out
                defence: 0,
                speed: 1, // focus acts AFTER the enemy hit so AP fires at round top
                enemyHp: 1_000_000_000,
                healTargetId: 'attacker',
                shipSkills,
                enemyAttackers: [enemyHitter()],
            })
        );

        // THE HOP: AP's reactive self-shield re-emitted shield-applied, RF reacted, and Crit Power Up
        // III landed on the carrier (the shield recipient). If drainQueue did NOT process intents
        // enqueued mid-drain, this would be empty.
        expect(fires.length).toBeGreaterThan(0);
        expect(fires.every((f) => f.actorId === 'attacker')).toBe(true);
    });

    // ── Test 3: Shield gear set (start-of-turn self shield) + RF ─────────────────────────────
    it('Shield gear set start-of-turn self-shield re-fires Resonating Fury onto the carrier', () => {
        // Focus carries the SHIELD gear set (start-of-turn self shield) + Resonating Fury, both via
        // the real build path. Each turn the gear set self-shields → shield-applied → RF (forced
        // proc) grants Crit Power Up III to the self (the shield recipient).
        const ship = makeShip({
            equipment: { weapon: 'rf-shield-1', hull: 'rf-shield-2' },
            implants: { implant_major: 'rf-legendary' },
        });
        const shieldPieceA2 = makePiece({ id: 'rf-shield-1', slot: 'weapon', setBonus: 'SHIELD' });
        const shieldPieceB2 = makePiece({ id: 'rf-shield-2', slot: 'hull', setBonus: 'SHIELD' });
        const getGearPiece = makeGetGearPiece({
            'rf-legendary': resonatingFuryPiece,
            'rf-shield-1': shieldPieceA2,
            'rf-shield-2': shieldPieceB2,
        });
        const baseSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece);
        const passive = baseSkills.slots.find((s) => s.slot === 'passive');
        expect(passive).toBeDefined();

        const setShield = passive!.abilities.find((a) => a.id === 'equip-set-SHIELD');
        const rf = passive!.abilities.find((a) => a.id.startsWith('equip-implant-RESONATING_FURY'));
        expect(setShield).toBeDefined();
        expect(setShield!.trigger).toBe('start-of-turn');
        expect(rf).toBeDefined();

        const determinizedRf: Ability = { ...rf!, procChance: 1 };
        const otherPassives = passive!.abilities.filter(
            (a) => !a.id.startsWith('equip-implant-RESONATING_FURY')
        );
        const noopActive: Ability = {
            id: 'rf-noop-active',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 0 },
        };
        const shipSkills: ShipSkills = {
            slots: [
                { slot: 'active', abilities: [noopActive] },
                { slot: 'passive', abilities: [...otherPassives, determinizedRf] },
            ],
        };

        const fires = collectRfFires(
            BASE({
                attack: 0,
                crit: 0,
                critDamage: 0,
                numRounds: 3,
                hp: 100_000_000,
                speed: 100,
                enemyHp: 1_000_000_000,
                shipSkills,
            })
        );

        expect(fires.length).toBeGreaterThan(0);
        expect(fires.every((f) => f.actorId === 'attacker')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Lifeline (incoming-shield-grant) — once-per-battle PRE-hit threshold shield
// ---------------------------------------------------------------------------
//
// Lifeline (legendary) resolves through the registry (IMPLANT_ABILITIES.LIFELINE) into a
// nominal-trigger ability:
//   { type:'incoming-shield-grant', target:'self', trigger:'on-cast',
//     config:{ type:'incoming-shield-grant', hpThresholdPct:30, flatAmount:12000,
//              attackPct:100, oncePerCombat:true } }
// It is NOT routed via the reactive executor; it is consumed victim-side in applyVictimDamage
// (engine.ts ~2784). When a PURE direct hit (byDirectDamage && no bomb portion) would carry the
// carrier from >=30% to <30% of max HP, the engine grants flatAmount + 100%·attack to the shield
// pool (capped at max HP) BEFORE the hit's absorb step, so the rest of THAT hit drains shield→HP.
// The unit can still die. Once per battle, keyed `${victimId}:${abilityId}` in thresholdShieldFired.
//
// Concrete setup pinned across all three cases (no mitigation arithmetic):
//   carrier maxHp 10000, attack 2000, legendary Lifeline → grant = 12000 + 2000 = 14000,
//   capped to maxHp 10000. Threshold T = 30% × 10000 = 3000. Carrier starts at full HP (100%).
//   Enemy hits are pure single-hit direct attacks (no crit/defence/pen on either side), carrier
//   is slow (speed 1) so the enemy hits land at the top of each round, before the carrier acts.
//   The grant surfaces on the H1 per-round accumulator: RoundData.perActorShield['attacker'].granted.
const lifelinePiece = makePiece({
    id: 'lifeline-legendary',
    slot: 'implant_major',
    rarity: 'legendary',
    setBonus: 'LIFELINE',
});

describe('Lifeline (incoming-shield-grant)', () => {
    /** No-op active for the carrier (focus) — deals no damage, just keeps the round cadence. */
    const noopActive: Ability = {
        id: 'noop-active',
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier: 0 },
    };

    /** Build the carrier's ship skills via the REAL registry: no-op active + the Lifeline passive.
     *  Returns both the ShipSkills and the resolved ability id so callers can assert the registry
     *  shape landed (pre-condition). */
    function buildLifelineCarrier(): { shipSkills: ShipSkills; lifelineId: string } {
        const ship = makeShip({ implants: { implant_major: 'lifeline-legendary' } });
        const getGearPiece = makeGetGearPiece({ 'lifeline-legendary': lifelinePiece });
        const baseSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece);
        const passive = baseSkills.slots.find((s) => s.slot === 'passive');
        expect(passive).toBeDefined();
        const lifeline = passive!.abilities.find((a) => a.id.startsWith('equip-implant-LIFELINE'));
        // Pre-condition: the Lifeline ability resolved through the registry with the spec shape.
        expect(lifeline).toBeDefined();
        expect(lifeline!.config).toMatchObject({
            type: 'incoming-shield-grant',
            hpThresholdPct: 30,
            flatAmount: 12000,
            attackPct: 100,
            oncePerCombat: true,
        });
        return {
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [noopActive] },
                    ...(passive ? [{ slot: passive.slot, abilities: passive.abilities }] : []),
                ],
            },
            lifelineId: lifeline!.id,
        };
    }

    /** Carrier WITHOUT Lifeline (control) — just the no-op active. */
    const carrierNoLifeline: ShipSkills = {
        slots: [{ slot: 'active', abilities: [noopActive] }],
    };

    /** A fast enemy that lands ONE pure direct hit of `dmg` on the carrier each round.
     *  attack = dmg, multiplier 100, single hit, no crit → per-round direct damage taken = dmg. */
    function directHitter(dmg: number) {
        return {
            id: 'lifeline-enemy',
            stats: {
                attack: dmg,
                crit: 0,
                critDamage: 0,
                speed: 1000, // acts before the slow (speed 1) carrier
                defence: 0,
                hp: 1_000_000_000,
            },
            chargeCount: 0,
            startCharged: false,
            shipSkills: {
                slots: [
                    {
                        slot: 'active' as const,
                        abilities: [
                            {
                                id: 'lifeline-enemy-hit',
                                type: 'damage' as const,
                                target: 'enemy' as const,
                                trigger: 'on-cast' as const,
                                conditions: [],
                                config: { type: 'damage' as const, multiplier: 100, hits: 1 },
                            },
                        ],
                    },
                ],
            } as ShipSkills,
        };
    }

    /** Base engine input for the carrier ('attacker'): healing mode, maxHp 10000, attack 2000,
     *  slow so the enemy hit lands first. No mitigation so damage taken == nominal hit. */
    const LIFELINE_BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput =>
        BASE({
            attack: 2000, // → Lifeline grant = 12000 + 100%·2000 = 14000 (capped to maxHp)
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 10_000,
            speed: 1,
            enemyHp: 1_000_000_000,
            healTargetId: 'attacker',
            ...overrides,
        });

    /** Sum the carrier's per-round granted-shield surface across the whole battle. */
    function totalGranted(result: ReturnType<typeof runCombat>): number {
        return result.rounds.reduce(
            (sum, rd) => sum + (rd.perActorShield?.['attacker']?.granted ?? 0),
            0
        );
    }

    /** Did the carrier ('attacker') die? Read the heal target's destroyed round. */
    function carrierDied(result: ReturnType<typeof runCombat>): boolean {
        return result.healing?.destroyedRound !== undefined;
    }

    // ── Case 1: crossing grants a shield that soaks the remainder ─────────────────
    //
    // Per-hit 4000 over 3 rounds. maxHp 10000, T = 3000.
    //   R1: HP 10000 → 6000 (pool 0, no crossing; 6000 >= 3000).
    //   R2: HP 6000, would-be 6000 − 4000 = 2000 < 3000, currentHp 6000 >= 3000 → CROSS.
    //       Grant 14000 capped to 10000 → pool 10000 (before absorb). Absorb 4000 → pool 6000,
    //       HP stays 6000.
    //   R3: HP 6000, pool 6000. The 4000 hit is fully absorbed (would-be HP 6000, no crossing,
    //       and already fired) → pool 2000, HP 6000. Carrier SURVIVES all three rounds.
    // Control (no Lifeline): R1 6000, R2 2000, R3 2000 − 4000 → DEAD at round 3.
    it(
        'Case 1: a direct hit crossing below 30% grants a maxHP-capped shield that soaks the ' +
            'remainder — the carrier SURVIVES a hit that kills the no-Lifeline control',
        () => {
            const { shipSkills } = buildLifelineCarrier();
            const result = runCombat(
                LIFELINE_BASE({
                    numRounds: 3,
                    shipSkills,
                    enemyAttackers: [directHitter(4000)],
                })
            );

            // The carrier survived the full battle.
            expect(carrierDied(result)).toBe(false);

            // EXACTLY one capped grant fired across the battle: pool jumped from 0 to maxHp 10000.
            expect(totalGranted(result)).toBeCloseTo(10_000, 6);

            // The grant landed on the carrier's pool and it still carries shield at end of battle
            // (proving the pool soaked hits that would otherwise have hit HP).
            const lastRound = result.rounds[result.rounds.length - 1];
            expect(lastRound.perActorShield?.['attacker']?.pool).toBeGreaterThan(0);

            // CONTROL — identical setup WITHOUT Lifeline: the carrier takes the same hits to HP
            // with no shield and DIES at round 3. This is the divergence Lifeline prevents above.
            const controlResult = runCombat(
                LIFELINE_BASE({
                    numRounds: 3,
                    shipSkills: carrierNoLifeline,
                    enemyAttackers: [directHitter(4000)],
                })
            );
            expect(carrierDied(controlResult)).toBe(true);
            // The control never granted any shield (no Lifeline).
            expect(totalGranted(controlResult)).toBeCloseTo(0, 6);
        }
    );

    // ── Case 2: Lifeline is NOT a death-save ──────────────────────────────────────
    //
    // A single overwhelming direct hit. maxHp 10000, full HP, T = 3000.
    //   Provisional (pool 0): hpDamage 25000, would-be 10000 − 25000 < 3000, currentHp 10000 >=
    //   3000 → CROSS → grant 14000 capped to 10000 → pool 10000. Total soak capacity = pool 10000
    //   + HP 10000 = 20000 < 25000 → absorb 10000, remaining 15000 to HP → HP 0. Carrier DESTROYED.
    it(
        'Case 2: a hit exceeding (shield grant + remaining HP) still DESTROYS the carrier — ' +
            'Lifeline is not a death-save',
        () => {
            const { shipSkills } = buildLifelineCarrier();
            const result = runCombat(
                LIFELINE_BASE({
                    numRounds: 1,
                    shipSkills,
                    enemyAttackers: [directHitter(25_000)],
                })
            );

            // The shield DID fire (the crossing condition was met) — non-vacuous: this is a
            // genuine Lifeline grant, not "the hit just missed the threshold".
            expect(totalGranted(result)).toBeCloseTo(10_000, 6);

            // …yet the carrier still died: 25000 overwhelmed pool 10000 + HP 10000.
            expect(carrierDied(result)).toBe(true);
        }
    );

    // ── Case 3: once per battle ───────────────────────────────────────────────────

    //
    // Per-hit 4000 over 5 rounds. maxHp 10000, attack 2000, T = 3000.
    //   R1: HP 10000 → 6000 (pool 0).
    //   R2: HP 6000, would-be 2000 < 3000 → CROSS → GRANT #1 (capped 10000) → pool 10000;
    //       absorb 4000 → pool 6000, HP 6000.
    //   R3: HP 6000, pool 6000 → fully absorbs 4000 → pool 2000, HP 6000 (no crossing).
    //   R4: HP 6000, pool 2000 → absorb 2000, hpDmg 2000 → pool 0, HP 4000 (would-be 4000, no cross).
    //   R5: HP 4000, pool 0 → would-be 0 < 3000, currentHp 4000 >= 3000 → a SECOND qualifying
    //       crossing, but Lifeline ALREADY FIRED → NO new grant → HP → 0, carrier DIES.
    // If once-per-battle were broken, R5 would re-grant (pool → 10000) and the carrier would
    // SURVIVE — so the carrier's death at R5 + total granted == one grant is the non-vacuous proof.
    it(
        'Case 3: two qualifying direct crossings across the battle grant the shield only ONCE — ' +
            'the second qualifying hit gets no grant and the carrier dies',
        () => {
            const { shipSkills } = buildLifelineCarrier();
            const result = runCombat(
                LIFELINE_BASE({
                    numRounds: 5,
                    shipSkills,
                    enemyAttackers: [directHitter(4000)],
                })
            );

            // Exactly ONE grant across the entire battle (the R2 capped grant of 10000). A second
            // grant at R5 would double this to 20000.
            expect(totalGranted(result)).toBeCloseTo(10_000, 6);

            // The carrier dies at R5: the second qualifying crossing produced NO shield. With a
            // second grant the carrier would have survived — this asserts the once-per-battle gate.
            expect(carrierDied(result)).toBe(true);
        }
    );
});

// ---------------------------------------------------------------------------
// Tasks 1.5 + 3.3: Voidfire Catalyst implant — detonationDamage + bombSplashDamage modifiers
// ---------------------------------------------------------------------------
//
// Voidfire Catalyst is an ultimate implant. Both halves are now wired:
//   common:    detonationDamage 2 + bombSplashDamage 4    → 2 abilities
//   uncommon:  detonationDamage 4 + bombSplashDamage 8    → 2 abilities
//   rare:      bombSplashDamage 24 only (no detonation)   → 1 ability
//   epic:      detonationDamage 8 + bombSplashDamage 16   → 2 abilities
//   legendary: bombSplashDamage 40 only (no detonation)   → 1 ability

describe('Tasks 1.5 + 3.3 — Voidfire Catalyst: detonationDamage + bombSplashDamage modifiers', () => {
    /**
     * Build an implant piece with setBonus 'VOIDFIRE_CATALYST' at the given rarity
     * and return the abilities produced by buildEquipmentAbilities.
     */
    function voidfireAbilities(rarity: GearPiece['rarity']) {
        const id = `voidfire-${rarity}`;
        const piece = makePiece({
            id,
            slot: 'implant_major',
            rarity,
            setBonus: 'VOIDFIRE_CATALYST',
        });
        const ship = makeShip({ implants: { implant_major: id } });
        const getGearPiece = makeGetGearPiece({ [id]: piece });
        return buildEquipmentAbilities(ship, getGearPiece);
    }

    /** Extract the first modifier ability with channel 'detonationDamage', if any. */
    function findDetAbility(abilities: ReturnType<typeof buildEquipmentAbilities>) {
        return abilities.find(
            (a) =>
                a.type === 'modifier' &&
                'channel' in a.config &&
                (a.config as { channel: string }).channel === 'detonationDamage'
        );
    }

    /** Extract the first modifier ability with channel 'bombSplashDamage', if any. */
    function findSplashAbility(abilities: ReturnType<typeof buildEquipmentAbilities>) {
        return abilities.find(
            (a) =>
                a.type === 'modifier' &&
                'channel' in a.config &&
                (a.config as { channel: string }).channel === 'bombSplashDamage'
        );
    }

    it('common → 2 abilities: detonationDamage value 2 AND bombSplashDamage value 4', () => {
        const abilities = voidfireAbilities('common');
        expect(abilities).toHaveLength(2);
        const det = findDetAbility(abilities);
        expect(det).toBeDefined();
        expect(det!.config).toMatchObject({
            type: 'modifier',
            channel: 'detonationDamage',
            value: 2,
            isMultiplicative: false,
        });
        const splash = findSplashAbility(abilities);
        expect(splash).toBeDefined();
        expect(splash!.config).toMatchObject({
            type: 'modifier',
            channel: 'bombSplashDamage',
            value: 4,
            isMultiplicative: false,
        });
    });

    it('uncommon → 2 abilities: detonationDamage value 4 AND bombSplashDamage value 8', () => {
        const abilities = voidfireAbilities('uncommon');
        expect(abilities).toHaveLength(2);
        const det = findDetAbility(abilities);
        expect(det).toBeDefined();
        expect(det!.config).toMatchObject({
            type: 'modifier',
            channel: 'detonationDamage',
            value: 4,
            isMultiplicative: false,
        });
        const splash = findSplashAbility(abilities);
        expect(splash).toBeDefined();
        expect(splash!.config).toMatchObject({
            type: 'modifier',
            channel: 'bombSplashDamage',
            value: 8,
            isMultiplicative: false,
        });
    });

    it('epic → 2 abilities: detonationDamage value 8 AND bombSplashDamage value 16', () => {
        const abilities = voidfireAbilities('epic');
        expect(abilities).toHaveLength(2);
        const det = findDetAbility(abilities);
        expect(det).toBeDefined();
        expect(det!.config).toMatchObject({
            type: 'modifier',
            channel: 'detonationDamage',
            value: 8,
            isMultiplicative: false,
        });
        const splash = findSplashAbility(abilities);
        expect(splash).toBeDefined();
        expect(splash!.config).toMatchObject({
            type: 'modifier',
            channel: 'bombSplashDamage',
            value: 16,
            isMultiplicative: false,
        });
    });

    it('rare → 1 ability: bombSplashDamage value 24, NO detonationDamage', () => {
        const abilities = voidfireAbilities('rare');
        expect(abilities).toHaveLength(1);
        const det = findDetAbility(abilities);
        expect(det).toBeUndefined();
        const splash = findSplashAbility(abilities);
        expect(splash).toBeDefined();
        expect(splash!.config).toMatchObject({
            type: 'modifier',
            channel: 'bombSplashDamage',
            value: 24,
            isMultiplicative: false,
        });
    });

    it('legendary → 1 ability: bombSplashDamage value 40, NO detonationDamage', () => {
        const abilities = voidfireAbilities('legendary');
        expect(abilities).toHaveLength(1);
        const det = findDetAbility(abilities);
        expect(det).toBeUndefined();
        const splash = findSplashAbility(abilities);
        expect(splash).toBeDefined();
        expect(splash!.config).toMatchObject({
            type: 'modifier',
            channel: 'bombSplashDamage',
            value: 40,
            isMultiplicative: false,
        });
    });
});
