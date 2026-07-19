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
    'Wave 8 Task 12 — Zeolite purges a buff when damaging a Defender',
    () => {
        // Zeolite's refit-active (R4) passive: "This Unit increases damage by 30% when hitting a
        // Defender and purges 1 buff from the enemy when dealing damage to a Defender." The +30%
        // damage gate half shipped in Wave 4; the purge half ("purges 1 buff from the enemy when
        // dealing damage to a Defender") was deferred — buildShipAbilities.ts's passive-purge
        // trigger chain had no "when dealing damage to a Defender" detector, so `trigger` came
        // back undefined and the `continue` guard dropped it.
        it('emits a purge ability (enemy, count 1) gated on damaging a Defender, IN ADDITION to the +30% damage modifier', () => {
            const { slots } = buildShipAbilities(shipFromCsv('Zeolite'));
            // Scoped to the PASSIVE slot: Zeolite's ACTIVE skill separately carries its own
            // unconditional on-cast purge (a distinct, pre-existing mechanic) — the passive slot
            // is where the Defender-gated +30%/purge sentence under test actually lives.
            const passive = slots.find((s) => s.slot === 'passive')!;
            expect(passive).toBeDefined();
            const abilities = passive.abilities;

            // Wave-4 half: still present, unaffected.
            const mod = abilities.find(
                (a) => a.config.type === 'modifier' && a.config.channel === 'outgoingDamage'
            );
            expect(mod).toBeDefined();
            expect(mod?.conditions).toEqual([
                { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' },
            ]);

            // New (Task 12) half: the purge.
            const purge = abilities.find((a) => a.config.type === 'purge');
            expect(purge).toBeDefined();
            expect(purge?.target).toBe('enemy');
            if (purge?.config.type !== 'purge') throw new Error('unreachable');
            expect(purge.config.count).toBe(1);
            // Trigger fires on dealing damage to a Defender — mirrors the Wave-4 +30% gate's
            // `enemy-type` condition shape exactly (same subject the reactive-purge executor and
            // the modifier gate both consume).
            expect(purge?.trigger).toBe('on-deal-damage');
            expect(purge?.conditions).toEqual([
                { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' },
            ]);
        });

        it('regression: Sefuba/Rhodium/Faust/Iridium-shape purges are unaffected (no enemy-type condition leaks in)', () => {
            // Sanity check on a NEIGHBOURING purge shape that shares the generic passive-purge
            // loop: Rhodium's end-of-round purge carries no enemy-type condition.
            const rhodium = shipFromCsv('Rhodium');
            const { slots } = buildShipAbilities(rhodium);
            const abilities = slots.flatMap((s) => s.abilities);
            const purges = abilities.filter((a) => a.config.type === 'purge');
            for (const p of purges) {
                expect(p.conditions.some((c) => c.subject === 'enemy-type')).toBe(false);
            }
        });
    }
);
