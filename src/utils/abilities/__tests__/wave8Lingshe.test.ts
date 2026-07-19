import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';

// Build a full-refit Ship carrying a CSV record's texts (Wave 8 convention — copied per-file to
// avoid a cross-wave test dependency, see wave8Wusheng.test.ts).
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

describe.skipIf(!csvAvailable())(
    'Wave 8 Task 14 — Lingshe crit-power detonation-damage scaling',
    () => {
        // Lingshe's refit-active (R4) third_passive_skill_text: "This Unit deals 1% more
        // detonation damage per 10% crit power it has." (the R2 second_passive_skill_text carries
        // the "per 20%" variant, but only the refit-active passive applies in-game — resolved via
        // getShipSkillRows(), consistent with docs/ship-skills.csv's convention).
        it('emits a detonationDamage modifier scaling 1% per 10% crit power (perUnit 0.1)', () => {
            const { slots } = buildShipAbilities(shipFromCsv('Lingshe'));
            const abilities = slots.flatMap((s) => s.abilities);
            const mod = abilities.find(
                (a) => a.config.type === 'modifier' && a.config.channel === 'detonationDamage'
            );
            expect(mod).toBeDefined();
            if (mod?.config.type !== 'modifier') throw new Error('unreachable');
            expect(mod.config.value).toBe(0);
            expect(mod.target).toBe('self');
            expect(mod.conditions).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ subject: 'self-crit-power', derivable: true }),
                ])
            );
            expect(mod.scaling).toEqual(
                expect.objectContaining({ conditionIndex: 0, perUnit: 0.1 })
            );
        });

        it('regression: Wildfire dotDamage crit-power modifier is unaffected by the new clause', () => {
            const { slots } = buildShipAbilities(shipFromCsv('Wildfire'));
            const abilities = slots.flatMap((s) => s.abilities);
            const dotMod = abilities.find(
                (a) => a.config.type === 'modifier' && a.config.channel === 'dotDamage'
            );
            expect(dotMod).toBeDefined();
            const detMod = abilities.find(
                (a) => a.config.type === 'modifier' && a.config.channel === 'detonationDamage'
            );
            expect(detMod).toBeUndefined();
        });
    }
);
