import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability, Skill } from '../../../types/abilities';
import {
    csvAvailable,
    loadShipSkillRecords,
    ShipSkillRecord,
} from '../../../../scripts/lib/shipSkillCsv';

/**
 * Regression tests for Task B (ship-kit correctness audit, Wave 2): four HIGH-severity
 * WRONG-PARSE findings in target/clause resolution. Each test runs the ship's VERBATIM
 * docs/ship-skills.csv slot text through the production `buildShipAbilities` build (not an
 * isolated-clause parser call) so the bug is only visible at the full multi-sentence level.
 * Skips gracefully when the gitignored reference CSV is absent (clean checkout / CI).
 */

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

function slot(skills: Skill[], name: string): Skill | undefined {
    return skills.find((s) => s.slot === name);
}

function abilitiesOfType(abilities: Ability[], type: string): Ability[] {
    return abilities.filter((a) => a.type === type);
}

function recordFor(name: string): ShipSkillRecord {
    const rec = loadShipSkillRecords().find((r) => r.name.toUpperCase() === name.toUpperCase());
    if (!rec) throw new Error(`docs/ship-skills.csv: no record found for "${name}"`);
    return rec;
}

describe.skipIf(!csvAvailable())(
    'Task B — parser target/clause-resolution fixes (verbatim docs/ship-skills.csv)',
    () => {
        it('B1: Quixilver passive — the "if it has shield equal to 100% of its max HP" CONDITION does not fabricate a phantom shield-grant ability', () => {
            const rec = recordFor('Quixilver');
            // Second passive (R2) carries the phantom clause; third is null so R2 applies
            // even at the default refits:4 fixture, but pin it explicitly for clarity.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const s = ship({ refits: [{}, {}] as any, secondPassiveSkillText: rec.passives[1] });
            const { slots } = buildShipAbilities(s);
            const passive = slot(slots, 'passive');
            expect(passive).toBeDefined();

            const phantomShield = abilitiesOfType(passive!.abilities, 'shield').find(
                (a) => a.config.type === 'shield' && a.config.pct === 100
            );
            expect(phantomShield).toBeUndefined();

            // The "100% max HP" clause was gating a real grant ("...this Unit grants all
            // allies Barrier for 1 hit"), not the phantom shield — make sure fixing the
            // phantom didn't also drop the legitimate Barrier buff. Ship-kit W8 Task 6 made
            // `stripConditionClauses`'s trailing strip receiver-aware, so the "this Unit
            // grants all allies Barrier" receiver clause now survives and resolves to
            // all-allies (previously fell back to self — see wave8Targets.test.ts).
            const barrierGrant = passive!.abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Barrier'
            );
            expect(barrierGrant).toBeDefined();
            expect(barrierGrant!.type).toBe('buff');
            expect(barrierGrant!.target).toBe('all-allies');
        });

        it('B2: Rikra passive (R2) — "repairs 60% of its Max HP ... upon killing them" self-heal targets self, not ally', () => {
            const rec = recordFor('Rikra');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const s = ship({ refits: [{}, {}] as any, secondPassiveSkillText: rec.passives[1] });
            const { slots } = buildShipAbilities(s);
            const passive = slot(slots, 'passive');
            expect(passive).toBeDefined();

            const heal = abilitiesOfType(passive!.abilities, 'heal')[0];
            expect(heal).toBeDefined();
            expect(heal.target).toBe('self');
        });

        it('B3: Panon passive (R2) — "applies Barrier Recharging to itself" targets self, not enemy', () => {
            const rec = recordFor('Panon');
            // Third passive (R4) is empty in the CSV, so the second passive (R2) is the
            // refit-active row per getShipSkillRows.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const s = ship({ refits: [{}, {}] as any, secondPassiveSkillText: rec.passives[1] });
            const { slots } = buildShipAbilities(s);
            const passive = slot(slots, 'passive');
            expect(passive).toBeDefined();

            // Pre-fix this is misclassified as an ENEMY debuff (config.type 'debuff'), so match
            // on buffName across both buff/debuff configs and assert the corrected shape.
            const barrierRecharging = passive!.abilities.find(
                (a) =>
                    (a.config.type === 'buff' || a.config.type === 'debuff') &&
                    a.config.buffName === 'Barrier Recharging'
            );
            expect(barrierRecharging).toBeDefined();
            expect(barrierRecharging!.target).toBe('self');
            expect(barrierRecharging!.type).toBe('buff');
        });

        it('B4: Panguan passive (R2) — the Stealth grant anchors to "Gains Stealth ... when directly damaged", not the "Stealthed" sentence', () => {
            const rec = recordFor('Panguan');
            // Third passive (R4) is empty in the CSV, so the second passive (R2) is the
            // refit-active row per getShipSkillRows.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const s = ship({ refits: [{}, {}] as any, secondPassiveSkillText: rec.passives[1] });
            const { slots } = buildShipAbilities(s);
            const passive = slot(slots, 'passive');
            expect(passive).toBeDefined();

            const stealth = passive!.abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Stealth'
            );
            expect(stealth).toBeDefined();
            expect(stealth!.target).toBe('self');
            expect(stealth!.trigger).toBe('on-attacked');
        });
    }
);

describe.skipIf(!csvAvailable())(
    'Task C — Graphite charged-shield all-allies flip (verbatim docs/ship-skills.csv)',
    () => {
        it('C1: Graphite charged slot — the co-cast "Out. Damage Up III" buff flips the shield to all-allies, matching the active slot', () => {
            const rec = recordFor('Graphite');
            const s = ship({
                chargeSkillText: rec.charge,
                chargeSkillCharge: rec.chargeCharge,
            });
            const { slots } = buildShipAbilities(s);
            const charged = slot(slots, 'charged');
            expect(charged).toBeDefined();

            const shield = abilitiesOfType(charged!.abilities, 'shield').find(
                (a) => a.config.type === 'shield' && a.config.pct === 180
            );
            expect(shield).toBeDefined();
            expect(shield!.target).toBe('all-allies');
        });
    }
);
