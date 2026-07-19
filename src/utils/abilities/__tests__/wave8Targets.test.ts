import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';

// Build a full-refit Ship carrying a CSV record's texts (mirrors wave6StealthBypass.test.ts's
// shipFromCsv helper — copied here per the Wave 8 Task 5 brief so this file has no cross-wave
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
    'Wave 8 Task 5 — Selenite Concentrate Fire targets highest-attack enemy',
    () => {
        it('Selenite third passive: Concentrate Fire targets enemy-highest-attack, trigger start-of-round', () => {
            const abilities = buildShipAbilities(shipFromCsv('Selenite'));
            const cf = abilities.slots
                .flatMap((s) => s.abilities)
                .find(
                    (a) => a.config.type === 'debuff' && a.config.buffName === 'Concentrate Fire'
                );

            expect(cf?.target).toBe('enemy-highest-attack');
            expect(cf?.trigger).toBe('start-of-round');
        });
    }
);

describe.skipIf(!csvAvailable())(
    'Wave 8 Task 6 — Quixilver Barrier grant targets all-allies (receiver-aware condition strip)',
    () => {
        it('Quixilver third passive: "…if it has shield equal to 100% of its max HP, this Unit grants all allies Barrier…" resolves Barrier to all-allies, not self', () => {
            const abilities = buildShipAbilities(shipFromCsv('Quixilver'));
            const barrier = abilities.slots
                .flatMap((s) => s.abilities)
                .find((a) => a.config.type === 'buff' && a.config.buffName === 'Barrier');

            expect(barrier?.target).toBe('all-allies');
        });
    }
);
