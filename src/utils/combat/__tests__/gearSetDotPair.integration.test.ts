/**
 * Group D (Task 6): Burner + Decimation gear-set DoT pair — mutation-resistant engine
 * integration tests.
 *
 * These tests route through the REAL equipment-ability registry: the ship's abilities are
 * built via `buildShipAbilitiesWithEquipment(ship, getGearPiece)` with gear pieces whose
 * `setBonus` is 'BURNER' / 'DECIMATION'. The Decimation modifier is NOT hand-rolled — if
 * someone breaks the DECIMATION registry entry (e.g. zeroes its value) or the
 * `dotDamage`→`dotMult` fold (effectiveDamageStatsOf.selfDotDamageModifier), this test fails.
 *
 * ── BURNER (now live via on-deal-damage) ─────────────────────────────────────────────────
 * BURNER's registry entry now rides trigger `on-deal-damage` (a LIVE_TRIGGER that fires once per
 * turn the owner deals direct damage), NOT `on-cast` (a passive-slot on-cast DoT is engine-inert:
 * the cast path only gathers DoTs from the FIRED skill). The reactive DoT executor (triggers.ts)
 * pushes an inferno entry (`{dotType:'inferno',tier:15,stacks:1,duration:2}`, sourceId=owner) onto
 * the attack target (`ctx.enemy.id`) and emits `dot-applied`. So Burner DOES apply Inferno in
 * combat — the tests below verify it empirically through the REAL registry (4 BURNER pieces via
 * `buildShipAbilitiesWithEquipment`, NOT a hand-rolled ability). Because `on-deal-damage` fires
 * every attacking turn, the 2-turn inferno is RE-APPLIED each turn the ship attacks (overlapping
 * stacks), so we assert Burner PRODUCES inferno ticks rather than that it expires after 2 turns.
 *
 * The composition test proves Burner's reactive inferno is Decimation-boosted via the shared
 * `dotMult` fold: Burner+Decimation inferno total = Burner-only total × 1.10 exactly (the per-tick
 * ratio cancels attack/affinity/stacking, leaving only the fold factor).
 *
 * Inferno tick formula (engine, tickDoTs):
 *   damage = stacks × (tier/100) × applierEffectiveAttack × dotMult × affinityMult
 * affinityMult is neutral (1) here, so the Decimation ratio (boosted/control) is exactly the
 * fold factor and cancels attack/affinity.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { ShipSkills, Ability } from '../../../types/abilities';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { buildShipAbilitiesWithEquipment } from '../../abilities/buildShipAbilitiesWithEquipment';
import { bareEnemy, BARE_ENEMY_ID } from '../__testutils__/bareRosterFixture';

// ---------------------------------------------------------------------------
// Harness helpers (mirrored from equipmentAbilities.integration.test.ts)
// ---------------------------------------------------------------------------

/** Minimal Ship stub. Equipment is provided by overrides. */
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

/**
 * A single-hit inferno DoT in the ACTIVE slot — the carrier DoT whose ticks Decimation scales.
 * Tier 15, 1 stack, 2 turns mirrors Burner's emitted DoT shape exactly, so the per-tick damage
 * matches what Burner would inflict once the engine wires passive-slot on-cast DoTs.
 */
const activeInferno: Ability = {
    id: 'active-inferno',
    type: 'dot',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'dot', dotType: 'inferno', tier: 15, stacks: 1, duration: 2 },
};

/** Base engine input: neutral stats, enemy never dies, no crit/affinity variance. */
const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    // SP-4b-2b: a real opponent. DAMAGE fixture (5000 attack over 5 rounds plus DoT ticks) so it
    // takes the 10M-HP form — "enemy never dies" is load-bearing here, since a mid-sim death would
    // silently drop tick rounds out of every total this file sums. 0 lives on the roster entry's
    // own stats.defence (the fight-wide `enemyDefense` scalar it used to be kept in step with,
    // always inert positionally M6, was deleted in SP-4d).
    enemyAttackers: bareEnemy({ stats: { hp: 10_000_000, defence: 0 } }),
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    numRounds: 5,
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
    ...overrides,
});

