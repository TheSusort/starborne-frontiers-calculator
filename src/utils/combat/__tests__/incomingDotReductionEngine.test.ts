/**
 * D-PR3 Task 8 — Vortex Veil reduces inferno/corrosion DoT-tick damage on the heal target.
 *
 * The Vortex Veil implant emits an `incoming-reduction { scope:'dot',
 * condition:'dot-inferno-corrosion', pct }` passive ability. When the focus actor (id
 * 'attacker') equips it, enemy-applied inferno/corrosion DoT ticks on the tank's turn-start
 * are reduced by the implant's pct.
 *
 * Setup: focus (speed 100, hp 1_000_000) is the heal target. An enemy attacker (speed 50,
 * attack 5000) applies a 1-stack inferno (tier 100) on each turn. Per turn:
 *   inferno tick = 1 × (100/100) × 5000 × dotMult 1 × affinityMult 1 = 5000
 * Vortex Veil legendary = 30% → reduced tick = 5000 × 0.70 = 3500.
 *
 * With Vortex Veil: dot-ticked damage = 3500.
 * Without Vortex Veil: dot-ticked damage = 5000.
 *
 * The same logic applies to corrosion, tested via a second enemy applying corrosion.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { GearPiece } from '../../../types/gear';
import { Ship } from '../../../types/ship';
import { ShipSkills, Ability } from '../../../types/abilities';
import { buildShipAbilitiesWithEquipment } from '../../abilities/buildShipAbilitiesWithEquipment';

// ── Gear / ship stubs (mirrors incomingReductionEngine.test.ts) ───────────────
function makeShip(over: Partial<Ship>): Ship {
    return {
        id: 'focus-ship',
        name: 'Focus Ship',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'DEFENDER',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: {},
        refits: [],
        ...over,
    };
}
function makePiece(over: Partial<GearPiece>): GearPiece {
    return {
        id: 'piece-1',
        slot: 'implant_major',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: null,
        subStats: [],
        setBonus: null,
        ...over,
    };
}
function makeGetGearPiece(map: Record<string, GearPiece>): (id: string) => GearPiece | undefined {
    return (id) => map[id];
}

/** legendary Vortex Veil: -30% incoming inferno/corrosion DoT damage. */
const vortexVeilPiece = makePiece({
    id: 'vortex-veil-legendary',
    slot: 'implant_major',
    rarity: 'legendary',
    setBonus: 'VORTEX_VEIL',
});

/** Build the passive slot the focus actor needs to carry Vortex Veil. */
function vortexVeilPassiveSlot(): ShipSkills['slots'][number] | undefined {
    const ship = makeShip({ implants: { implant_major: 'vortex-veil-legendary' } });
    const skills = buildShipAbilitiesWithEquipment(
        ship,
        makeGetGearPiece({ 'vortex-veil-legendary': vortexVeilPiece })
    );
    const passive = skills.slots.find((s) => s.slot === 'passive');
    return passive ? { slot: passive.slot, abilities: passive.abilities } : undefined;
}

/** A no-op active (focus deals 0 damage so DoT/direct damage is isolated). */
const noopActive: ShipSkills['slots'][number] = {
    slot: 'active',
    abilities: [
        {
            id: 'noop-dmg',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 0 },
        },
    ],
};

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** An enemy that applies a 1-stack inferno (tier 100) each turn (attack 5000, speed 50). */
const infernoEnemy = (): EnemyAttacker => ({
    id: 'inferno-enemy',
    stats: { attack: 5000, crit: 0, critDamage: 0, speed: 50 },
    chargeCount: 0,
    startCharged: false,
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'inferno-dot',
                        type: 'dot',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: {
                            type: 'dot',
                            dotType: 'inferno',
                            tier: 100,
                            stacks: 1,
                            duration: 1,
                        },
                    } satisfies Ability,
                ],
            },
        ],
    },
});

