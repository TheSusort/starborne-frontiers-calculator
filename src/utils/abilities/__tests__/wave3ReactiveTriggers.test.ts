import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Skill } from '../../../types/abilities';
import {
    csvAvailable,
    loadShipSkillRecords,
    ShipSkillRecord,
} from '../../../../scripts/lib/shipSkillCsv';

/**
 * Regression tests for the ship-kit correctness audit, Wave 3: reactive-trigger cascade and
 * target-scope fixes. Each test runs the ship's VERBATIM docs/ship-skills.csv slot text through
 * the production `buildShipAbilities` build (not an isolated-clause parser call) so the bug is
 * only visible at the full multi-sentence level. Skips gracefully when the gitignored reference
 * CSV is absent (clean checkout / CI).
 */

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

function slot(skills: Skill[], name: string): Skill | undefined {
    return skills.find((s) => s.slot === name);
}

function recordFor(name: string): ShipSkillRecord {
    const rec = loadShipSkillRecords().find((r) => r.name.toUpperCase() === name.toUpperCase());
    if (!rec) throw new Error(`docs/ship-skills.csv: no record found for "${name}"`);
    return rec;
}

describe.skipIf(!csvAvailable())(
    'Task 1 — Amartya active all-enemies debuff target scope (verbatim docs/ship-skills.csv)',
    () => {
        it('Amartya active — Defense Down II & Inc. Repair Down II apply to all-enemies', () => {
            const rec = recordFor('Amartya');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const s = ship({ refits: [{}, {}] as any, activeSkillText: rec.active });
            const { slots } = buildShipAbilities(s);
            const active = slot(slots, 'active')!;
            const debuffs = active.abilities.filter(
                (a) =>
                    a.config.type === 'debuff' &&
                    ['Defense Down II', 'Inc. Repair Down II'].includes(a.config.buffName)
            );
            expect(debuffs).toHaveLength(2);
            for (const d of debuffs) expect(d.target).toBe('all-enemies');
        });
    }
);

describe.skipIf(!csvAvailable())(
    'Task 2 — Meiying recurring Stealth uses start-of-turn trigger (verbatim docs/ship-skills.csv)',
    () => {
        it('Meiying p2 — "At the start of combat and every turn, this Unit gains Stealth for 2 turns" is start-of-turn', () => {
            const rec = recordFor('Meiying');
            const s = ship({ secondPassiveSkillText: rec.passives[1] });
            const { slots } = buildShipAbilities(s);
            const passive = slot(slots, 'passive')!;
            const stealth = passive.abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Stealth'
            );
            expect(stealth).toBeDefined();
            expect(stealth!.trigger).toBe('start-of-turn');
        });
    }
);

describe.skipIf(!csvAvailable())(
    'Task 3 — Harvester Speed Up I shares the on-ally-destroyed trigger (verbatim docs/ship-skills.csv)',
    () => {
        it('Harvester p2 — "When an allied Unit is destroyed, this Unit gains 1 extra end of round action and Speed Up I for 6 turns" co-triggers Speed Up I on on-ally-destroyed', () => {
            const rec = recordFor('Harvester');
            const s = ship({ secondPassiveSkillText: rec.passives[1] });
            const { slots } = buildShipAbilities(s);
            const passive = slot(slots, 'passive')!;
            const speedUp = passive.abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Speed Up I'
            );
            expect(speedUp).toBeDefined();
            expect(speedUp!.trigger).toBe('on-ally-destroyed');
        });
    }
);

describe.skipIf(!csvAvailable())(
    'Task 4 — Amartya Exposed triggers on enemy-gains-Taunt (verbatim docs/ship-skills.csv)',
    () => {
        it('Amartya p2 — "When an enemy defender gains Taunt, this Unit inflicts N stacks of Exposed on that defender" resolves to on-enemy-taunt-gained', () => {
            const rec = recordFor('Amartya');
            const s = ship({ secondPassiveSkillText: rec.passives[1] });
            const { slots } = buildShipAbilities(s);
            const passive = slot(slots, 'passive')!;
            const exposed = passive.abilities.find(
                (a) => a.config.type === 'debuff' && a.config.buffName === 'Exposed'
            );
            expect(exposed).toBeDefined();
            expect(exposed!.trigger).toBe('on-enemy-taunt-gained');
        });
    }
);

describe.skipIf(!csvAvailable())(
    'Task 5 — Sansi on-enemy-repaired heal with count-scaling + per-round cap (verbatim docs/ship-skills.csv)',
    () => {
        it('Sansi p2 — "when an enemy is directly repaired, limited to 3 times per Round, this Unit repairs 5% for every enemy repaired" rides on-enemy-repaired, pct 5, count-scaled, capped 3/round', () => {
            const rec = recordFor('Sansi');
            const s = ship({ secondPassiveSkillText: rec.passives[1] });
            const { slots } = buildShipAbilities(s);
            const passive = slot(slots, 'passive')!;
            const heal = passive.abilities.find(
                (a) => a.config.type === 'heal' && a.type === 'heal' && a.target === 'self'
            );
            expect(heal).toBeDefined();
            // Trigger: reacts to an enemy being repaired, NOT fired every cast (on-cast).
            expect(heal!.trigger).toBe('on-enemy-repaired');
            // Base per-unit rate is kept at 5% (config.pct); the count multiplies it at drain time.
            expect(heal!.config.type).toBe('heal');
            if (heal!.config.type === 'heal') expect(heal!.config.pct).toBe(5);
            // Scaling rule: reactive event-count source (repaired-enemy count), perUnit == base pct.
            expect(heal!.scaling).toBeDefined();
            expect(heal!.scaling!.countSource).toBe('repaired-enemy-count');
            expect(heal!.scaling!.perUnit).toBe(5);
            // Event-count scaling references NO live-state condition.
            expect(heal!.scaling!.conditionIndex).toBeUndefined();
            // Numeric per-round cap.
            expect(heal!.maxPerRound).toBe(3);
        });
    }
);

