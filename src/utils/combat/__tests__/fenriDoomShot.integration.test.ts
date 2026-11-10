/**
 * Fenri's Doom Shot reads the caster's HP when it casts:
 *
 *   "deals 400% damage and inflicts White Phosphorus III for 3 turns.
 *    When the Boss's HP drops below 66%, the damage increases by 50%.
 *    When the Boss's HP falls below 33%, White Phosphorus III duration increases to 4 turns."
 *
 * Owner ruling (#519): the +50% is outgoing damage, additive with Pressing Onslaught in the
 * outgoing channel; both thresholds are cast-time states, not crossings.
 *
 * Board: Fenri (real parsed kit, attack 10,000, no crit) opens with his charged skill against an
 * inert dummy with 5,000 defence. Pressing Onslaught is gained at the start of every round, so
 * the round-1 charged cast carries one stack (+10%) and the round-2 active carries two.
 * Fenri's starting HP is set before round 1; the dummy deals no damage, so it never moves.
 * Every case runs with Fenri on either side.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { boardInput, NO_KIT, type BoardUnit, type Placement } from '../__testutils__/realKitBoard';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { bossShip } from '../../../constants/bountyBosses';

beforeEach(() => setupKeyedRng(1));

const ATTACK = 10_000;
const DEFENCE = 5_000;
const DEFENCE_FACTOR = 1 - DEFENCE / (DEFENCE + 3_500);
const FENRI_MAX_HP = 1_000_000;

const fenri: BoardUnit = {
    id: 'fenri',
    kit: buildShipAbilities(bossShip('fenri', 32)!),
    position: 'M1',
    speed: 300,
    attack: ATTACK,
    hacking: 1e6,
    hp: FENRI_MAX_HP,
    startCharged: true,
    chargeCount: 99,
};
const dummy: BoardUnit = {
    id: 'dummy',
    kit: NO_KIT,
    position: 'M1',
    speed: 50,
    defence: DEFENCE,
    hp: 1e12,
};

type Performed = Extract<CombatEvent, { type: 'ability-performed' }>;
type Applied = Extract<CombatEvent, { type: 'dot-applied' }>;
type Ticked = Extract<CombatEvent, { type: 'dot-ticked' }>;

const fight = (placement: Placement, startHpFraction: number) => {
    const { input, id } = boardInput(placement, fenri, [], [dummy], 7);
    const fenriId = id(fenri);
    const bus = createEventBus();
    const hits: Performed[] = [];
    const applied: Applied[] = [];
    const ticks: Ticked[] = [];
    bus.on('ability-performed', (e: Performed) => {
        if (e.actorId === fenriId && e.abilityType === 'damage') hits.push(e);
    });
    bus.on('dot-applied', (e: Applied) => {
        if (e.sourceId === fenriId && e.tier === 45) applied.push(e);
    });
    bus.on('dot-ticked', (e: Ticked) => {
        if (e.tier === 45) ticks.push(e);
    });
    runCombat({
        ...input,
        bus,
        __testTapActors: (actors) => {
            for (const a of actors)
                if (a.id === fenriId) a.currentHp = a.stats.hp * startHpFraction;
        },
    });
    const hitIn = (round: number) => hits.find((h) => h.round === round)!;
    return {
        doomShot: hitIn(1),
        nextActive: hitIn(2),
        whitePhosphorusApplied: applied.length,
        whitePhosphorusTicks: ticks.length,
    };
};

describe.each<Placement>(['player', 'enemy'])(
    'Fenri Doom Shot thresholds (Fenri on %s side)',
    (side) => {
        it('at 70% HP: 400% damage with one Pressing Onslaught stack, no threshold bonus', () => {
            const { doomShot } = fight(side, 0.7);
            expect(doomShot.sourceSlot).toBe('charged');
            expect(doomShot.didCrit).toBe(false);
            expect(doomShot.damage).toBeCloseTo(4 * ATTACK * (1 + 0.1) * DEFENCE_FACTOR, 6);
        });

        it('below 66% HP: the +50% adds to Pressing Onslaught in the outgoing channel', () => {
            const above = fight(side, 0.7).doomShot.damage!;
            const below = fight(side, 0.6).doomShot.damage!;
            expect(below).toBeCloseTo(4 * ATTACK * (1 + 0.1 + 0.5) * DEFENCE_FACTOR, 6);
            expect(below / above).toBeCloseTo((1 + 0.5 + 0.1) / (1 + 0.1), 9);
        });

        it('below 66% HP: the active skill is not boosted', () => {
            expect(fight(side, 0.6).nextActive.damage).toBeCloseTo(
                fight(side, 0.7).nextActive.damage!,
                9
            );
        });

        it.each([
            [0.7, 3],
            [0.33, 3],
            [0.3299, 4],
            [0.3, 4],
        ])('at %s HP: one White Phosphorus III stack lasting %i turns', (hp, turns) => {
            const { whitePhosphorusApplied, whitePhosphorusTicks } = fight(side, hp);
            expect(whitePhosphorusApplied).toBe(1);
            expect(whitePhosphorusTicks).toBe(turns);
        });
    }
);
