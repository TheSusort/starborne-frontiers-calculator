/**
 * A passive self-buff that rides a multi-hit cast (`TimedStatus.perHit`) is listed in the round's
 * active self-buffs whichever hit earns it, not only when the first hit does.
 *
 * Rys's real passive (XAOC Swiftness II when damaging a debuffer or supporter) rides a SYNTHETIC
 * 3-hit active; the front enemy dies on the first hit, so the second hit onwards strikes the
 * enemy behind it.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import type { ShipSkills } from '../../../types/abilities';
import type { ShipTypeName } from '../../../constants/shipTypes';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { boardInput, hitKit, NO_KIT, realKit, type BoardUnit } from '../__testutils__/realKitBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(7));

const SWIFTNESS = 'XAOC Swiftness II';

const rysKit = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: hitKit(150, 3).slots[0].abilities },
        ...realKit('Rys').slots.filter((s) => s.slot === 'passive'),
    ],
});

/** Round-1 active self-buff names of the focus Rys. Her 3-hit active strikes the front enemy
 *  first; its 1 hp is gone after hit 0, so hits 1 and 2 fall to the enemy behind it. `roles` is
 *  [front, back], which decides which hit qualifies. */
const activeBuffNames = (roles: [ShipTypeName, ShipTypeName]): string[] => {
    const rys: BoardUnit = {
        id: 'rys',
        kit: rysKit(),
        position: 'M4',
        speed: 300,
        attack: 1e6,
        hp: 1e9,
    };
    const foes: BoardUnit[] = [
        { id: 'front', kit: NO_KIT, position: 'M4', speed: 1, hp: 1 },
        { id: 'back', kit: NO_KIT, position: 'M3', speed: 1, hp: 1e12 },
    ];
    const { input } = boardInput('player', rys, [], foes, 1);
    input.enemyAttackers.find((a) => a.id === 'front')!.role = roles[0];
    input.enemyAttackers.find((a) => a.id === 'back')!.role = roles[1];
    const result = runCombat(input);
    return result.rounds[0].activeSelfBuffs.map((b) => b.buffName);
};

describe('a perHit passive self-buff earned by a later hit', () => {
    it('CONTROL: the first hit qualifying lists the buff', () => {
        expect(activeBuffNames(['DEBUFFER', 'DEFENDER'])).toContain(SWIFTNESS);
    });

    it('CONTROL: no hit qualifying lists nothing', () => {
        expect(activeBuffNames(['DEFENDER', 'DEFENDER'])).not.toContain(SWIFTNESS);
    });

    it('only hit 2 qualifying still lists the buff in that round', () => {
        expect(activeBuffNames(['DEFENDER', 'DEBUFFER'])).toContain(SWIFTNESS);
    });
});
