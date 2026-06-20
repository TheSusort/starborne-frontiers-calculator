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
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { ShipSkills } from '../../../types/abilities';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { buildShipAbilitiesWithEquipment } from '../../abilities/buildShipAbilitiesWithEquipment';
import { buildEquipmentAbilities } from '../../abilities/buildEquipmentAbilities';
import { modifierTotalsFromAbilities } from '../../abilities/applyAbilities';
import { ConditionContext } from '../../abilities/evaluateConditions';
import { SelectedGameBuff } from '../../../types/calculator';

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
        const ship = makeShip({
            implants: { implant_major: 'bt-legendary' },
        });
        const getGearPiece = makeGetGearPiece({ 'bt-legendary': bloodthirstPiece });

        // Real resolution+merge path: tasks 2+3.
        const baseSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece);

        // Verify the Bloodthirst ability landed in the passive slot (pre-condition).
        const passive = baseSkills.slots.find((s) => s.slot === 'passive');
        expect(passive).toBeDefined();
        const btAbility = passive!.abilities.find((a) => a.id === 'equip-implant-BLOODTHIRST');
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
        // Back-loaded accumulator: with rate 0.20, the gate crosses 1 at call 5 and call 10.
        // Fires on rounds 5 and 10 (not 2 and 10 — that is the 0.5 schedule).
        expect(firedRounds[0].round).toBe(5);
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

/** Minimal ConditionContext with the same required fields as evaluateConditions.test.ts. */
const makeCtx = (over: Partial<ConditionContext> = {}): ConditionContext => ({
    selfBuffNames: [],
    selfDebuffNames: [],
    enemyBuffNames: [],
    enemyDebuffCount: 0,
    effectiveCritRate: 0,
    adjacentAllyCount: 0,
    enemyAdjacentCount: 0,
    enemyDestroyedCount: 0,
    selfHpPct: 100,
    enemyHpPct: 100,
    ...over,
});

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

        const intrusion = abilities.find((a) => a.id === 'equip-implant-INTRUSION');
        expect(intrusion).toBeDefined();

        const totals = modifierTotalsFromAbilities([intrusion!], makeCtx({ enemyDebuffCount: 3 }));
        expect(totals.outgoingDamage).toBe(15); // 3 × 5
    });

    it('outgoingDamage === 0 when enemyDebuffCount:0 (no debuffs → zero bonus)', () => {
        const ship = makeShip({ implants: { implant_major: 'intrusion-legendary' } });
        const getGearPiece = makeGetGearPiece({ 'intrusion-legendary': intrusionPiece });
        const abilities = buildEquipmentAbilities(ship, getGearPiece);
        const intrusion = abilities.find((a) => a.id === 'equip-implant-INTRUSION');

        const totals = modifierTotalsFromAbilities([intrusion!], makeCtx({ enemyDebuffCount: 0 }));
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
        const warpstrike = abilities.find((a) => a.id === 'equip-implant-WARPSTRIKE');
        expect(warpstrike).toBeDefined();

        const totals = modifierTotalsFromAbilities(
            [warpstrike!],
            makeCtx({ selfDebuffNames: ['Burn'] })
        );
        expect(totals.outgoingDamage).toBe(5);
    });

    it('outgoingDamage === 0 when selfDebuffNames:[] (no self-debuffs → gate fails)', () => {
        const ship = makeShip({ implants: { implant_major: 'warpstrike-legendary' } });
        const getGearPiece = makeGetGearPiece({ 'warpstrike-legendary': warpstrikePiece });
        const abilities = buildEquipmentAbilities(ship, getGearPiece);
        const warpstrike = abilities.find((a) => a.id === 'equip-implant-WARPSTRIKE');

        const totals = modifierTotalsFromAbilities([warpstrike!], makeCtx({ selfDebuffNames: [] }));
        expect(totals.outgoingDamage).toBe(0);
    });

    it(
        'outgoingDamage === 5 (NOT 10) when selfDebuffNames:["A","B"] — ' +
            'flat value, not per-count (load-bearing: proves gate-not-scaler)',
        () => {
            const ship = makeShip({ implants: { implant_major: 'warpstrike-legendary' } });
            const getGearPiece = makeGetGearPiece({ 'warpstrike-legendary': warpstrikePiece });
            const abilities = buildEquipmentAbilities(ship, getGearPiece);
            const warpstrike = abilities.find((a) => a.id === 'equip-implant-WARPSTRIKE');

            const totals = modifierTotalsFromAbilities(
                [warpstrike!],
                makeCtx({ selfDebuffNames: ['A', 'B'] })
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
        const arcaneSiege = abilities.find((a) => a.id === 'equip-implant-ARCANE_SIEGE');
        expect(arcaneSiege).toBeDefined();

        const totals = modifierTotalsFromAbilities([arcaneSiege!], makeCtx({ selfShielded: true }));
        expect(totals.outgoingDamage).toBe(15);
    });

    it('outgoingDamage === 0 when selfShielded:false (gate fails — dormant without shield)', () => {
        const ship = makeShip({ implants: { implant_minor: 'arcane-siege-epic' } });
        const getGearPiece = makeGetGearPiece({ 'arcane-siege-epic': arcaneSiegePiece });
        const abilities = buildEquipmentAbilities(ship, getGearPiece);
        const arcaneSiege = abilities.find((a) => a.id === 'equip-implant-ARCANE_SIEGE');

        const totals = modifierTotalsFromAbilities(
            [arcaneSiege!],
            makeCtx({ selfShielded: false })
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
    }

    /** Ship with NO implant — bare damage active only. */
    const bareShipSkills: ShipSkills = {
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
