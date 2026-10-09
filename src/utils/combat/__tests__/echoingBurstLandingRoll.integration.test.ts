/**
 * An Echoing Burst a skill inflicts rolls hacking against security like any other inflicted debuff,
 * drawing its own roll (as a second named debuff in the same cast does). A resisted burst emits a
 * landing-roll `debuff-resisted` (so on-resist reactions see it) and shows in the round's
 * resisted-debuffs list. Valkyrie's charged carries no DoT clause, so the burst has no DoT roll to
 * ride.
 *
 * Real parsed kit (buildTraceShip, refit 4), Valkyrie on both sides.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { realSlots, mirrorBoard, ShipSpec } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});
beforeEach(() => setupKeyedRng(7));

const SIDES = ['player', 'enemy'] as const;

const valkyrie = (charged: boolean): ShipSpec => ({
    id: 'valk',
    position: 'M4',
    speed: 150,
    attack: 1000,
    hacking: 100,
    chargeCount: 2,
    startCharged: charged,
    skills: { slots: realSlots('Valkyrie', ['active', 'charged']) },
});

const run = (charged: boolean, security: number, side: 'player' | 'enemy') => {
    const { input, idOf } = mirrorBoard(
        {
            caster: [valkyrie(charged)],
            other: [{ id: 'holder', position: 'M4', speed: 1, security }],
        },
        side
    );
    const holder = idOf('holder');
    const bus = createEventBus();
    const applied: string[] = [];
    const resisted: { buffName: string; viaLandingRoll?: boolean }[] = [];
    bus.on('debuff-applied', (e) => {
        if (e.targetId === holder) applied.push(e.buffName);
    });
    bus.on('debuff-resisted', (e) => {
        if (e.targetId === holder)
            resisted.push({ buffName: e.buffName, viaLandingRoll: e.viaLandingRoll });
    });
    const result = runCombat({ ...input, bus });
    return { applied, resisted, result };
};

describe('Valkyrie’s charged Echoing Burst rolls to land', () => {
    for (const side of SIDES) {
        it(`${side}-side: against high security the burst is resisted by the landing roll`, () => {
            const { applied, resisted } = run(true, 1e6, side);
            expect(applied).not.toContain('Echoing Burst');
            expect(resisted).toContainEqual({ buffName: 'Echoing Burst', viaLandingRoll: true });
            // Its sibling named debuff is resisted by the same security.
            expect(resisted.map((r) => r.buffName)).toContain('Inc. Damage Up II');
        });

        it(`${side}-side control: against zero security the burst lands and nothing resists`, () => {
            const { applied, resisted } = run(true, 0, side);
            expect(applied).toContain('Echoing Burst');
            expect(resisted).toHaveLength(0);
        });

        it(`${side}-side control: the active has no burst to resist`, () => {
            const { resisted } = run(false, 1e6, side);
            expect(resisted.map((r) => r.buffName)).not.toContain('Echoing Burst');
        });
    }

    it('player-side: the resisted burst is in the round’s resisted-debuffs list; a landed one is not', () => {
        const names = (security: number) =>
            run(true, security, 'player').result.rounds[0].resistedEnemyDebuffs.map(
                (d) => d.buffName
            );
        expect(names(1e6)).toContain('Echoing Burst');
        expect(names(0)).not.toContain('Echoing Burst');
    });
});
