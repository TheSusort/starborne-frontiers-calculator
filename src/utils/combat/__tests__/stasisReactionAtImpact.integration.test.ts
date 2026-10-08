/**
 * A Stasised ship's own reactions are off (every passive is disabled under Stasis/Disable), and a
 * hit lowers Stasis by one (R40/R67). Two timings decide whether the victim reacts to a given hit:
 *
 *  - AT IMPACT. A hit that lands while the victim is stasised draws no reaction, even when that
 *    hit takes the Stasis to 0 (R79). A hit that lands AFTER the Stasis is gone draws one, even
 *    inside the same chain of reactions: Medved's 2-turn Stasis on Warden, Provider's reactive hit
 *    takes it to 1, Nayra's hit takes it to 0 (Warden silent), and Provider's reactive hit
 *    answering Nayra's debuffs then lands on a Warden with no Stasis, so Warden reacts to it.
 *  - AT RESOLUTION. "deals X and inflicts Stasis" (Razi's charged, R152): the hit lands first, but
 *    the Stasis lands before the victim's reaction would resolve, so the victim does not react.
 *
 * Warden: "When directly damaged, this Unit inflicts Corrosion I for 2 turns to the enemy and
 * repairs 3%". Real parsed kits (buildTraceShip, refit 4). Every scenario runs with Warden on the
 * player side and mirrored onto the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { boardInput, realKit, type BoardUnit, type Placement } from '../__testutils__/realKitBoard';
import type { ShipSkills } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(7));

const slots = (ship: string, keep: ('active' | 'charged' | 'passive')[]): ShipSkills => {
    const kit = realKit(ship);
    return { ...kit, slots: kit.slots.filter((s) => keep.includes(s.slot)) };
};
const passiveOnly = (ship: string): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [] }, ...slots(ship, ['passive']).slots],
});

const warden = (): BoardUnit => ({
    id: 'warden',
    kit: passiveOnly('Warden'),
    position: 'M4',
    speed: 1,
    hacking: 1e6,
});
const hitter = (id: string, kit: ShipSkills, speed: number, startCharged = false): BoardUnit => ({
    id,
    kit,
    position: 'M4',
    speed,
    attack: 100,
    hacking: 1e6,
    chargeCount: startCharged ? 2 : 0,
    startCharged,
});

/** Round 1: whom Warden's Corrosion I landed on, in order. */
const wardenAnswers = (placement: Placement, opponents: BoardUnit[]): string[] => {
    const w = warden();
    const { input, id } = boardInput(placement, w, [], opponents, 1);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('dot-applied', (e) => events.push(e));
    runCombat({ ...input, bus });
    const name = new Map(opponents.map((o) => [id(o), o.id]));
    return events
        .filter(
            (e): e is Extract<CombatEvent, { type: 'dot-applied' }> =>
                e.type === 'dot-applied' && e.sourceId === id(w) && e.round === 1
        )
        .map((e) => name.get(e.targetId) ?? e.targetId);
};

describe.each<Placement>(['player', 'enemy'])('Warden on the %s side', (placement) => {
    it('reacts to a hit that lands after the Stasis broke, in the same chain', () => {
        const medved = hitter('medved', slots('Medved', ['charged']), 400, true);
        const nayra = hitter('nayra', slots('Nayra', ['active']), 300);
        const provider = hitter('provider', passiveOnly('Provider'), 50);
        expect(wardenAnswers(placement, [medved, nayra, provider])).toEqual(['provider']);
    });

    it('control: without Provider, Nayra only takes the Stasis 2 → 1 and Warden stays silent', () => {
        const medved = hitter('medved', slots('Medved', ['charged']), 400, true);
        const nayra = hitter('nayra', slots('Nayra', ['active']), 300);
        expect(wardenAnswers(placement, [medved, nayra])).toEqual([]);
    });

    it("R152: Razi's 'deals 115% and inflicts Stasis' draws no reaction to its own hit", () => {
        const razi = hitter('razi', slots('Razi', ['charged']), 400, true);
        expect(wardenAnswers(placement, [razi])).toEqual([]);
    });

    it("control: Razi's plain active (no Stasis) draws Warden's reaction", () => {
        const razi = hitter('razi', slots('Razi', ['active']), 400);
        expect(wardenAnswers(placement, [razi])).toEqual(['razi']);
    });
});