/** Sum inferno tick damage across all rounds for a run. */
function totalInferno(input: CombatEngineInput): number {
    const bus = createEventBus();
    let sum = 0;
    bus.on('dot-ticked', (e) => {
        const ev = e;
        if (ev.dotType === 'inferno') sum += ev.damage;
    });
    runCombat({ ...input, bus });
    return sum;
}

// ---------------------------------------------------------------------------
// Gear stubs
// ---------------------------------------------------------------------------

// 2 DECIMATION pieces (2pc → 1 set → +10% DoT damage).
const DECIMATION_2PC = [
    makePiece({ id: 'decim-1', slot: 'software', setBonus: 'DECIMATION' }),
    makePiece({ id: 'decim-2', slot: 'thruster', setBonus: 'DECIMATION' }),
];

// 4 BURNER pieces (4pc → activates BURNER's on-deal-damage inferno). Four distinct flat slots.
const BURNER_4PC = [
    makePiece({ id: 'burn-1', slot: 'weapon', setBonus: 'BURNER' }),
    makePiece({ id: 'burn-2', slot: 'hull', setBonus: 'BURNER' }),
    makePiece({ id: 'burn-3', slot: 'generator', setBonus: 'BURNER' }),
    makePiece({ id: 'burn-4', slot: 'sensor', setBonus: 'BURNER' }),
];

/** A plain single-hit damaging active. Burner rides `on-deal-damage`, so the ship must deal
 *  direct damage each turn for the reactive inferno to fire. Carries no DoT of its own. */
const plainAttack: Ability = {
    id: 'plain-attack',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100, hits: 1 },
};

/**
 * Build ShipSkills from the REAL registry: equip `pieces`, run buildShipAbilitiesWithEquipment,
 * then prepend a carrier inferno DoT in the active slot so the ship applies a real DoT each cast.
 * The registry-built passive slot (carrying the DECIMATION modifier) is carried over verbatim.
 */
function skillsWithRegistry(pieces: GearPiece[]): {
    shipSkills: ShipSkills;
    passiveAbilityIds: string[];
} {
    const equipment: Record<string, string> = {};
    const map: Record<string, GearPiece> = {};
    for (const p of pieces) {
        equipment[p.slot] = p.id;
        map[p.id] = p;
    }
    const ship = makeShip({ equipment: equipment as Ship['equipment'] });
    const built = buildShipAbilitiesWithEquipment(ship, makeGetGearPiece(map));
    const passive = built.slots.find((s) => s.slot === 'passive');
    return {
        shipSkills: {
            slots: [
                { slot: 'active', abilities: [activeInferno] },
                ...(passive ? [{ slot: passive.slot, abilities: passive.abilities }] : []),
            ],
        },
        passiveAbilityIds: passive?.abilities.map((a) => a.id) ?? [],
    };
}

/**
 * Build ShipSkills from the REAL registry with an arbitrary active ability: equip `pieces`, run
 * buildShipAbilitiesWithEquipment, then prepend `active` in the active slot and carry the
 * registry-built passive slot (Burner's on-deal-damage DoT + any DECIMATION modifier) verbatim.
 */
function skillsWithActive(
    active: Ability,
    pieces: GearPiece[]
): { shipSkills: ShipSkills; passiveAbilityIds: string[] } {
    const equipment: Record<string, string> = {};
    const map: Record<string, GearPiece> = {};
    for (const p of pieces) {
        equipment[p.slot] = p.id;
        map[p.id] = p;
    }
    const ship = makeShip({ equipment: equipment as Ship['equipment'] });
    const built = buildShipAbilitiesWithEquipment(ship, makeGetGearPiece(map));
    const passive = built.slots.find((s) => s.slot === 'passive');
    return {
        shipSkills: {
            slots: [
                { slot: 'active', abilities: [active] },
                ...(passive ? [{ slot: passive.slot, abilities: passive.abilities }] : []),
            ],
        },
        passiveAbilityIds: passive?.abilities.map((a) => a.id) ?? [],
    };
}

