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
    'Wave 8 Task 9 — Madax adjacent-Supporter Defense grant (was mis-parsed self-heal)',
    () => {
        // Madax's refit-active (second) passive: "This Unit repairs itself for 13% of its Max
        // HP when an enemy dies. When adjacent to a Supporter, this Unit receives 30% more
        // Repairs and increases that Supporter's Defense by 20% of this Unit's Defense." The
        // "increases that Supporter's Defense by 20%…" clause was mis-parsed as a phantom SELF
        // heal (HEAL_REPAIR_RE's lazy walk matched the noun "Repairs" and ran past the clause
        // to its unrelated "20%"). It should instead be a Defense stat-GRANT to the adjacent
        // Supporter ally, and the legit 13% on-enemy-destroyed self-heal must remain untouched.
        it('does not emit a phantom self-heal with basis defense/pct 20', () => {
            const abilities = buildShipAbilities(shipFromCsv('Madax'));
            const flat = abilities.slots.flatMap((s) => s.abilities);
            const badHeal = flat.find(
                (a) =>
                    a.config.type === 'heal' &&
                    a.config.basis === 'defense' &&
                    a.config.pct === 20 &&
                    a.target === 'self'
            );
            expect(badHeal).toBeUndefined();
        });

        it('keeps the 13% on-enemy-destroyed self-heal unchanged', () => {
            const abilities = buildShipAbilities(shipFromCsv('Madax'));
            const flat = abilities.slots.flatMap((s) => s.abilities);
            const goodHeal = flat.find((a) => a.config.type === 'heal' && a.config.pct === 13);
            expect(goodHeal).toBeDefined();
            expect(goodHeal?.target).toBe('self');
            expect(goodHeal?.trigger).toBe('on-enemy-destroyed');
        });

        it("emits a Defense stat-grant to the adjacent Supporter (20% of this Unit's Defense)", () => {
            const abilities = buildShipAbilities(shipFromCsv('Madax'));
            const flat = abilities.slots.flatMap((s) => s.abilities);
            const grant = flat.find(
                (a) => a.config.type === 'pre-combat-stat' && a.config.stat === 'defence'
            );

            expect(grant).toBeDefined();
            expect(grant?.target).toBe('adjacent-allies');
            expect(grant?.trigger).toBe('pre-combat');
            if (grant?.config.type !== 'pre-combat-stat') throw new Error('unreachable');
            expect(grant.config.value).toBe(20);
            expect(grant.config.valueKind).toBe('percent-of-donor');
            expect(grant.config.requiresAdjacentRole).toBe('SUPPORTER');
        });
    }
);
