/**
 * Synaptic Resonance's armed next-crit crit power (R153) is spent by ANY next crit the owner lands
 * (R157): a counter-attack or a reactive damage proc as much as a skill hit.
 *
 * Board: the carrier (legendary implant, crit 100, crit power 90, no damaging skill of its own)
 * stands in front of a speed-500 attacker that hits it, behind a speed-600 enemy that repairs
 * itself first (arming the bonus). The carrier's retaliation is then the first crit it lands: it
 * must read crit power 90 + 10 = 100 (x2.00 against x1.90). Run with the carrier on both sides.
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
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { GearPiece } from '../../../types/gear';
import type { Ship } from '../../../types/ship';

beforeEach(() => setupKeyedRng(8));

const synapticAbilities = (): Ability[] => {
    const pieceId = 'synaptic-piece';
    const piece = { id: pieceId, rarity: 'legendary', setBonus: 'SYNAPTIC_RESONANCE' };
    return buildEquipmentAbilities(
        { implants: { implant_ultimate: pieceId }, equipment: {} } as unknown as Ship,
        (g) => (g === pieceId ? (piece as unknown as GearPiece) : undefined)
    );
};

const counter: Ability = {
    id: 'test-counter',
    type: 'counter',
    target: 'enemy',
    trigger: 'on-attacked',
    conditions: [],
    config: { type: 'counter', multiplier: 100 },
};
const proc: Ability = {
    id: 'test-proc',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-attacked',
    conditions: [],
    config: { type: 'damage', multiplier: 100, hits: 1 },
};

const carrierKit = (retaliation: Ability, withImplant: boolean): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        {
            slot: 'passive',
            abilities: [retaliation, ...(withImplant ? synapticAbilities() : [])],
        },
    ],
});

const REPAIR_TEXT = 'This Unit <unit-damage>repairs 10%</unit-damage> of its max HP.';

/** The carrier's retaliation damage in round 1. */
const retaliation = (
    placement: Placement,
    retaliate: Ability,
    withImplant: boolean,
    enemyRepairs: boolean
): number => {
    const carrier: BoardUnit = {
        id: 'carrier',
        kit: carrierKit(retaliate, withImplant),
        position: 'M4',
        speed: 1,
        attack: 1000,
        crit: 100,
        critDamage: 90,
        hp: 1e10,
        hacking: 1e6,
    };
    const repairer: BoardUnit = {
        id: 'repairer',
        kit: enemyRepairs ? textKit('Repairer', { active: REPAIR_TEXT }) : NO_KIT,
        position: 'M3',
        speed: 600,
        hp: 1e10,
    };
    const attacker: BoardUnit = {
        id: 'attacker-foe',
        kit: hitKit(10),
        position: 'M4',
        speed: 500,
        attack: 1000,
        hp: 1e10,
        hacking: 1e6,
    };
    const { input, id } = boardInput(placement, carrier, [], [attacker, repairer], 1);
    const bus = createEventBus();
    const amounts: number[] = [];
    bus.on(
        'reactive-damage-performed',
        (e: Extract<CombatEvent, { type: 'reactive-damage-performed' }>) => {
            if (e.sourceId === id(carrier) && e.didCrit) amounts.push(e.amount);
        }
    );
    runCombat({ ...input, bus });
    return amounts[0] ?? 0;
};

describe.each<Placement>(['player', 'enemy'])('Synaptic Resonance on the %s side', (placement) => {
    it.each([
        ['counter-attack', counter],
        ['reactive damage proc', proc],
    ])('a %s is the next crit and spends the armed bonus', (_name, ability) => {
        const armed = retaliation(placement, ability, true, true);
        const baseline = retaliation(placement, ability, false, true);
        expect(baseline).toBeGreaterThan(0);
        expect(armed / baseline).toBeCloseTo(2.0 / 1.9, 9);
    });

    it('control: no enemy repair means nothing is armed', () => {
        const armed = retaliation(placement, counter, true, false);
        const baseline = retaliation(placement, counter, false, false);
        expect(armed).toBeGreaterThan(0);
        expect(armed).toBeCloseTo(baseline, 9);
    });
});
