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

describe('SP-B — new reactive trigger families', () => {
    // Verbatim from docs/ship-skills.csv (second_passive_skill_text field).
    const PARACELSUS_P2 =
        'Upon being killed by direct Damage, this Unit deals <unit-damage>Damage equal to 50%</unit-damage> of its max HP and grants allies <unit-skill>Everliving Regeneration II</unit-skill> for 4 turns.';

    it.fails(
        'Paracelsus: "Upon being killed by direct Damage, deals damage equal to 50% of its max HP" builds an on-destroyed HP-scaled retaliation',
        () => {
            const abilities = abilitiesFor({ secondPassiveSkillText: PARACELSUS_P2 }, 'passive');
            // GAP: SP-B — today NO ability at all is emitted for the retaliation clause (only the
            // "grants allies Everliving Regeneration II" buff builds, and it incorrectly rides
            // on-cast instead of on-destroyed too). `on-destroyed` is an EXISTING live trigger and
            // `hpBasisPct` is an EXISTING type-valid AbilityConfig['damage'] field (Vindicator
            // precedent, PR #229) — this is the faithful final shape, not a proxy.
            expect(
                abilities.some(
                    (a) =>
                        a.trigger === 'on-destroyed' &&
                        a.config.type === 'damage' &&
                        a.config.hpBasisPct != null
                )
            ).toBe(true);
        }
    );

    // Verbatim from docs/ship-skills.csv (second_passive_skill_text field).
    const FAUST_P2 =
        'This Unit <unit-aid>purges 3</unit-aid> buffs from the enemy when killed by direct Damage.';

    // FALSE POSITIVE — locked as a regression guard, NOT assigned to SP-B. Dry-run (plain `it`)
    // against production PASSES today: buildShipAbilities already routes this exact "purges N
    // buffs ... when killed by direct Damage" clause onto `on-destroyed` via
    // detectKilledByDirectDamageTrigger (skillTextParser.ts) — a detector whose own doc comment
    // names Faust as its target. The SP0 roadmap assumed this was an unmodelled reactive family;
    // it was already shipped independently of this epic.
    it('Faust: "purges 3 buffs from the enemy when killed by direct Damage" already rides on-destroyed (FP)', () => {
        const abilities = abilitiesFor({ secondPassiveSkillText: FAUST_P2 }, 'passive');
        expect(abilities.some((a) => a.trigger === 'on-destroyed')).toBe(true);
    });

    // Verbatim from docs/ship-skills.csv (second_passive_skill_text field).
    const CURATOR_P2 =
        'This Unit has 20% Shield Penetration. <br /><br />\nWhen an enemy uses their charged skill, this unit <unit-aid>purges 1 buffs</unit-aid> from that enemy, and inflicts <unit-skill>Block Buff</unit-skill> for 1 turns.';

    // FALSE POSITIVE — locked as a regression guard, NOT assigned to SP-B. Dry-run (plain `it`)
    // against production PASSES today: buildShipAbilities's "Phase 4 (Curator / FrontLine)"
    // block (parseEnemyChargedCastReaction) already emits the purge + Block-Buff debuff on
    // `on-enemy-charged-cast`. Pre-dates this epic. NOTE (not asserted here, out of this probe's
    // scope): the generic buff-grant loop ALSO independently emits a second, ungated on-cast
    // "Block Buff" debuff for the same clause (a duplicate-emission residue, not a missing-
    // trigger gap) — flagged in the triage doc for a possible follow-up outside SP-B.
    it('Curator: reactive purge/Block-Buff already rides on-enemy-charged-cast (FP)', () => {
        const abilities = abilitiesFor({ secondPassiveSkillText: CURATOR_P2 }, 'passive');
        expect(abilities.some((a) => a.trigger === 'on-enemy-charged-cast')).toBe(true);
    });

    // Verbatim from docs/ship-skills.csv (second_passive_skill_text field).
    const FRONTLINE_P2 =
        'This ship has 20% Shield Penetration.<br />While Shielded, it gains 2500 additional Defense.<br />This Unit gains <unit-damage>Shield equal to 25%</unit-damage> of its Max HP at the start of combat.<br /><br />When an enemy uses their Charged skill, it deals <unit-damage>80%</unit-damage> and gains a Shield equal to <unit-damage>30%</unit-damage> of the damage dealt, once per round.';

    // FALSE POSITIVE — locked as a regression guard, NOT assigned to SP-B. Dry-run (plain `it`)
    // against production PASSES today: the same "Phase 4 (Curator / FrontLine)" block already
    // emits BOTH the reactive damage AND the reactive shield on `on-enemy-charged-cast`. Only the
    // shield's AMOUNT plumbing (pct basis) is inexact — that is explicitly SP-G's scope per the
    // brief, not this reactive-trigger probe's.
    it('FrontLine: reactive damage+shield already rides on-enemy-charged-cast (FP)', () => {
        const abilities = abilitiesFor({ secondPassiveSkillText: FRONTLINE_P2 }, 'passive');
        expect(abilities.some((a) => a.trigger === 'on-enemy-charged-cast')).toBe(true);
    });

    // Verbatim from docs/ship-skills.csv (second_passive_skill_text field).
    const RAVAGER_P2 =
        'This Unit ignores 10% of Defense. It gains 1 stack of <unit-skill>Overload</unit-skill> every turn. Upon killing an enemy, it loses <unit-skill>Overload</unit-skill> and gains <unit-skill>Marauder Rage III</unit-skill> for 3 turns. If its debuff is resisted, it gains <unit-skill>Hacking Module Overdrive</unit-skill> for 1 turn.';

    it.fails(
        'Ravager: "If its debuff is resisted, gains Hacking Module Overdrive" is an unmodelled INFLICTOR-side reaction',
        () => {
            const abilities = abilitiesFor({ secondPassiveSkillText: RAVAGER_P2 }, 'passive');
            const effect = abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Hacking Module Overdrive'
            );
            // GAP: SP-B — only the RESISTER-scoped `on-debuff-resisted` trigger exists (self-scoped
            // on the unit that resisted, D-PR16 Lockdown); the INFLICTOR-side "when the debuff THIS
            // unit inflicted gets resisted" trigger does not exist yet. Today the grant rides plain
            // on-cast (ungated). Proxy per the decision rule: `on-cast` is the only literal a
            // faithful new inflictor-side trigger could never collide with here.
            expect(effect?.trigger).not.toBe('on-cast');
        }
    );

    // Verbatim from docs/ship-skills.csv (second_passive_skill_text field).
    const NOSOROG_P2 =
        'This Unit reflects 40% of the Damage taken back to the enemy when directly damaged as a primary target. Additionally, when this Unit removes a Debuff, it gains <unit-skill>Defense Up II</unit-skill> for 1 turn.';

    it.fails(
        'Nosorog: "when this Unit removes a Debuff, gains Defense Up II" does not ride on-own-cleanse',
        () => {
            const abilities = abilitiesFor({ secondPassiveSkillText: NOSOROG_P2 }, 'passive');
            const effect = abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Defense Up II'
            );
            // GAP: SP-B — VERIFIED (not the assumed FP): `on-own-cleanse` (Phase 3 PR-H) exists but
            // its trigger detector (OWN_CLEANSE_TRIGGER_RE) only matches the verbs
            // "cleanses"/"cleansing", not Nosorog's "removes a Debuff" phrasing — so this grant
            // rides plain on-cast today. Needs the detector's verb alternation widened (or a
            // parallel phrasing) to cover "removes a Debuff".
            expect(effect?.trigger).toBe('on-own-cleanse');
        }
    );
});
