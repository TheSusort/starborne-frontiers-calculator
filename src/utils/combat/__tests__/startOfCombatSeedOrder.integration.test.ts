/**
 * Combat-start passive statuses are granted in TURN ORDER across both sides (fastest owner first,
 * then board position, then the player side on a cross-team tie), whichever side an owner stands
 * on. Real kits: Tycho (Everliving Regeneration) and IonScorp (Atlas Coordination).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { boardInput, realKit, type BoardUnit, type Placement } from '../__testutils__/realKitBoard';

beforeEach(() => setupKeyedRng(5));

/** Granters of every buff applied before the first turn opens, in emission order. */
const combatStartGranters = (placement: Placement, tychoSpeed: number, ionSpeed: number) => {
    const tycho: BoardUnit = {
        id: 'tycho',
        kit: realKit('Tycho'),
        position: 'B1',
        speed: tychoSpeed,
        hp: 1e9,
    };
    const ion: BoardUnit = {
        id: 'ion',
        kit: realKit('IonScorp'),
        position: 'B3',
        speed: ionSpeed,
        hp: 1e9,
    };
    const { input, id } = boardInput(placement, tycho, [], [ion], 1);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('buff-applied', (e) => events.push(e as CombatEvent));
    bus.on('turn-started', (e) => events.push(e as CombatEvent));
    runCombat({ ...input, bus });
    const granters: string[] = [];
    for (const e of events) {
        if (e.type === 'turn-started') break;
        if (e.type === 'buff-applied' && e.granterId !== undefined) granters.push(e.granterId);
    }
    return { granters, tychoId: id(tycho), ionId: id(ion) };
};

describe('combat-start passive statuses resolve in turn order', () => {
    for (const placement of ['player', 'enemy'] as const) {
        it(`Tycho on the ${placement} side: the faster IonScorp is granted first`, () => {
            const { granters, tychoId, ionId } = combatStartGranters(placement, 106, 158);
            expect(granters).toContain(tychoId);
            expect(granters).toContain(ionId);
            expect(granters.indexOf(ionId)).toBeLessThan(granters.indexOf(tychoId));
        });
        it(`Tycho on the ${placement} side: control, the faster Tycho is granted first`, () => {
            const { granters, tychoId, ionId } = combatStartGranters(placement, 200, 158);
            expect(granters.indexOf(tychoId)).toBeLessThan(granters.indexOf(ionId));
        });
    }
});
