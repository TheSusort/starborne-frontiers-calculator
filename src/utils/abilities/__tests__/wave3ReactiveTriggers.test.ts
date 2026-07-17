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

describe.skipIf(!csvAvailable())(
    'Task 3 — Harvester Speed Up I shares the on-ally-destroyed trigger (verbatim docs/ship-skills.csv)',
    () => {
        it('Harvester p2 — "When an allied Unit is destroyed, this Unit gains 1 extra end of round action and Speed Up I for 6 turns" co-triggers Speed Up I on on-ally-destroyed', () => {
            const rec = recordFor('Harvester');
            const s = ship({ secondPassiveSkillText: rec.passives[1] });
            const { slots } = buildShipAbilities(s);
            const passive = slot(slots, 'passive')!;
            const speedUp = passive.abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Speed Up I'
            );
            expect(speedUp).toBeDefined();
            expect(speedUp!.trigger).toBe('on-ally-destroyed');
        });
    }
);

describe.skipIf(!csvAvailable())(
    'Regression — Sokol Blast must stay on-cast despite a co-located extra-action kill phrase (verbatim docs/ship-skills.csv)',
    () => {
        it('Sokol p2 — "gains 1 stack of Blast every turn and grants one extra end of round action upon a kill, once per round" keeps Blast on-cast (accumulating, not gated behind a kill)', () => {
            const rec = recordFor('Sokol');
            const s = ship({ secondPassiveSkillText: rec.passives[1] });
            const { slots } = buildShipAbilities(s);
            const passive = slot(slots, 'passive')!;
            const blast = passive.abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Blast'
            );
            expect(blast).toBeDefined();
            expect(blast!.trigger).toBe('on-cast');
        });
    }
);
