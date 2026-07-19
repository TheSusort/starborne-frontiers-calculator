import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';

// Build a full-refit Ship carrying a CSV record's texts (mirrors wave6StealthBypass.test.ts's
// shipFromCsv helper, copied per the Wave 8 Task 1/3 briefs so this file has no cross-wave
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
    'Wave 8 Task 3 — Lev charged Crit Power Up II gated on self-crit',
    () => {
        // Lev charged skill: "...If a critical hit occurs, all hit enemies have their debuffs
        // extended by 1 turn and all allies are granted Crit Power Up II for 2 turns." The
        // co-located extend-status ability already gates on this same clause (buildShipAbilities.ts
        // ~1657, /critical hit occurs/i). The Crit Power Up II buff grant must carry the SAME
        // self-crit condition — a plain on-cast buff would let it fire on every cast, not just
        // crits.
        it('Crit Power Up II targets all-allies and carries a self-crit condition', () => {
            const abilities = buildShipAbilities(shipFromCsv('Lev'));
            const cpu = abilities.slots
                .flatMap((s) => s.abilities)
                .find((a) => a.config.type === 'buff' && a.config.buffName === 'Crit Power Up II');

            expect(cpu).toBeDefined();
            expect(cpu?.target).toBe('all-allies');
            expect(cpu?.trigger).toBe('on-cast');
            expect(cpu?.conditions).toEqual(
                expect.arrayContaining([expect.objectContaining({ subject: 'self-crit' })])
            );
        });
    }
);

describe.skipIf(!csvAvailable())(
    'Wave 8 Task 4 — Chimei end-of-round Stealth grant trigger',
    () => {
        // Chimei's third passive: "At the end of the round, non-defender allies below 40% HP are
        // granted Stealth for 1 turn." followed by a SEPARATE "At the start of the round, all allies
        // with Stealth repairs..." sentence. The Stealth grant must classify as 'end-of-round', not
        // 'on-cast' (its prior misclassification) — and the sibling start-of-round repair clause
        // must NOT bleed into this grant's trigger (resolveBuffClause is sentence-scoped, so the two
        // clauses stay separate). Out of scope for this task: the "non-defender"/"below 40% HP"
        // conditions themselves — only the trigger classification is fixed here.
        it("Stealth grant carries trigger 'end-of-round'", () => {
            const abilities = buildShipAbilities(shipFromCsv('Chimei'));
            const stealth = abilities.slots
                .flatMap((s) => s.abilities)
                .find((a) => a.config.type === 'buff' && a.config.buffName === 'Stealth');

            expect(stealth).toBeDefined();
            expect(stealth?.trigger).toBe('end-of-round');
        });
    }
);
