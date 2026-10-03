/**
 * `ENEMY_SCOPE_PINS` overrides what a skill text says about an enemy status's reach. A pin is
 * only justified while the text still says something else: this fails when a pinned ship's text
 * (e.g. after a catalogue sync) already parses to the pinned target — the pin is then dead and
 * should go — and when the built kit stops carrying the pinned target.
 */
import { describe, it, expect } from 'vitest';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities, ENEMY_SCOPE_PINS } from '../buildShipAbilities';
import { getSkillRowForSlot } from '../../ship/skillRows';
import { detectEnemyGrantScope } from '../../skillTextParser';
import type { SkillSlot } from '../../../types/abilities';

describe.skipIf(!csvAvailable() || !shipDataAvailable())('enemy scope pins', () => {
    const pins = Object.entries(ENEMY_SCOPE_PINS).flatMap(([ship, slots]) =>
        Object.entries(slots).flatMap(([slot, names]) =>
            Object.entries(names ?? {}).map(([name, target]) => ({
                ship,
                slot: slot as SkillSlot,
                name,
                target,
            }))
        )
    );

    it('is non-empty', () => {
        expect(pins.length).toBeGreaterThan(0);
    });

    it.each(pins)(
        '$ship $slot $name: the text says otherwise, the kit carries the pin',
        ({ ship, slot, name, target }) => {
            const built = buildTraceShip(ship);
            if (!built) throw new Error(`${ship} missing from reference data`);
            const text = getSkillRowForSlot(built, slot)?.text ?? '';
            expect(detectEnemyGrantScope(text, name)).not.toBe(target);
            const carriers = (
                buildShipAbilities(built).slots.find((s) => s.slot === slot)?.abilities ?? []
            ).filter(
                (a) =>
                    (a.config.type === 'debuff' && a.config.buffName === name) ||
                    (a.config.type === 'control' &&
                        a.config.effect === name.toLowerCase().replace(/\s+/g, '-'))
            );
            expect(carriers.length).toBeGreaterThan(0);
            expect(carriers.map((a) => a.target)).toEqual(carriers.map(() => target));
        }
    );
});
