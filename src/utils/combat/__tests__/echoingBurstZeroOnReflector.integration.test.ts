/**
 * An Echoing Burst never reflects (R120), and a burst that gathered nothing does nothing: Valkyrie's
 * burst on a Nosorog that took no direct hit while it ticked must not abort the battle.
 *
 * Real parsed kits (buildTraceShip, refit 4). Every case runs with Valkyrie on both sides.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { mirrorBoard, realSlots } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(7));

const SIDES = ['player', 'enemy'] as const;

describe.each(SIDES)(
    'Valkyrie on the %s side bursts an Echoing Burst that gathered nothing',
    (side) => {
        const run = () => {
            // Valkyrie casts her charged skill once (it inflicts the Echoing Burst) and has no
            // other damaging skill, so nothing lands on Nosorog while the Burst ticks.
            const { input } = mirrorBoard(
                {
                    caster: [
                        {
                            id: 'valk',
                            position: 'M4',
                            speed: 150,
                            attack: 1000,
                            hacking: 1e6,
                            chargeCount: 99,
                            startCharged: true,
                            skills: { slots: realSlots('Valkyrie', ['charged', 'passive']) },
                        },
                    ],
                    other: [
                        {
                            id: 'nosorog',
                            position: 'M4',
                            speed: 1,
                            attack: 1,
                            skills: { slots: realSlots('Nosorog', ['passive']) },
                        },
                    ],
                    numRounds: 4,
                },
                side
            );
            const bus = createEventBus();
            const bursts: number[] = [];
            bus.on('accumulator-detonated', (e) => bursts.push(e.damage));
            runCombat({ ...input, bus });
            return bursts;
        };

        it('does not throw, and the empty burst is 0', () => {
            const bursts = run();
            expect(bursts.length).toBeGreaterThan(0);
            expect(bursts.every((d) => d === 0)).toBe(true);
        });
    }
);
