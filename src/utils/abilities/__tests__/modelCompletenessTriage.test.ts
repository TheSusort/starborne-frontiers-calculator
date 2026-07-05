/**
 * Model-completeness epic — SP0 TRIAGE PROBE CORPUS.
 *
 * One probe per remaining unmodelled mechanic, routed through the REAL production path
 * (buildShipAbilities) with skill text copied VERBATIM from docs/ship-skills.csv.
 *
 * `it.fails(...)` = a real gap: the assertion fails today (so `it.fails` is GREEN), and when the
 * assigned sub-project (SP-A…G) models the mechanic the assertion starts PASSING — which makes
 * `it.fails` FAIL, forcing that SP to drop `.fails` and convert to a normal `it`. Self-enforcing
 * handoff; the suite stays green the whole epic.
 *
 * Plain green `it(...)` = a false positive (behaviour already correct) locked as a regression guard.
 *
 * Each `it.fails` carries exactly ONE assertion (the it.fails masking hazard: it goes green if ANY
 * assertion throws, including for the wrong reason) and a `// GAP: SP-<X>` comment.
 */
import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ability, Skill } from '../../../types/abilities';
import { Ship } from '../../../types/ship';

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

function slot(skills: Skill[], name: string): Skill | undefined {
    return skills.find((s) => s.slot === name);
}

export function abilitiesFor(over: Partial<Ship>, name: string): Ability[] {
    return slot(buildShipAbilities(ship(over)).slots, name)?.abilities ?? [];
}

describe('SP0 triage — corpus scaffold', () => {
    it('abilitiesFor helper is available', () => {
        expect(typeof abilitiesFor).toBe('function');
    });
});

// Family describe-blocks are appended by Tasks 2–9.

describe('SP-A — incoming-reduction condition gates', () => {
    // Verbatim from docs/ship-skills.csv (second_passive_skill_text field).
    const MALVEX_P2 =
        'When Shielded, this Ship takes <unit-damage>10% less damage</unit-damage>. When directly damaged as a primary target, this Unit gains <unit-damage>Shield equal to 15%</unit-damage> of the Damage dealt to them.';

    it.fails(
        'Malvex: "When Shielded, takes 10% less damage" builds a shield-gated incoming-reduction',
        () => {
            const abilities = abilitiesFor({ secondPassiveSkillText: MALVEX_P2 }, 'passive');
            // GAP: SP-A — today NO incoming-reduction ability is emitted at all for this clause
            // (only the "gains Shield equal to 15% of damage taken" ability builds); the parser's
            // incoming-damage-reduction phrasings (Anemone/Panon/Wusheng/Tormenter) don't cover
            // "When Shielded". Needs a new self-shield IncomingCondition literal + parser branch.
            expect(
                abilities.some(
                    (a) => a.type === 'incoming-reduction' /* && shielded condition present */
                )
            ).toBe(true);
        }
    );

    // Verbatim from docs/ship-skills.csv (second_passive_skill_text field). NOTE: split A+E —
    // this probe owns only the reduction half; the "transforms the damage into a Damage over
    // Time effect" transform is SP-E (Task 6).
    const VORON_P2 =
        'When directly damaged, this Unit transforms the damage into a <unit-skill>Damage over Time effect</unit-skill> lasting for 3 turns.<br /><br />This Unit takes <unit-damage>20% less damage</unit-damage> from <unit-skill>Damage over Time effects</unit-skill>.';

    it.fails(
        'Voron: "takes 20% less damage from Damage over Time effects" builds a DoT-scoped incoming-reduction',
        () => {
            const abilities = abilitiesFor({ secondPassiveSkillText: VORON_P2 }, 'passive');
            // GAP: SP-A — today the whole passive slot builds NO abilities at all (neither the
            // transform nor the reduction); the incoming-damage-reduction phrasings don't cover
            // "from Damage over Time effects". `scope: 'dot'` + `condition: 'always'` are both
            // EXISTING, type-valid values (used elsewhere, e.g. Tormenter) — this is the faithful
            // final shape, not a proxy.
            expect(
                abilities.some(
                    (a) =>
                        a.type === 'incoming-reduction' &&
                        a.config.type === 'incoming-reduction' &&
                        a.config.scope === 'dot' &&
                        a.config.condition === 'always'
                )
            ).toBe(true);
        }
    );
});