/** Capture inferno `dot-applied` events (sourceId attribution) alongside the inferno tick total. */
function runWithInfernoCapture(input: CombatEngineInput): {
    infernoTick: number;
    infernoApplied: { sourceId: string; targetId: string }[];
} {
    const bus = createEventBus();
    let infernoTick = 0;
    const infernoApplied: { sourceId: string; targetId: string }[] = [];
    bus.on('dot-ticked', (e) => {
        if (e.dotType === 'inferno') infernoTick += e.damage;
    });
    bus.on('dot-applied', (e) => {
        if (e.dotType === 'inferno')
            infernoApplied.push({ sourceId: e.sourceId, targetId: e.targetId });
    });
    runCombat({ ...input, bus });
    return { infernoTick, infernoApplied };
}

// ---------------------------------------------------------------------------
// Burner applies Inferno on attack (real registry, on-deal-damage)
// ---------------------------------------------------------------------------

describe('Gear-set DoT pair — Burner applies Inferno on attack (real registry)', () => {
    it('4 BURNER pieces + a plain attack → enemy takes Burner-attributed inferno ticks', () => {
        const burner = skillsWithActive(plainAttack, BURNER_4PC);

        // Pre-condition: the BURNER on-deal-damage inferno landed in the passive slot via the registry.
        expect(burner.passiveAbilityIds).toContain('equip-set-BURNER');

        const { infernoTick, infernoApplied } = runWithInfernoCapture(
            BASE({
                numRounds: 5,
                attack: 5000,
                crit: 0,
                critDamage: 0,
                shipSkills: burner.shipSkills,
            })
        );

        // Burner fires once per damage-delivering SUB-ATTACK (once per turn for the single-hit
        // cast this fixture drives) → at least one inferno application, attributed to
        // the Burner ship ('attacker') and landing on the attack target.
        // M1: that target is the real roster entry now that a roster is required; it was the
        // vestigial `enemy` sink only because the fixture supplied no opponent.
        expect(infernoApplied.length).toBeGreaterThan(0);
        for (const ev of infernoApplied) {
            expect(ev.sourceId).toBe('attacker');
            expect(ev.targetId).toBe(BARE_ENEMY_ID);
        }
        // And those applications actually tick damage on the enemy.
        expect(infernoTick).toBeGreaterThan(0);
    });

    it('re-applies every attacking turn: inferno re-applied each round, ticks ramp to 2 overlapping stacks', () => {
        // Because Burner rides on-deal-damage and the ship attacks every round, the 2-turn inferno
        // is RE-APPLIED each round (so it never expires while the ship keeps attacking). We assert
        // that behaviour directly: an application AND a tick every round, and the per-round tick
        // damage ramps from a single fresh stack (round 1) to two overlapping stacks (round 2+).
        const burner = skillsWithActive(plainAttack, BURNER_4PC);

        const bus = createEventBus();
        const appliesByRound: number[] = [];
        const tickDmgByRound: number[] = [];
        bus.on('dot-applied', (e) => {
            if (e.dotType !== 'inferno') return;
            appliesByRound[e.round] = (appliesByRound[e.round] ?? 0) + 1;
        });
        bus.on('dot-ticked', (e) => {
            if (e.dotType !== 'inferno') return;
            tickDmgByRound[e.round] = (tickDmgByRound[e.round] ?? 0) + e.damage;
        });
        runCombat(
            BASE({
                numRounds: 4,
                attack: 5000,
                crit: 0,
                critDamage: 0,
                shipSkills: burner.shipSkills,
                bus,
            })
        );

        // Re-applied every round the ship attacks (rounds 1..4).
        for (let r = 1; r <= 4; r++) {
            expect(appliesByRound[r]).toBe(1);
            expect(tickDmgByRound[r]).toBeGreaterThan(0);
        }
        // Per-tick stack damage = 5000 × (15/100) × 1 stack × dotMult(1) = 750. Round 1 = one
        // fresh stack (750); round 2 onward = two overlapping 2-turn stacks (1500). This is the
        // re-application signature — load-bearing: zeroing BURNER's stacks/tier collapses both.
        expect(tickDmgByRound[1]).toBeCloseTo(750, 6);
        expect(tickDmgByRound[2]).toBeCloseTo(1500, 6);
    });
});