describe.skipIf(!csvAvailable())(
    'Task 6 — Anemone heal triggers on enemy-takes-DoT-damage (verbatim docs/ship-skills.csv)',
    () => {
        it('Anemone p2 — "When an enemy takes damage from a Damage over Time effect, repair 5% of this Unit\'s Max HP" resolves to on-enemy-dot-damage', () => {
            const rec = recordFor('Anemone');
            const s = ship({ secondPassiveSkillText: rec.passives[1] });
            const { slots } = buildShipAbilities(s);
            const passive = slot(slots, 'passive')!;
            const heal = passive.abilities.find(
                (a) => a.config.type === 'heal' && a.type === 'heal' && a.target === 'self'
            );
            expect(heal).toBeDefined();
            expect(heal!.trigger).toBe('on-enemy-dot-damage');
        });
    }
);

describe.skipIf(!csvAvailable())(
    'Task 7 — Laika self-shield triggers on removing an enemy Shield (verbatim docs/ship-skills.csv)',
    () => {
        it('Laika p2 — "This Unit gains a Shield equal to 30% of its Max HP upon removing Shield from an enemy" resolves to on-own-shield-strip', () => {
            const rec = recordFor('Laika');
            const s = ship({ secondPassiveSkillText: rec.passives[1] });
            const { slots } = buildShipAbilities(s);
            const passive = slot(slots, 'passive')!;
            const shield = passive.abilities.find(
                (a) => a.config.type === 'shield' && a.type === 'shield' && a.target === 'self'
            );
            expect(shield).toBeDefined();
            // Trigger: reacts to THIS unit removing an enemy's shield (charged skill only), NOT
            // fired every cast (on-cast) — the active skill (cleanse + damage) never strips shield.
            expect(shield!.trigger).toBe('on-own-shield-strip');
            expect(shield!.config.type).toBe('shield');
            if (shield!.config.type === 'shield') {
                expect(shield!.config.pct).toBe(30);
                expect(shield!.config.basis).toBe('hp');
            }
        });
    }
);

describe.skipIf(!csvAvailable())(
    'Task 8 — Pestilence reactive Corrosion DoT on enemy-cleanse (verbatim docs/ship-skills.csv)',
    () => {
        it('Pestilence p2 — "When an enemy cleanses a Debuff this unit inflicts Corrosion II for 2 turns on all cleansed enemies" builds a reactive dot on on-enemy-cleansed', () => {
            const rec = recordFor('Pestilence');
            const s = ship({ secondPassiveSkillText: rec.passives[1] });
            const { slots } = buildShipAbilities(s);
            const passive = slot(slots, 'passive')!;
            const dot = passive.abilities.find((a) => a.config.type === 'dot' && a.type === 'dot');
            expect(dot).toBeDefined();
            // Reacts to an ENEMY cleansing a debuff — NOT fired every cast (on-cast). NO code path
            // produced a reactive passive-slot DoT before this task (buildDoTAutoFill scans only
            // active/charge sources; dotAbility() hardcodes on-cast).
            expect(dot!.trigger).toBe('on-enemy-cleansed');
            // Multi-recipient marker: the DoT lands on ALL cleansed enemies. `all-enemies` is the
            // fan-out signal; the reactive dot executor keys the actual recipients off the cleanse
            // event's cleansedEnemyIds (not the DPS dummy sink).
            expect(dot!.target).toBe('all-enemies');
            expect(dot!.config.type).toBe('dot');
            if (dot!.config.type === 'dot') {
                // Corrosion II → DOT_TIER_MAP potency tier 6 (the roman "II" is the game label;
                // the engine stores the numeric per-tick potency).
                expect(dot!.config.dotType).toBe('corrosion');
                expect(dot!.config.tier).toBe(6);
                expect(dot!.config.duration).toBe(2);
            }
            // Regression: the first sentence's reduce-duration cleanse must still be present
            // (on-debuff-inflicted, all-allies) — don't regress it while adding the DoT clause.
            const reduce = passive.abilities.find(
                (a) =>
                    a.config.type === 'cleanse' &&
                    a.config.mode === 'reduce-duration' &&
                    a.trigger === 'on-debuff-inflicted'
            );
            expect(reduce).toBeDefined();
        });
    }
);

describe.skipIf(!csvAvailable())(
    'Regression — Sokol Blast must stay on-cast despite a co-located extra-action kill phrase (verbatim docs/ship-skills.csv)',
    () => {
        it('Sokol p2 — "gains 1 stack of Blast every turn and grants one extra end of round action upon a kill, once per round" keeps Blast on-cast (accumulating, not gated behind a kill)', () => {
            const rec = recordFor('Sokol');
            const s = ship({ secondPassiveSkillText: rec.passives[1] });
            const { slots } = buildShipAbilities(s);
            const passive = slot(slots, 'passive')!;
            const blast = passive.abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Blast'
            );
            expect(blast).toBeDefined();
            expect(blast!.trigger).toBe('on-cast');
        });
    }
);
