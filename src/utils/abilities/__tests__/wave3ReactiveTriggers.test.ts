import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Skill } from '../../../types/abilities';
import {
    csvAvailable,
    loadShipSkillRecords,
    ShipSkillRecord,
} from '../../../../scripts/lib/shipSkillCsv';

/**
 * Regression tests for the ship-kit correctness audit, Wave 3: reactive-trigger cascade and
 * target-scope fixes. Each test runs the ship's VERBATIM docs/ship-skills.csv slot text through
 * the production `buildShipAbilities` build (not an isolated-clause parser call) so the bug is
 * only visible at the full multi-sentence level. Skips gracefully when the gitignored reference
 * CSV is absent (clean checkout / CI).
 */

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

function slot(skills: Skill[], name: string): Skill | undefined {
    return skills.find((s) => s.slot === name);
}

function recordFor(name: string): ShipSkillRecord {
    const rec = loadShipSkillRecords().find((r) => r.name.toUpperCase() === name.toUpperCase());
    if (!rec) throw new Error(`docs/ship-skills.csv: no record found for "${name}"`);
    return rec;
}

describe.skipIf(!csvAvailable())(
    'Task 1 — Amartya active all-enemies debuff target scope (verbatim docs/ship-skills.csv)',
    () => {
        it('Amartya active — Defense Down II & Inc. Repair Down II apply to all-enemies', () => {
            const rec = recordFor('Amartya');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const s = ship({ refits: [{}, {}] as any, activeSkillText: rec.active });
            const { slots } = buildShipAbilities(s);
            const active = slot(slots, 'active')!;
            const debuffs = active.abilities.filter(
                (a) =>
                    a.config.type === 'debuff' &&
                    ['Defense Down II', 'Inc. Repair Down II'].includes(a.config.buffName)
            );
            expect(debuffs).toHaveLength(2);
            for (const d of debuffs) expect(d.target).toBe('all-enemies');
        });
    }
);

describe.skipIf(!csvAvailable())(
    'Task 2 — Meiying recurring Stealth uses start-of-turn trigger (verbatim docs/ship-skills.csv)',
    () => {
        it('Meiying p2 — "At the start of combat and every turn, this Unit gains Stealth for 2 turns" is start-of-turn', () => {
            const rec = recordFor('Meiying');
            const s = ship({ secondPassiveSkillText: rec.passives[1] });
            const { slots } = buildShipAbilities(s);
            const passive = slot(slots, 'passive')!;
            const stealth = passive.abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Stealth'
            );
            expect(stealth).toBeDefined();
            expect(stealth!.trigger).toBe('start-of-turn');
        });
    }
);
