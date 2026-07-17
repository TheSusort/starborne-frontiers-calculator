import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability, Skill } from '../../../types/abilities';
import {
    csvAvailable,
    loadShipSkillRecords,
    ShipSkillRecord,
} from '../../../../scripts/lib/shipSkillCsv';

/**
 * Regression tests for Task B (ship-kit correctness audit, Wave 2): four HIGH-severity
 * WRONG-PARSE findings in target/clause resolution. Each test runs the ship's VERBATIM
 * docs/ship-skills.csv slot text through the production `buildShipAbilities` build (not an
 * isolated-clause parser call) so the bug is only visible at the full multi-sentence level.
 * Skips gracefully when the gitignored reference CSV is absent (clean checkout / CI).
 */

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

function slot(skills: Skill[], name: string): Skill | undefined {
    return skills.find((s) => s.slot === name);
}

function abilitiesOfType(abilities: Ability[], type: string): Ability[] {
    return abilities.filter((a) => a.type === type);
}

function recordFor(name: string): ShipSkillRecord {
    const rec = loadShipSkillRecords().find((r) => r.name.toUpperCase() === name.toUpperCase());
    if (!rec) throw new Error(`docs/ship-skills.csv: no record found for "${name}"`);
    return rec;
}

describe.skipIf(!csvAvailable())(
    'Task B — parser target/clause-resolution fixes (verbatim docs/ship-skills.csv)',
    () => {
        it('B1: Quixilver passive — the "if it has shield equal to 100% of its max HP" CONDITION does not fabricate a phantom shield-grant ability', () => {
            const rec = recordFor('Quixilver');
            // Second passive (R2) carries the phantom clause; third is null so R2 applies
            // even at the default refits:4 fixture, but pin it explicitly for clarity.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const s = ship({ refits: [{}, {}] as any, secondPassiveSkillText: rec.passives[1] });
            const { slots } = buildShipAbilities(s);
            const passive = slot(slots, 'passive');
            expect(passive).toBeDefined();

            const phantomShield = abilitiesOfType(passive!.abilities, 'shield').find(
                (a) => a.config.type === 'shield' && a.config.pct === 100
            );
            expect(phantomShield).toBeUndefined();
        });

        it('B2: Rikra passive (R2) — "repairs 60% of its Max HP ... upon killing them" self-heal targets self, not ally', () => {
            const rec = recordFor('Rikra');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const s = ship({ refits: [{}, {}] as any, secondPassiveSkillText: rec.passives[1] });
            const { slots } = buildShipAbilities(s);
            const passive = slot(slots, 'passive');
            expect(passive).toBeDefined();

            const heal = abilitiesOfType(passive!.abilities, 'heal')[0];
            expect(heal).toBeDefined();
            expect(heal.target).toBe('self');
        });
    }
);
