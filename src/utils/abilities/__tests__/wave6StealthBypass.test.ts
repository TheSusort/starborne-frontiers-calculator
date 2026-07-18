import { describe, it, expect } from 'vitest';
import { parseIgnoresStealth, detectIgnoresStealth } from '../../skillTextParser';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';

// Build a full-refit Ship carrying a CSV record's texts (mirrors wave5DemolisherParse.test.ts).
// 4 refits → getShipSkillRows returns the highest refit-active passive; both Lodolite passives
// carry the clause so any refit-active variant is fine.
function shipFromCsv(name: string): Ship {
    const rec = loadShipSkillRecords().find((r) => r.name.toUpperCase() === name.toUpperCase());
    if (!rec) throw new Error(`docs/ship-skills.csv: no record for "${name}"`);
    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}],
        activeSkillText: rec.active,
        chargeSkillText: rec.charge,
        chargeSkillCharge: rec.chargeCharge,
        firstPassiveSkillText: rec.passives[0],
        secondPassiveSkillText: rec.passives[1],
        thirdPassiveSkillText: rec.passives[2],
    } as Ship;
}

describe('Wave 6 — parseIgnoresStealth (per-attack clause)', () => {
    it('matches the per-attack stealth-targeting clause', () => {
        expect(parseIgnoresStealth('This attack can target Stealthed enemies.')).toBe(true);
        expect(
            parseIgnoresStealth(
                'This Unit deals 170% damage.<br />This attack can target <unit-aid>Stealthed</unit-aid> enemies.'
            )
        ).toBe(true);
    });
    it('does NOT match the ship-wide passive phrasing or unrelated Stealth text', () => {
        expect(parseIgnoresStealth('This Unit ignores Stealth effects.')).toBe(false);
        expect(parseIgnoresStealth('This Unit gains Stealth for 2 turns.')).toBe(false);
        expect(parseIgnoresStealth('This Unit deals 200% damage.')).toBe(false);
    });
});

describe.skipIf(!csvAvailable())(
    'Wave 6 — config.ignoresStealth on built abilities (per slot)',
    () => {
        const damageWithBypass = (name: string, slot: 'active' | 'charged') =>
            buildShipAbilities(shipFromCsv(name))
                .slots.find((s) => s.slot === slot)
                ?.abilities.some(
                    (a) => a.config.type === 'damage' && a.config.ignoresStealth === true
                ) ?? false;

        it('Rhodium: charged bypasses, active does not', () => {
            expect(damageWithBypass('Rhodium', 'charged')).toBe(true);
            expect(damageWithBypass('Rhodium', 'active')).toBe(false);
        });
        it('Selenite: charged bypasses, active does not', () => {
            expect(damageWithBypass('Selenite', 'charged')).toBe(true);
            expect(damageWithBypass('Selenite', 'active')).toBe(false);
        });
        it('Lodolite: both active and charged bypass', () => {
            expect(damageWithBypass('Lodolite', 'active')).toBe(true);
            expect(damageWithBypass('Lodolite', 'charged')).toBe(true);
        });
    }
);

describe('Wave 6 — detectIgnoresStealth (ship-wide passive)', () => {
    it('matches "This Unit ignores Stealth effects"', () => {
        expect(
            detectIgnoresStealth('This Unit ignores <unit-skill>Stealth</unit-skill> effects.')
        ).toBe(true);
    });
    it('does NOT match the per-attack clause or a Stealth grant', () => {
        expect(detectIgnoresStealth('This attack can target Stealthed enemies.')).toBe(false);
        expect(detectIgnoresStealth('This Unit gains Stealth for 2 turns.')).toBe(false);
        expect(detectIgnoresStealth(null, undefined)).toBe(false);
    });
});

describe.skipIf(!csvAvailable())('Wave 6 — ShipSkills.ignoresStealth', () => {
    it('Lodolite is true; Rhodium and Selenite are undefined', () => {
        expect(buildShipAbilities(shipFromCsv('Lodolite')).ignoresStealth).toBe(true);
        expect(buildShipAbilities(shipFromCsv('Rhodium')).ignoresStealth).toBeUndefined();
        expect(buildShipAbilities(shipFromCsv('Selenite')).ignoresStealth).toBeUndefined();
    });
});
