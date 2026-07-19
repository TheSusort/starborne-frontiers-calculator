import { describe, it, expect, beforeAll } from 'vitest';
import { tagShip } from '../classes';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { loadShipSkillRecords, csvAvailable } from '../../../../../scripts/lib/shipSkillCsv';
import type { Ship } from '../../../../types/ship';

// Real ships resolved from docs/ship-skills.csv (+ docs/ship-data.json where present) via
// buildTraceShip — the same loader the ship-kit audit corpus uses. buildTraceShip returns a
// full `Ship` (id/equipment/implants/refits included), unlike loadShipDataByName's raw
// `ShipData`, which buildShipAbilities cannot consume directly.
//
// Ship choices verified against docs/ship-skills.csv at authoring time:
// - Demolisher's charged skill ("detonates Bomb effects with 150% of their power") parses to a
//   `detonate-dot` ability (dotType: 'bomb') -> unambiguous detonation-bomb.
// - Bedrock's only skill text is "This Unit deals 90% damage." with null charge/passives -> a
//   plain attacker with no interaction primitives at all.
// - Crocus's charged skill "detonates Corrosion effects at 180% power" parses to a
//   `detonate-dot` ability with dotType 'corrosion', NOT 'bomb' -> must NOT be detonation-bomb.
// - Incinerator's charged skill "detonates Inferno effects with 180% of their power" parses to
//   a `detonate-dot` ability with dotType 'inferno', NOT 'bomb' -> must NOT be detonation-bomb.
// - Valkyrie's charged skill inflicts "Echoing Burst" (accumulate-detonate: accumulate damage
//   then detonate on expiry), which has no relationship to the Bomb DoT -> must NOT be
//   detonation-bomb either.

function requireCsv(): void {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing from this worktree (gitignored reference data) — ' +
                'tests need it to resolve real ship skill text.'
        );
    }
}

describe('tagShip', () => {
    beforeAll(() => {
        requireCsv();
    });

    it('tags a bomb/detonation ship as detonation-bomb', () => {
        const record = loadShipSkillRecords().find((r) => r.name === 'Demolisher');
        expect(record?.charge).toMatch(/detonates.*bomb/i);

        const ship = buildTraceShip('Demolisher');
        expect(ship).not.toBeNull();

        const tags = tagShip(ship as Ship);
        expect(tags.has('detonation-bomb')).toBe(true);
    });

    it('does NOT tag Crocus (detonates Corrosion, not Bomb) as detonation-bomb', () => {
        const record = loadShipSkillRecords().find((r) => r.name === 'Crocus');
        expect(record?.charge).toMatch(/detonates.*corrosion/i);

        const ship = buildTraceShip('Crocus');
        expect(ship).not.toBeNull();

        const tags = tagShip(ship as Ship);
        expect(tags.has('detonation-bomb')).toBe(false);
    });

    it('does NOT tag Incinerator (detonates Inferno, not Bomb) as detonation-bomb', () => {
        const record = loadShipSkillRecords().find((r) => r.name === 'Incinerator');
        expect(record?.charge).toMatch(/detonates.*inferno/i);

        const ship = buildTraceShip('Incinerator');
        expect(ship).not.toBeNull();

        const tags = tagShip(ship as Ship);
        expect(tags.has('detonation-bomb')).toBe(false);
    });

    it('does NOT tag Valkyrie (Echoing Burst accumulate-detonate, unrelated to Bomb) as detonation-bomb', () => {
        const record = loadShipSkillRecords().find((r) => r.name === 'Valkyrie');
        expect(record?.charge).toMatch(/echoing burst/i);

        const ship = buildTraceShip('Valkyrie');
        expect(ship).not.toBeNull();

        const tags = tagShip(ship as Ship);
        expect(tags.has('detonation-bomb')).toBe(false);
    });

    it('tags a plain attacker with only damage skills as an empty class set', () => {
        const record = loadShipSkillRecords().find((r) => r.name === 'Bedrock');
        expect(record?.active).toMatch(/deals.*damage/i);
        expect(record?.charge).toBeFalsy();
        expect(record?.passives.every((p) => !p)).toBe(true);

        const ship = buildTraceShip('Bedrock');
        expect(ship).not.toBeNull();

        const tags = tagShip(ship as Ship);
        expect(tags.size).toBe(0);
    });

    it('tags control, cleanse-purge, and stealth from Lodolite (ignoresStealth + purge + control)', () => {
        const ship = buildTraceShip('Lodolite');
        expect(ship).not.toBeNull();

        const tags = tagShip(ship as Ship);
        expect(tags.has('control')).toBe(true);
        expect(tags.has('cleanse-purge')).toBe(true);
        expect(tags.has('stealth')).toBe(true);
    });

    it('tags shield and cleanse-purge from AEGIS (shield grant + on-ally-shield-destroyed cleanse)', () => {
        const ship = buildTraceShip('AEGIS');
        expect(ship).not.toBeNull();

        const tags = tagShip(ship as Ship);
        expect(tags.has('shield')).toBe(true);
        expect(tags.has('cleanse-purge')).toBe(true);
        expect(tags.has('reactive-trigger')).toBe(true);
    });

    it('tags protection-redirect and reactive-trigger from Lionheart (Protection grant + on-crit rider)', () => {
        const ship = buildTraceShip('Lionheart');
        expect(ship).not.toBeNull();

        const tags = tagShip(ship as Ship);
        expect(tags.has('protection-redirect')).toBe(true);
        expect(tags.has('reactive-trigger')).toBe(true);
    });

    it('tags persistent-stacking from Enforcer (inflicts Defense Shred)', () => {
        const ship = buildTraceShip('Enforcer');
        expect(ship).not.toBeNull();

        const tags = tagShip(ship as Ship);
        expect(tags.has('persistent-stacking')).toBe(true);
    });
});
