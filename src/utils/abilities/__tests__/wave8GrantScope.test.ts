import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';

// Build a full-refit Ship carrying a CSV record's texts (mirrors wave6StealthBypass.test.ts's
// shipFromCsv helper — copied here per the Wave 8 Task 1 brief so this file has no cross-wave
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

describe.skipIf(!csvAvailable())('Wave 8 Task 1 — detectGrantScope adjacent-allies branch', () => {
    it('Lionheart active: Attack Up II targets adjacent-allies, trigger on-crit', () => {
        const abilities = buildShipAbilities(shipFromCsv('Lionheart'));
        const ability = abilities.slots
            .flatMap((s) => s.abilities)
            .find((a) => a.config.type === 'buff' && a.config.buffName === 'Attack Up II');
        expect(ability?.target).toBe('adjacent-allies');
        expect(ability?.trigger).toBe('on-crit');
    });

    it('Lionheart charge: Attack Up III targets adjacent-allies, trigger on-crit', () => {
        const abilities = buildShipAbilities(shipFromCsv('Lionheart'));
        const ability = abilities.slots
            .flatMap((s) => s.abilities)
            .find((a) => a.config.type === 'buff' && a.config.buffName === 'Attack Up III');
        expect(ability?.target).toBe('adjacent-allies');
        expect(ability?.trigger).toBe('on-crit');
    });

    // Regression guard: a plain all-allies grant (no "adjacent") must STILL resolve to
    // all-allies — the new branch must not widen beyond the "adjacent allies" phrasing.
    // Chimei charge: "…and grants Rogue's Liberty for 2 turns to all allies."
    it("Chimei charge: Rogue's Liberty (plain all-allies grant) still targets all-allies", () => {
        const abilities = buildShipAbilities(shipFromCsv('Chimei'));
        const ability = abilities.slots
            .flatMap((s) => s.abilities)
            .find((a) => a.config.type === 'buff' && a.config.buffName === "Rogue's Liberty");
        expect(ability?.target).toBe('all-allies');
    });
});

describe.skipIf(!csvAvailable())(
    'Wave 8 Task 2 — Centurion dual-scope Core Charge I grant (occurrence-aware detectGrantScope)',
    () => {
        // Centurion charge: "This Unit gains 4 stacks of Core Charge I and grants all adjacent
        // allies 2 stacks of Core Charge I then deals …" — the SAME buff name is granted TWICE
        // in one clause, to two DIFFERENT scopes. Both grants must survive as distinct abilities
        // with their own stack counts.
        it('Centurion charge: BOTH Core Charge I grants survive (self x4, adjacent-allies x2)', () => {
            const abilities = buildShipAbilities(shipFromCsv('Centurion'));
            const buffAbilities = abilities.slots
                .flatMap((s) => s.abilities)
                .filter((a) => a.config.type === 'buff' && a.config.buffName === 'Core Charge I');

            const ccSelf = buffAbilities.find((a) => a.target === 'self');
            const ccAdj = buffAbilities.find((a) => a.target === 'adjacent-allies');

            expect(ccSelf).toBeDefined();
            expect(ccAdj).toBeDefined();
            expect(ccSelf?.config.type === 'buff' && ccSelf.config.stacks).toBe(4);
            expect(ccAdj?.config.type === 'buff' && ccAdj.config.stacks).toBe(2);
        });
    }
);
