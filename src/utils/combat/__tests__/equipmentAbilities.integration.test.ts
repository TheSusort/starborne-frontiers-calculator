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
