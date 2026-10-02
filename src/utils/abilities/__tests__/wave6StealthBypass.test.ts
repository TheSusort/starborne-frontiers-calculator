import { describe, it, expect } from 'vitest';
import { parseIgnoresStealth, detectIgnoresStealth } from '../../skillTextParser';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';
import type { ParsedTarget } from '../../targetingParser';
import { resolvePositionalTarget } from '../../combat/positionalBinding';
import type { ActorTargetingStatus } from '../../combat/positionalBinding';
import type { CombatActor } from '../../combat/state';
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

describe.skipIf(!csvAvailable())('Wave 6 — a Stealth-ignoring ship targets through Stealth', () => {
    // The engine resolves an attack's target from two inputs: the ship-level flag
    // (`ShipSkills.ignoresStealth` → `acting.ignoresStealth`, battleSimulator) and the cast's own
    // target flag (`config.ignoresStealth` stamped onto the ParsedTarget). Both feed
    // `resolvePositionalTarget`'s Stealth filter, so the assertion goes through that function.
    const pos = (id: string, position: CombatActor['position']): CombatActor =>
        ({ id, position, currentHp: 100 }) as CombatActor;
    const enemies = [pos('e-front', 'M4'), pos('e-back', 'M1')];
    const stealthedFront = (id: string) =>
        id === 'e-front' ? ({ stealthed: true } as ActorTargetingStatus) : undefined;
    const front: ParsedTarget = { raw: 'enemy-front', side: 'enemy', selection: 'front' };

    const targetedId = (name: string, slot: 'active' | 'charged'): string => {
        const skills = buildShipAbilities(shipFromCsv(name));
        const perCast =
            skills.slots
                .find((s) => s.slot === slot)
                ?.abilities.some(
                    (a) => a.config.type === 'damage' && a.config.ignoresStealth === true
                ) ?? false;
        const target: ParsedTarget = perCast ? { ...front, ignoresStealth: true } : front;
        const acting = { ignoresStealth: skills.ignoresStealth };
        return resolvePositionalTarget('M4', target, enemies, stealthedFront, acting)?.id ?? '';
    };

    it('a ship without the bypass is steered off the Stealthed front actor', () => {
        // Instrument check: the same resolution lands on the visible back actor when no bypass
        // reaches it, so the e-front results below are not an artefact of the fixture.
        expect(resolvePositionalTarget('M4', front, enemies, stealthedFront, {})?.id).toBe(
            'e-back'
        );
    });

    it.each(['Rhodium', 'Selenite', 'Lodolite'])(
        '%s: both active and charged attacks target the Stealthed front actor',
        (name) => {
            expect(targetedId(name, 'active')).toBe('e-front');
            expect(targetedId(name, 'charged')).toBe('e-front');
        }
    );
});

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
    it('Lodolite, Rhodium and Selenite are all true', () => {
        expect(buildShipAbilities(shipFromCsv('Lodolite')).ignoresStealth).toBe(true);
        expect(buildShipAbilities(shipFromCsv('Rhodium')).ignoresStealth).toBe(true);
        expect(buildShipAbilities(shipFromCsv('Selenite')).ignoresStealth).toBe(true);
    });
});
