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

describe.skipIf(!csvAvailable())(
    'Wave 8 Task 11 — Wusheng removes Stealth on direct damage',
    () => {
        // Wusheng's refit-active (R2) passive: "This Unit gains Stealth for 1 turn after
        // critically damaging an enemy.<br/><br/>This Unit reduces direct damage by 25% while
        // Stealth is active. If directly damaged while Stealth is active, remove Stealth.<br/><br/>
        // This Unit starts combat fully charged." Two previously-modeled mechanics (the on-crit
        // Stealth grant, the 25% incoming reduction) plus the UNMODELED "remove Stealth on direct
        // damage" reaction targeted by this task.
        it('emits a remove-self-buff ability for Stealth on the on-attacked (directly-damaged) trigger', () => {
            const { slots } = buildShipAbilities(shipFromCsv('Wusheng'));
            const abilities = slots.flatMap((s) => s.abilities);
            const remove = abilities.find(
                (a) => a.config.type === 'remove-self-buff' && a.config.buffName === 'Stealth'
            );
            expect(remove).toBeDefined();
            expect(remove?.trigger).toBe('on-attacked');
            expect(remove?.target).toBe('self');
            if (remove?.config.type !== 'remove-self-buff') throw new Error('unreachable');
            expect(remove.config.scope).toBe('all');
            // Gated on Stealth still being active — the game text is conditional ("if directly
            // damaged WHILE Stealth is active"), not an unconditional kill/repair-style removal.
            expect(remove.conditions).toEqual([
                { subject: 'self-buff', buffName: 'Stealth', derivable: true },
            ]);
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

        it('still emits the on-crit Stealth grant (unaffected by the removal wiring)', () => {
            const { slots } = buildShipAbilities(shipFromCsv('Wusheng'));
            const abilities = slots.flatMap((s) => s.abilities);
            const grant = abilities.find(
                (a) =>
                    a.type === 'buff' && a.config.type === 'buff' && a.config.buffName === 'Stealth'
            );
            expect(grant).toBeDefined();
            expect(grant?.trigger).toBe('on-crit');
        });
    }
);
