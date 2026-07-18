import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability, Skill } from '../../../types/abilities';
import { parseNoCrit, parseIgnoresDefense } from '../../skillTextParser';
import {
    csvAvailable,
    loadShipSkillRecords,
    ShipSkillRecord,
} from '../../../../scripts/lib/shipSkillCsv';

/**
 * Regression tests for Task C1 (ship-kit correctness audit, Wave 5): parser routing for
 * Demolisher's R2 passive bomb-splash damage (adjacent-enemies target, on-bomb-detonated
 * trigger, ignoresDefense + noCrit flags). PARSER-LAYER ONLY — the reactive execution
 * (Tasks C2/C3) is not wired yet. Skips gracefully when the gitignored reference CSV is
 * absent (clean checkout / CI).
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
    'Task C1 — Demolisher bomb-splash parser routing (verbatim docs/ship-skills.csv)',
    () => {
        it('routes the R2 passive 100% splash to on-bomb-detonated / adjacent-enemies / ignoresDefense+noCrit', () => {
            const rec = recordFor('Demolisher');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const s = ship({ refits: [{}, {}] as any, secondPassiveSkillText: rec.passives[1] });
            const { slots } = buildShipAbilities(s);
            const passive = slot(slots, 'passive');
            expect(passive).toBeDefined();

            const splash = abilitiesOfType(passive!.abilities, 'damage').find(
                (a) => a.config.type === 'damage' && a.config.multiplier === 100
            );
            expect(splash).toBeDefined();
            expect(splash?.trigger).toBe('on-bomb-detonated');
            expect(splash?.target).toBe('adjacent-enemies');
            expect(splash?.config.type === 'damage' && splash.config.ignoresDefense).toBe(true);
            expect(splash?.config.type === 'damage' && splash.config.noCrit).toBe(true);
        });

        it('leaves the active 170% damage as on-cast / enemy / can-crit (no ignoresDefense/noCrit)', () => {
            const rec = recordFor('Demolisher');
            const s = ship({ activeSkillText: rec.active });
            const { slots } = buildShipAbilities(s);
            const active = slot(slots, 'active');
            expect(active).toBeDefined();

            const hit = abilitiesOfType(active!.abilities, 'damage').find(
                (a) => a.config.type === 'damage' && a.config.multiplier === 170
            );
            expect(hit).toBeDefined();
            expect(hit?.trigger).toBe('on-cast');
            expect(hit?.target).toBe('enemy');
            expect(hit?.config.type === 'damage' && hit.config.ignoresDefense).toBeFalsy();
            expect(hit?.config.type === 'damage' && hit.config.noCrit).toBeFalsy();
        });

        it('leaves the charged 240% damage as on-cast / enemy', () => {
            const rec = recordFor('Demolisher');
            const s = ship({ chargeSkillText: rec.charge, chargeSkillCharge: rec.chargeCharge });
            const { slots } = buildShipAbilities(s);
            const charged = slot(slots, 'charged');
            expect(charged).toBeDefined();

            const hit = abilitiesOfType(charged!.abilities, 'damage').find(
                (a) => a.config.type === 'damage' && a.config.multiplier === 240
            );
            expect(hit).toBeDefined();
            expect(hit?.trigger).toBe('on-cast');
            expect(hit?.target).toBe('enemy');
        });
    }
);

describe('Task C1 — parseIgnoresDefense / extended parseNoCrit (synthetic)', () => {
    it('parseIgnoresDefense detects "ignores Defense"', () => {
        expect(
            parseIgnoresDefense('This damage ignores Defense and cannot result in a critical hit.')
        ).toBe(true);
    });

    it('parseIgnoresDefense is false when absent', () => {
        expect(parseIgnoresDefense('This Unit deals 170% damage.')).toBe(false);
    });

    it('parseNoCrit recognizes "cannot result in a critical hit" (Demolisher form)', () => {
        expect(
            parseNoCrit('This damage ignores Defense and cannot result in a critical hit.')
        ).toBe(true);
    });

    it('parseNoCrit still recognizes the original "cannot critically hit" form', () => {
        expect(parseNoCrit('This attack cannot critically hit.')).toBe(true);
    });

    it('parseNoCrit still excludes heal/repair subjects', () => {
        expect(parseNoCrit('This repair cannot critically hit.')).toBe(false);
    });
});
