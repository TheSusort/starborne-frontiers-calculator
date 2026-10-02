import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';

// Build a full-refit Ship carrying a CSV record's texts (mirrors wave6StealthBypass.test.ts's
// shipFromCsv helper, copied per the Wave 8 convention so this file has no cross-wave
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

describe.skipIf(!csvAvailable())('Wusheng keeps Stealth on direct damage', () => {
    // Wusheng's refit-active passive reads "This Unit takes 25% less direct damage while
    // Stealth is active." There is no removal clause: she keeps Stealth when hit directly.
    // Two modelled mechanics follow (the on-crit Stealth grant, the 25% incoming reduction);
    // no Stealth-removal reaction exists.
    it('keeps Stealth when directly damaged: no remove-self-buff Stealth on the on-attacked trigger', () => {
        const { slots } = buildShipAbilities(shipFromCsv('Wusheng'));
        const abilities = slots.flatMap((s) => s.abilities);
        const remove = abilities.find(
            (a) => a.config.type === 'remove-self-buff' && a.config.buffName === 'Stealth'
        );
        expect(remove).toBeUndefined();
        expect(abilities.filter((a) => a.trigger === 'on-attacked')).toEqual([]);
    });

    it('still emits the existing 25% incoming-reduction ability gated on self-stealth', () => {
        const { slots } = buildShipAbilities(shipFromCsv('Wusheng'));
        const abilities = slots.flatMap((s) => s.abilities);
        const reduction = abilities.find((a) => a.config.type === 'incoming-reduction');
        expect(reduction).toBeDefined();
        if (reduction?.config.type !== 'incoming-reduction') throw new Error('unreachable');
        expect(reduction.config).toMatchObject({
            scope: 'direct',
            condition: 'self-stealth',
            pct: 25,
        });
    });

    it('still emits the on-crit Stealth grant', () => {
        const { slots } = buildShipAbilities(shipFromCsv('Wusheng'));
        const abilities = slots.flatMap((s) => s.abilities);
        const grant = abilities.find(
            (a) => a.type === 'buff' && a.config.type === 'buff' && a.config.buffName === 'Stealth'
        );
        expect(grant).toBeDefined();
        expect(grant?.trigger).toBe('on-crit');
    });
});
