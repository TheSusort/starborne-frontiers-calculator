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
    'Wave 8 Task 10 — Wisteria self-crit Corrosion → Inferno II injection',
    () => {
        // Wisteria's refit-active (R2) passive: "This Unit inflicts Inferno II for 2 turns after
        // applying Corrosion with a Critical hit and extends the newly applied Corrosion by 1
        // turn with a chance to hit equal to Crit Power." Two mechanics in ONE clause:
        //  1. A self-crit-gated secondary DoT injection ("inflicts Inferno II for 2 turns after
        //     applying Corrosion with a Critical hit") — previously UNMODELED entirely.
        //  2. The Corrosion extension ("extends the newly applied Corrosion by 1 turn with a
        //     chance to hit equal to Crit Power") — already modeled as `extend-dot` and must
        //     keep working unchanged alongside the new dot injection.
        it('emits an Inferno II dot (duration 2) on the self on-crit-after-Corrosion trigger', () => {
            const { slots } = buildShipAbilities(shipFromCsv('Wisteria'));
            const flat = slots.flatMap((s) => s.abilities);
            const inferno = flat.find(
                (a) => a.config.type === 'dot' && a.config.dotType === 'inferno'
            );
            expect(inferno).toBeDefined();
            if (inferno?.config.type !== 'dot') throw new Error('unreachable');
            expect(inferno.config.tier).toBe(30); // Inferno II
            expect(inferno.config.duration).toBe(2);
            expect(inferno.trigger).toBe('on-self-crit-dot');
            expect(inferno.target).toBe('enemy');
        });

        it('still emits the Corrosion extend-dot ability (self-crit, chance-from-crit-power)', () => {
            const { slots } = buildShipAbilities(shipFromCsv('Wisteria'));
            const flat = slots.flatMap((s) => s.abilities);
            const extend = flat.find((a) => a.config.type === 'extend-dot');
            expect(extend).toBeDefined();
            if (extend?.config.type !== 'extend-dot') throw new Error('unreachable');
            expect(extend.config.turns).toBe(1);
            expect(extend.config.chanceFromCritPower).toBe(true);
            expect(extend.config.scope).toBe('inflicted');
        });

        it("does not mint a phantom Corrosion dot in the passive slot (only Inferno II, not the trigger clause's own named DoT)", () => {
            // Scoped to the PASSIVE slot: the active/charge skills legitimately inflict their own
            // Corrosion DoTs (buildDoTAutoFill), unrelated to this self-crit-dot mechanic.
            const { slots } = buildShipAbilities(shipFromCsv('Wisteria'));
            const passive = slots.find((s) => s.slot === 'passive')!;
            const dots = passive.abilities.filter((a) => a.config.type === 'dot');
            expect(dots).toHaveLength(1);
            if (dots[0].config.type !== 'dot') throw new Error('unreachable');
            expect(dots[0].config.dotType).toBe('inferno');
        });
    }
);
