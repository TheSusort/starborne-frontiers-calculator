/**
 * Synaptic Resonance (implant): "Gains Speed Up 3 for 1 turn when an enemy gets directly repaired.
 * Increases the critDamage of the next crit by 10%." (legendary)
 *
 * R153: the bonus is ADDITIVE crit-power points (90% + 10 = 100%, not 99%), armed by the same enemy
 * repair that grants Speed Up III, and spent by the carrier's next crit only: a two-hit cast whose
 * hits both crit gives the bonus to the first hit alone.
 *
 * Board: the carrier (the implant on a passive slot, crit 100, crit power 90) hits a victim that
 * repairs itself before the carrier's turn. A 2-hit active shows "next crit only". Run with the
 * carrier on both sides.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildEquipmentAbilities } from '../../abilities/buildEquipmentAbilities';
import {
    boardInput,
    hitKit,
    NO_KIT,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import { textKit } from '../__testutils__/textKit';
import type { ShipSkills } from '../../../types/abilities';
import type { GearPiece } from '../../../types/gear';
import type { Ship } from '../../../types/ship';

beforeEach(() => setupKeyedRng(8));

const synapticAbilities = (rarity: GearPiece['rarity']) => {
    const pieceId = 'synaptic-piece';
    const piece = { id: pieceId, rarity, setBonus: 'SYNAPTIC_RESONANCE' };
    return buildEquipmentAbilities(
        { implants: { implant_ultimate: pieceId }, equipment: {} } as unknown as Ship,
        (g) => (g === pieceId ? (piece as unknown as GearPiece) : undefined)
    );
};

const carrierKit = (rarity: GearPiece['rarity'] | undefined): ShipSkills => ({
    slots: [
        ...hitKit(100, 2).slots,
        { slot: 'passive', abilities: rarity ? synapticAbilities(rarity) : [] },
    ],
});

const REPAIR_TEXT = 'This Unit <unit-damage>repairs 10%</unit-damage> of its max HP.';

/** The carrier's two round-1 hit sizes against a defenceless victim, in order. */
const twoHits = (
    placement: Placement,
    rarity: GearPiece['rarity'] | undefined,
    victimRepairs: boolean
): number[] => {
    const carrier: BoardUnit = {
        id: 'carrier',
        kit: carrierKit(rarity),
        position: 'M4',
        speed: 100,
        attack: 1000,
        crit: 100,
        critDamage: 90,
        hacking: 1e6,
    };
    const victim: BoardUnit = {
        id: 'victim',
        kit: victimRepairs ? textKit('Repairer', { active: REPAIR_TEXT }) : NO_KIT,
        position: 'M4',
        speed: 500,
        hp: 1e10,
    };
    const { input, id } = boardInput(placement, carrier, [], [victim], 1);
    const bus = createEventBus();
    const hits: number[] = [];
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.attackerId === id(carrier) && e.damage !== undefined) hits.push(e.damage);
    });
    runCombat({ ...input, bus });
    return hits;
};

describe.each<Placement>(['player', 'enemy'])('Synaptic Resonance on the %s side', (placement) => {
    it('adds 10 crit-power points to the next crit after an enemy repair, then it is spent', () => {
        const [first, second] = twoHits(placement, 'legendary', true);
        // Crit power 90 + 10 = 100 on the first crit (x2.00), plain 90 on the second (x1.90).
        expect(first / second).toBeCloseTo(2.0 / 1.9, 9);
    });

    it('control: without the implant both crits are the same size', () => {
        const [first, second] = twoHits(placement, undefined, true);
        expect(first).toBeCloseTo(second, 9);
    });

    it('control: with the implant but no enemy repair, nothing is armed', () => {
        const [first, second] = twoHits(placement, 'legendary', false);
        expect(first).toBeCloseTo(second, 9);
    });

    it('scales with rarity: the common implant adds 2 points', () => {
        const [first, second] = twoHits(placement, 'common', true);
        expect(first / second).toBeCloseTo(1.92 / 1.9, 9);
    });
});