/** An enemy that applies a 1-stack corrosion (tier 1) each turn (attack 5000, speed 50).
 *  Corrosion scales with the victim's HP; tier 1 → 1% of min(hp, 500000) per stack. */
const corrosionEnemy = (): EnemyAttacker => ({
    id: 'corrosion-enemy',
    stats: { attack: 5000, crit: 0, critDamage: 0, speed: 50 },
    chargeCount: 0,
    startCharged: false,
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'corrosion-dot',
                        type: 'dot',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: {
                            type: 'dot',
                            dotType: 'corrosion',
                            tier: 1,
                            stacks: 1,
                            duration: 1,
                        },
                    } satisfies Ability,
                ],
            },
        ],
    },
});

/** Run 2 rounds. Collect all dot-ticked events from R2 onward (R1 has no ticks yet).
 *  Returns the damage emitted per tick-event for the given dotType. */
function collectDotTicks(withVortexVeil: boolean, dotType: 'inferno' | 'corrosion'): number[] {
    const bus = createEventBus();
    const ticks: number[] = [];
    bus.on('dot-ticked', (e) => {
        const ev = e as { round: number; targetId: string; dotType: string; damage: number };
        if (ev.round >= 2 && ev.dotType === dotType) {
            ticks.push(ev.damage);
        }
    });

    const passive = withVortexVeil ? vortexVeilPassiveSlot() : undefined;
    const shipSkills: ShipSkills = {
        slots: [noopActive, ...(passive ? [passive] : [])],
    };

    const input: CombatEngineInput = {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills,
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
        hp: 1_000_000, // large enough to never die
        healTargetId: 'attacker',
        mode: 'healing',
        bus,
        enemyAttackers: dotType === 'inferno' ? [infernoEnemy()] : [corrosionEnemy()],
    };
    runCombat(input);
    return ticks;
}

describe('D-PR3 Task 8 — Vortex Veil reduces enemy-applied DoT ticks on the heal target', () => {
    // ── Inferno ──────────────────────────────────────────────────────────────
    it('inferno: WITHOUT Vortex Veil the tick is the full 5000', () => {
        // tier 100 × stacks 1 × attack 5000 × dotMult 1 × affinityMult 1 = 5000
        const ticks = collectDotTicks(false, 'inferno');
        expect(ticks.length).toBeGreaterThanOrEqual(1);
        expect(ticks[0]).toBeCloseTo(5000, 6);
    });

    it('inferno: WITH Vortex Veil legendary (30%) the tick is strictly LESS — 3500', () => {
        // 5000 × (1 − 30/100) = 5000 × 0.70 = 3500
        const ticks = collectDotTicks(true, 'inferno');
        expect(ticks.length).toBeGreaterThanOrEqual(1);
        expect(ticks[0]).toBeCloseTo(3500, 6);
        // Confirm strictly less than the unreduced amount
        expect(ticks[0]).toBeLessThan(5000);
    });

    // ── Corrosion ────────────────────────────────────────────────────────────
    it('corrosion: WITHOUT Vortex Veil the tick equals tier 1% of min(hp, 500000)', () => {
        // hp = 1_000_000 → corrosionBaseHp = 500_000
        // tier 1 × stacks 1 × 1/100 × 500_000 × dotMult 1 × affinityMult 1 = 5000
        const ticks = collectDotTicks(false, 'corrosion');
        expect(ticks.length).toBeGreaterThanOrEqual(1);
        expect(ticks[0]).toBeCloseTo(5000, 6);
    });

    it('corrosion: WITH Vortex Veil legendary (30%) the tick is strictly LESS — 3500', () => {
        // 5000 × (1 − 30/100) = 3500
        const ticks = collectDotTicks(true, 'corrosion');
        expect(ticks.length).toBeGreaterThanOrEqual(1);
        expect(ticks[0]).toBeCloseTo(3500, 6);
        expect(ticks[0]).toBeLessThan(5000);
    });
});
