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
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { buildShipAbilitiesWithEquipment } from '../../abilities/buildShipAbilitiesWithEquipment';
import { buildEquipmentAbilities } from '../../abilities/buildEquipmentAbilities';
import { modifierTotalsFromAbilities } from '../../abilities/applyAbilities';
import { makeConditionContext } from '../../abilities/__tests__/conditionContextFixture';
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
    const INSIDIOUSNESS_PROC = 0.5; // deterministic: floor(20 × 0.5) = 10 procs
    const EXPECTED_PROCS = Math.floor(NUM_ROUNDS * INSIDIOUSNESS_PROC); // 10
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
            '(floor(20 × 0.5)=10 procs × 2800 = 28000 on top of 80000 base damage)',
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

            // Quantitative: the reactive contribution must equal exactly EXPECTED_PROCS × PER_PROC.
            const reactiveContribution =
                withInsidiousness.rawTotals.direct - withoutInsidiousness.rawTotals.direct;
            expect(reactiveContribution).toBeCloseTo(EXPECTED_PROCS * PER_PROC, 1);
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
    const ATTACKER_HP = 10_000;
    const NUM_ROUNDS = 10;
    const SW_PROC = 0.5; // deterministic: floor(10 × 0.5) = 5 fires (calls 2,4,6,8,10)
    const EXPECTED_FIRES = Math.floor(NUM_ROUNDS * SW_PROC); // 5
    const PER_FIRE = ATTACKER_HP * (10 / 100); // 1000 (10% of max HP)
    const EXPECTED_TOTAL = EXPECTED_FIRES * PER_FIRE; // 5000

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
        'A. Crit attacker: Second Wind fires 5 times (rate 0.5 × 10 crits); ' +
            'total directHeal = 5000, effectiveHeal = 0 (full HP → all overheal)',
        () => {
            const result = runCombat(
                SW_BASE({
                    shipSkills: shipSkillsWithSW,
                    enemyAttackers: [makeEnemyAttacker(100)],
                })
            );

            expect(result.healing).toBeDefined();
            expect(result.healing!.rounds).toHaveLength(NUM_ROUNDS);

            // directHeal = 5 fires × (ATTACKER_HP × 10%) = 5 × 1000 = 5000.
            // basis 'hp' resolves to effectiveMaxHp (unchanged regardless of current HP).
            expect(sumHeal(result, 'directHeal')).toBeCloseTo(EXPECTED_TOTAL, 6);

            // Verify the gated schedule: fires on rounds 2, 4, 6, 8, 10 (back-loaded at rate 0.5).
            const firedRounds = result
                .healing!.rounds.map((rd, i) => ({
                    round: i + 1,
                    heal: rd.perActor.get('attacker')?.directHeal ?? 0,
                }))
                .filter((r) => r.heal > 0);
            expect(firedRounds).toHaveLength(EXPECTED_FIRES);
            expect(firedRounds[0].round).toBe(2);
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
        config: { type: 'heal-amplification', condition, ampPct, ...(procChance !== undefined ? { procChance } : {}) },
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
        const VIV_PROC = 0.5; // floor(10 × 0.5) = 5 fires (back-loaded at rate 0.5)
        const VIV_AMP = 100; // +100% → ×2 when it fires
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
        // Baseline: 10 casts × 1000 = 10000. With 5 proc'd ×2 fires: 5 normal + 5 doubled =
        // 5×1000 + 5×2000 = 15000.
        expect(baseHeal).toBeCloseTo(NUM_ROUNDS * BASE_PER_CAST, 6);
        const EXPECTED_FIRES = Math.floor(NUM_ROUNDS * VIV_PROC); // 5
        const expectedAmp =
            NUM_ROUNDS * BASE_PER_CAST + EXPECTED_FIRES * BASE_PER_CAST * (VIV_AMP / 100);
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
        const without = runCombat(
            AMP_BASE({ numRounds: NUM_ROUNDS, shipSkills: healerSkills() })
        );
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
            const EXPECTED_PROCS = Math.floor(NUM_ROUNDS * EXU_PROC); // 5

            const withExu = runCombat(
                EXU_BASE({
                    numRounds: NUM_ROUNDS,
                    shipSkills: skills(exuberance(EXU_AMP, EXU_PROC)),
                })
            );
            const baseline = runCombat(
                EXU_BASE({ numRounds: NUM_ROUNDS, shipSkills: skills() })
            );

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
            const withExu = runCombat(
                EXU_BASE({
                    numRounds: NUM_ROUNDS,
                    shipSkills: {
                        slots: [
                            { slot: 'active', abilities: [noopActive] },
                            {
                                slot: 'passive',
                                abilities: [
                                    reactiveSelfHeal(1.0),
                                    exuberance(EXU_AMP, EXU_PROC),
                                ],
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
            // Exuberance boosts floor(NUM_ROUNDS × 0.5) of those landed repairs.
            const EXPECTED_PROCS = Math.floor(NUM_ROUNDS * EXU_PROC);
            const expectedExu =
                NUM_ROUNDS * BASE_PER_CAST + EXPECTED_PROCS * BASE_PER_CAST * (EXU_AMP / 100);
            expect(exuHeal).toBeCloseTo(expectedExu, 6);
            expect(exuHeal).toBeGreaterThan(baseHeal);
        }
    );
});
