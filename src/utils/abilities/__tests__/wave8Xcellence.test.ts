import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';

// Build a full-refit Ship carrying a CSV record's texts (mirrors wave6StealthBypass.test.ts's
// shipFromCsv helper, copied per the Wave 8 Task 7 brief so this file has no cross-wave
// test-file dependency).
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

// Xcellence's active skill (docs/ship-skills.csv): "This Unit Deals <unit-damage>150%
// damage</unit-damage> and Inflicts <unit-skill>Speed Down II</unit-skill> for 2 turns and
// Stasis for 2 turn." — "Stasis" is a BARE word (no <unit-skill> wrapper), unlike Speed Down II.
// Wave 8 Task 7: the parser previously required the <unit-skill> tag to recognise a Stasis
// inflict, so this untagged mention was silently dropped (150% damage + Speed Down II parsed;
// Stasis did not). Duration text is "for 2 turn" (singular typo) — must still parse to 2.
describe.skipIf(!csvAvailable())('Wave 8 Task 7 — Xcellence active untagged Stasis inflict', () => {
    it('active emits 150% damage, Speed Down II, and a bare Stasis debuff (duration 2)', () => {
        const abilities = buildShipAbilities(shipFromCsv('Xcellence'));
        const active = abilities.slots.find((s) => s.slot === 'active')?.abilities ?? [];

        const damage = active.find((a) => a.config.type === 'damage');
        expect(damage).toBeDefined();
        expect(damage?.config.type === 'damage' && damage.config.multiplier).toBe(150);

        const speedDown = active.find(
            (a) => a.config.type === 'debuff' && a.config.buffName === 'Speed Down II'
        );
        expect(speedDown).toBeDefined();
        expect(speedDown?.config.type === 'debuff' && speedDown.config.duration).toBe(2);

        const stasis = active.find(
            (a) => a.config.type === 'debuff' && a.config.buffName === 'Stasis'
        );
        expect(stasis).toBeDefined();
        expect(stasis?.config.type === 'debuff' && stasis.config.duration).toBe(2);
        expect(stasis?.target).toBe('enemy');
    });
});