// ---------------------------------------------------------------------------
// Composition: Burner + Decimation — Burner's inferno is Decimation-boosted ×1.10
// ---------------------------------------------------------------------------

describe('Gear-set DoT pair — composition (Burner + Decimation)', () => {
    it('Burner+Decimation inferno total = Burner-only control × 1.10 (shared dotMult fold)', () => {
        // Control: 4 BURNER only (no Decimation) — Burner's reactive inferno, dotMult 1.0.
        const burnerOnly = skillsWithActive(plainAttack, BURNER_4PC);
        // Boosted: identical 4 BURNER + 2 DECIMATION (1 set → +10% DoT damage) via the REAL registry.
        const burnerDecim = skillsWithActive(plainAttack, [...BURNER_4PC, ...DECIMATION_2PC]);

        // Pre-conditions: both have Burner; only the boosted run carries the Decimation modifier.
        expect(burnerOnly.passiveAbilityIds).toContain('equip-set-BURNER');
        expect(burnerOnly.passiveAbilityIds).not.toContain('equip-set-DECIMATION');
        expect(burnerDecim.passiveAbilityIds).toContain('equip-set-BURNER');
        expect(burnerDecim.passiveAbilityIds).toContain('equip-set-DECIMATION');

        const env = { numRounds: 5, attack: 5000, crit: 0, critDamage: 0 };
        const control = runWithInfernoCapture(BASE({ ...env, shipSkills: burnerOnly.shipSkills }));
        const boosted = runWithInfernoCapture(BASE({ ...env, shipSkills: burnerDecim.shipSkills }));

        // Burner fires identically in both runs (same attack cadence) → the only difference is the
        // Decimation dotMult fold. Both totals share the same overlapping-stack pattern, so the
        // ratio is exactly the fold factor.
        expect(control.infernoTick).toBeGreaterThan(0);
        expect(boosted.infernoTick).toBeCloseTo(control.infernoTick * 1.1, 3);
    });
});

// ---------------------------------------------------------------------------
// Decimation scales DoT ticks by sets × 10% (real registry + real engine fold)
// ---------------------------------------------------------------------------

describe('Gear-set DoT pair — Decimation scales DoT ticks (real registry + engine fold)', () => {
    it('2 DECIMATION pieces: inferno ticks are exactly ×1.10 vs no-Decimation control', () => {
        // Control: no Decimation — carrier inferno only (no passive slot).
        const controlSkills: ShipSkills = {
            slots: [{ slot: 'active', abilities: [activeInferno] }],
        };
        // Boosted: same carrier inferno + 2 Decimation pieces via the REAL registry.
        const boosted = skillsWithRegistry(DECIMATION_2PC);

        // Pre-condition: the DECIMATION modifier landed in the passive slot via the registry.
        expect(boosted.passiveAbilityIds).toContain('equip-set-DECIMATION');

        const env = { numRounds: 5, attack: 5000, crit: 0, critDamage: 0 };
        const controlInferno = totalInferno(BASE({ ...env, shipSkills: controlSkills }));
        const boostedInferno = totalInferno(BASE({ ...env, shipSkills: boosted.shipSkills }));

        expect(controlInferno).toBeGreaterThan(0);
        // Decimation 2pc → +10% dotDamage → dotMult 1.0→1.1 → boosted = control × 1.10 exactly.
        // (affinityMult is neutral so the ratio cancels attack/affinity.)
        expect(boostedInferno).toBeCloseTo(controlInferno * 1.1, 3);
    });
});
