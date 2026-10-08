/**
 * Makoli (refit 2+): "When directly damaged while below 40% HP this Unit repairs 20% of its max HP
 * and inflicts Disable for 1 turn." The HP gate is read once, at the hit, for the whole reaction:
 * the repair that the same reaction makes must not lift her above 40% before the Disable half is
 * judged.
 *
 * Real parsed kit (buildTraceShip, refit 4). Every scenario runs with Makoli on the player side and
 * mirrored onto the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import {
    boardInput,
    hitKit,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(7));

const makoliPassive = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        ...realKit('Makoli').slots.filter((s) => s.slot === 'passive'),
    ],
});

const run = (placement: Placement, startHp: number) => {
    const makoli: BoardUnit = {
        id: 'makoli',
        kit: makoliPassive(),
        position: 'M4',
        speed: 1,
        hp: 100_000,
        hacking: 1e6,
    };
    const hitter: BoardUnit = {
        id: 'hitter',
        kit: hitKit(),
        position: 'M4',
        speed: 100,
        attack: 500,
    };
    const { input, id } = boardInput(placement, makoli, [], [hitter], 1);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const emit = bus.emit;
    bus.emit = (e) => {
        events.push(e);
        emit(e);
    };
    runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            const m = all.find((a) => a.id === id(makoli));
            if (!m) throw new Error('makoli missing');
            m.currentHp = startHp;
        },
    });
    const m = id(makoli);
    return {
        repairs: events.filter((e) => e.type === 'reactive-heal-performed' && e.casterId === m)
            .length,
        disables: events.filter(
            (e) =>
                e.type === 'debuff-applied' &&
                e.sourceId === m &&
                e.targetId === id(hitter) &&
                e.buffName === 'Disable'
        ).length,
    };
};

describe.each<Placement>(['player', 'enemy'])('Makoli on the %s side', (placement) => {
    it('hit below 40% HP: she repairs AND inflicts Disable', () => {
        expect(run(placement, 38_000)).toEqual({ repairs: 1, disables: 1 });
    });

    it('control: hit at 80% HP, neither half fires', () => {
        expect(run(placement, 80_000)).toEqual({ repairs: 0, disables: 0 });
    });
});
