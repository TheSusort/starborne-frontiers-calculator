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
import { dotFamilyCounts } from '../roundContext';
import type { ActiveDoTStack } from '../../combat/state';

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

// Ships probed from two SP angles share ONE verbatim text constant (single source of truth → no
// drift between the two probes; both must stay byte-identical to docs/ship-skills.csv).
const VORON_PASSIVE2 =
    'When directly damaged, this Unit transforms the damage into a <unit-skill>Damage over Time effect</unit-skill> lasting for 3 turns.<br /><br />This Unit takes <unit-damage>20% less damage</unit-damage> from <unit-skill>Damage over Time effects</unit-skill>.';
const FRONTLINE_PASSIVE2 =
    'This ship has 20% Shield Penetration.<br />While Shielded, it gains 2500 additional Defense.<br />This Unit gains <unit-damage>Shield equal to 25%</unit-damage> of its Max HP at the start of combat.<br /><br />When an enemy uses their Charged skill, it deals <unit-damage>80%</unit-damage> and gains a Shield equal to <unit-damage>30%</unit-damage> of the damage dealt, once per round.';

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

    it('Malvex: "When Shielded, takes 10% less damage" builds a shield-gated incoming-reduction', () => {
        const abilities = abilitiesFor({ secondPassiveSkillText: MALVEX_P2 }, 'passive');
        expect(
            abilities.some(
                (a) =>
                    a.type === 'incoming-reduction' &&
                    a.config.type === 'incoming-reduction' &&
                    a.config.condition === 'self-shielded'
            )
        ).toBe(true);
    });

    // Verbatim from docs/ship-skills.csv (second_passive_skill_text field). NOTE: split A+E —
    // this probe owns only the reduction half; the "transforms the damage into a Damage over
    // Time effect" transform is SP-E (Task 6). Text shared with the SP-E probe (VORON_PASSIVE2).
    const VORON_P2 = VORON_PASSIVE2;

    it('Voron: "takes 20% less damage from Damage over Time effects" builds a DoT-scoped incoming-reduction', () => {
        const abilities = abilitiesFor({ secondPassiveSkillText: VORON_P2 }, 'passive');
        // CLOSED (SP-A): the parser now emits a DoT-scoped incoming-reduction for the "N% less
        // damage from Damage over Time effects" phrasing. `scope: 'dot'` + `condition: 'always'`
        // are EXISTING, type-valid values (used elsewhere, e.g. Tormenter) — the faithful final
        // shape, not a proxy. (The SP-E "transforms the damage into a DoT" half is a separate probe.)
        expect(
            abilities.some(
                (a) =>
                    a.type === 'incoming-reduction' &&
                    a.config.type === 'incoming-reduction' &&
                    a.config.scope === 'dot' &&
                    a.config.condition === 'always'
            )
        ).toBe(true);
    });
});

describe('SP-B — new reactive trigger families', () => {
    // Verbatim from docs/ship-skills.csv (second_passive_skill_text field).
    const PARACELSUS_P2 =
        'Upon being killed by direct Damage, this Unit deals <unit-damage>Damage equal to 50%</unit-damage> of its max HP and grants allies <unit-skill>Everliving Regeneration II</unit-skill> for 4 turns.';

    it('Paracelsus: "Upon being killed by direct Damage, deals damage equal to 50% of its max HP" builds an on-destroyed HP-scaled retaliation', () => {
        const abilities = abilitiesFor({ secondPassiveSkillText: PARACELSUS_P2 }, 'passive');
        // Retaliation: on-destroyed HP-scaled damage. Assert the exact basis (skill text says
        // "Damage equal to 50% of its max HP") so a wrong-scaling regression is caught.
        expect(
            abilities.some(
                (a) =>
                    a.trigger === 'on-destroyed' &&
                    a.config.type === 'damage' &&
                    a.config.hpBasisPct === 50
            )
        ).toBe(true);
        // Ally-buff half: Everliving Regeneration II must also fire on-destroyed
        // (was wrongly on-cast). Fixed together per the epic's faithfulness goal.
        const regen = abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Everliving Regeneration II'
        );
        expect(regen?.trigger).toBe('on-destroyed');
    });

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

    // Text shared with the SP-G FrontLine shield-amount probe (FRONTLINE_PASSIVE2).
    const FRONTLINE_P2 = FRONTLINE_PASSIVE2;

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

    it('Ravager: "If its debuff is resisted, gains Hacking Module Overdrive" rides the INFLICTOR-side reaction', () => {
        const abilities = abilitiesFor({ secondPassiveSkillText: RAVAGER_P2 }, 'passive');
        const effect = abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Hacking Module Overdrive'
        );
        // PR-B2: the INFLICTOR-side "when the debuff THIS unit inflicted gets resisted" trigger
        // is now modelled as `on-own-debuff-resisted` — mirror of the RESISTER-scoped
        // `on-debuff-resisted` (D-PR16 Lockdown).
        expect(effect?.trigger).toBe('on-own-debuff-resisted');
    });

    // Verbatim from docs/ship-skills.csv (second_passive_skill_text field).
    const NOSOROG_P2 =
        'This Unit reflects 40% of the Damage taken back to the enemy when directly damaged as a primary target. Additionally, when this Unit removes a Debuff, it gains <unit-skill>Defense Up II</unit-skill> for 1 turn.';

    it('Nosorog: "when this Unit removes a Debuff, gains Defense Up II" now rides on-own-cleanse', () => {
        const abilities = abilitiesFor({ secondPassiveSkillText: NOSOROG_P2 }, 'passive');
        const effect = abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Defense Up II'
        );
        // CLOSED (SP-B): `on-own-cleanse` (Phase 3 PR-H) existed but its detector
        // (OWN_CLEANSE_TRIGGER_RE) only matched "cleanses"/"cleansing", not Nosorog's "removes a
        // Debuff" phrasing. The detector's verb alternation is now widened to cover "removes a
        // Debuff", so this grant rides on-own-cleanse instead of plain on-cast.
        expect(effect?.trigger).toBe('on-own-cleanse');
    });
});

describe('SP-C — stat-comparison gates', () => {
    // Verbatim from docs/ship-skills.csv (charge_skill_text field).
    const BAYAH_CHARGE =
        'This Unit deals <unit-damage>150% damage</unit-damage> plus an additional amount equal to <unit-damage>30%</unit-damage> of its Defense and inflicts <unit-skill>Crit Rate Down II</unit-skill> for 2 turns. If this Unit has more Crit Power than the target, it inflicts <unit-skill>Stasis</unit-skill> for 1 turn.';

    it('Bayah: "If this Unit has more Crit Power than the target, inflicts Stasis" is gated on a Crit Power comparison', () => {
        const abilities = abilitiesFor(
            { chargeSkillText: BAYAH_CHARGE, chargeSkillCharge: 2 },
            'charged'
        );
        const stasis = abilities.find(
            (a) => a.config.type === 'control' && a.config.effect === 'stasis'
        );
        // CLOSED (SP-C): the Stasis inflict now carries a real owner-vs-target
        // stat-vs-target/crit-power/gt condition (detectGrantConditions' new SP-C detector).
        expect(
            stasis?.conditions.some(
                (c) => c.subject === 'stat-vs-target' && c.compareStat === 'crit-power'
            )
        ).toBe(true);
    });

    // Verbatim from docs/ship-skills.csv (active_skill_text field).
    const CHAKARA_ACTIVE =
        'This Unit deals <unit-damage>180% damage</unit-damage> with additional damage equal to <unit-damage>80%</unit-damage> of its Defense. If all damaged enemies have more Speed than this Unit, it <unit-aid>adds 1 charge</unit-aid> to its Charged Skill.';

    it('Chakara: "If all damaged enemies have more Speed than this Unit, adds 1 charge" is gated on a Speed comparison', () => {
        const abilities = abilitiesFor({ activeSkillText: CHAKARA_ACTIVE }, 'active');
        const chargeGain = abilities.find((a) => a.config.type === 'charge');
        // CLOSED (SP-C): parseChargeGain now detects the Speed-comparison clause and carries it
        // via the existing `conditions` escape hatch (the same mechanism Cobalt's start-of-turn
        // full-HP gate uses), instead of falling through to the 'always' placeholder.
        expect(
            chargeGain?.conditions.some(
                (c) => c.subject === 'stat-vs-target' && c.compareStat === 'speed'
            )
        ).toBe(true);
    });

    // Verbatim from docs/ship-skills.csv (active_skill_text field). NOTE: Cobalt also appears in
    // SP-G (Task 8) for its passive "adds 1 charge ... at the start of the turn if it is at full
    // HP" start-of-turn charge drain-ordering clauses — a DISTINCT engine-timing limitation. This
    // probe is ONLY the active skill's owner-vs-target HP comparison.
    const COBALT_ACTIVE =
        "This Unit purges <unit-aid>1 buff</unit-aid> from the enemy and deals <unit-damage>200% damage</unit-damage>. If this Unit has more HP than the enemy, it additionally deals <unit-damage>damage equal to 25%</unit-damage> of this Unit's max HP.";

    it('Cobalt: "If this Unit has more HP than the enemy, deals additional damage equal to 25% of max HP" is gated on an HP comparison', () => {
        const abilities = abilitiesFor({ activeSkillText: COBALT_ACTIVE }, 'active');
        const bonusDamage = abilities.find(
            (a) =>
                a.config.type === 'additional-damage' &&
                a.config.stat === 'hp' &&
                a.config.pct === 25
        );
        // CLOSED (SP-C): parseSecondaryDamage now detects the owner-vs-target HP comparison
        // clause preceding this rider and carries it as a real condition. Distinct from the
        // SP-G start-of-turn full-HP self-check on this same ship's passives (a self-only
        // threshold, not an owner-vs-target comparison) — no overlap in mechanism.
        expect(
            bonusDamage?.conditions.some(
                (c) => c.subject === 'stat-vs-target' && c.compareStat === 'hp'
            )
        ).toBe(true);
    });
});

describe('SP-D — count-based gates', () => {
    // Verbatim from docs/ship-skills.csv (second_passive_skill_text field). NOTE: CSV typo
    // "3 ore more" preserved verbatim (not "or more").
    const BERSERKER_P2 =
        'This Unit gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns when hitting 3 ore more enemies.';

    it('Berserker: "gains Marauder Rage II when hitting 3 ore more enemies" is gated on a hit-count threshold', () => {
        const abilities = abilitiesFor({ secondPassiveSkillText: BERSERKER_P2 }, 'passive');
        const rageBuff = abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Marauder Rage II'
        );
        // CLOSED (SP-D): detectGrantConditions now detects the hit-count clause (matching both
        // "or" and the CSV's "ore" typo) and carries it as a real enemies-hit-this-cast/gte
        // condition on the buff grant.
        expect(
            rageBuff?.conditions.some(
                (c) =>
                    c.subject === 'enemies-hit-this-cast' &&
                    c.countComparator === 'gte' &&
                    c.countThreshold === 3
            )
        ).toBe(true);
    });

    // Verbatim from docs/ship-skills.csv (active_skill_text field).
    const TYGR_ACTIVE =
        'This Unit deals <unit-damage>180% damage</unit-damage> and inflicts <unit-skill>Security Down II</unit-skill> for 2 turns. If it damages 2 or more enemies, it adds <unit-aid>adds 1 charge</unit-aid> to its Charged Skill.';

    it('Tygr: "If it damages 2 or more enemies, adds 1 charge" is gated on an actual ≥2 hit-count threshold', () => {
        const abilities = abilitiesFor({ activeSkillText: TYGR_ACTIVE }, 'active');
        const chargeGain = abilities.find((a) => a.config.type === 'charge');
        // CLOSED (SP-D): parseChargeGain now routes this clause through hitCountConditionFromClause
        // + the `conditions` escape hatch (the same mechanism Chakara's SP-C stat-vs-target gate
        // uses) — a real enemies-hit-this-cast/gte/2 condition, replacing the old coarse
        // 'enemy-adjacent' presence-only proxy that never modeled the actual ≥N threshold.
        const cond = chargeGain?.conditions.find((c) => c.subject !== 'always');
        expect(cond?.subject === 'enemies-hit-this-cast' && cond?.countThreshold === 2).toBe(true);
    });

    // Verbatim from docs/ship-skills.csv (charge_skill_text field). NOTE: Belladonna also
    // appears in SP-E (Task 6) for its passive "convert Corrosion into Acidic Decay" clause —
    // a DISTINCT clause. This probe is ONLY the charge skill's Acidic-Decay-count → Stasis gate.
    const BELLADONNA_CHARGE =
        'This Unit deals <unit-damage>180% damage</unit-damage> and inflicts <unit-skill>Corrosion II</unit-skill> for 2 turns.<br />If the enemy has 3 or more <unit-skill>Acidic Decay</unit-skill>, inflict <unit-skill>Stasis</unit-skill> for 1 turn.';

    it('Belladonna: "If the enemy has 3 or more Acidic Decay, inflict Stasis" is gated on a named-DoT-stack-count threshold', () => {
        const abilities = abilitiesFor(
            { chargeSkillText: BELLADONNA_CHARGE, chargeSkillCharge: 3 },
            'charged'
        );
        const stasis = abilities.find(
            (a) => a.config.type === 'control' && a.config.effect === 'stasis'
        );
        // CLOSED (SP-D): countGateCondition now recognises "N or more Acidic Decay" and emits a
        // real enemy-dot-count condition carrying the family name — the Stasis inflict is gated
        // on the ACTUAL 3+ Acidic Decay threshold. Runtime-inert until SP-E introduces the Acidic
        // Decay DoT family (enemyDotFamilyCounts defaults every family to 0 until then).
        expect(
            stasis?.conditions.some(
                (c) =>
                    c.subject === 'enemy-dot-count' &&
                    c.buffName === 'Acidic Decay' &&
                    c.countThreshold === 3
            )
        ).toBe(true);
    });

    it('SP-D follow-up: Acidic Decay is a populated DoT family whose key matches the charge gate', () => {
        // 1. The charge-skill count gate emits buffName 'Acidic Decay' (SP-D, already shipped —
        //    same assertion as the test above).
        const charge = abilitiesFor(
            { chargeSkillText: BELLADONNA_CHARGE, chargeSkillCharge: 3 },
            'charged'
        );
        const stasis = charge.find((a) => a.config.type === 'control');
        const gateKey = stasis?.conditions.find((c) => c.subject === 'enemy-dot-count')?.buffName;
        expect(gateKey).toBe('Acidic Decay');
        // 2. The runtime (SP-E) populates enemyDotFamilyCounts under the SAME key —
        //    dotFamilyCounts counts live ActiveDoTStack entries by their `family` tag, which
        //    Task E4's convert-dot executor stamps 'Acidic Decay' onto a just-converted corrosion
        //    entry (the reactive conversion itself is proven end-to-end, both sides, by
        //    corrosionToAcidicDecay.test.ts). Proving the emit-key (1, above) matches the
        //    population-key (2, here) is the point of this follow-up — without it, the SP-D gate
        //    would be inert forever even with live Acidic Decay entries present.
        const acidicDecayEntry: ActiveDoTStack = {
            stacks: 1,
            tier: 6,
            remainingRounds: 3,
            sourceId: 'caster',
            family: 'Acidic Decay',
            unremovable: true,
        };
        expect(dotFamilyCounts([acidicDecayEntry], [], [])).toEqual({ [gateKey!]: 1 });
    });

    // Verbatim from docs/ship-skills.csv (charge_skill_text field).
    const ANEMONE_CHARGE =
        'This Unit deals <unit-damage>200% damage</unit-damage> and inflicts <unit-skill>Corrosion III</unit-skill> for 2 turns. If the primary enemy has 3 or more Damage over Time effects, this Unit gains <unit-skill>Taunt</unit-skill> for 1 turn.';

    it('Anemone: "If the primary enemy has 3 or more Damage over Time effects, gains Taunt" is gated on a DoT-stack-count threshold', () => {
        const abilities = abilitiesFor(
            { chargeSkillText: ANEMONE_CHARGE, chargeSkillCharge: 3 },
            'charged'
        );
        const taunt = abilities.find(
            (a) => a.config.type === 'control' && a.config.effect === 'taunt'
        );
        // CLOSED (SP-D): countGateCondition now recognises "N or more Damage over Time effects"
        // and emits a real enemy-dot-count condition (no buffName — generic, sums all DoT
        // families) BEFORE detectGrantConditions' Taunt/Provoke self-status rule ever runs, so
        // the previously-spurious `{subject:'self-buff', buffName:'Taunt'}` artifact (matched
        // from the bare word "Taunt" in the granted-effect verb "gains Taunt") no longer appears
        // at all — countGateCondition returns early with the real gate instead.
        expect(
            taunt?.conditions.some((c) => c.subject === 'enemy-dot-count' && c.countThreshold === 3)
        ).toBe(true);
    });

    // Verbatim from docs/ship-skills.csv (second_passive_skill_text field).
    const SNAKEROOT_P2 =
        'This Unit deals <unit-damage>120% damage</unit-damage> for every 4 stacks of damage over time inflicted on to a single enemy.';

    it(
        'Snakeroot: "deals 120% damage for every 4 stacks of damage over time" is gated/scaled ' +
            'on the enemy-dot-count entry count (SP-D, PR-D3 — closed)',
        () => {
            const abilities = abilitiesFor({ secondPassiveSkillText: SNAKEROOT_P2 }, 'passive');
            // CLOSED: SP-D — attaches conditions+scaling directly to the same `type: 'damage'`
            // ability (the parseConditionalDamage precedent, buildShipAbilities.ts), zeroing the
            // base multiplier since the whole 120% IS the per-4-entries rate (0 entries → 0%
            // damage) — see src/utils/abilities/__tests__/snakerootScaling.test.ts for the full
            // build-output coverage (base-zeroing + perUnit=30 percentage-points-per-entry).
            const scaled = abilities.find(
                (a) =>
                    (a.config.type === 'damage' ||
                        a.config.type === 'modifier' ||
                        a.config.type === 'additional-damage') &&
                    a.scaling !== undefined
            );
            expect(scaled?.scaling).toBeDefined();
            expect(scaled!.conditions[scaled!.scaling!.conditionIndex].subject).toBe(
                'enemy-dot-count'
            );
        }
    );
});

describe('SP-E — DoT transforms & conversions', () => {
    // Verbatim from docs/ship-skills.csv (second_passive_skill_text field) — the SAME text as
    // SP-A's Voron probe (Task 2): split A+E. SP-A owns the "takes 20% less damage from Damage
    // over Time effects" reduction half; this probe owns ONLY the "transforms the damage into a
    // Damage over Time effect" conversion half. SP-A's reduction is only faithful once this
    // transform actually exists (today Voron never generates the DoT the reduction would apply
    // to), so the two halves are coupled even though each ships its own ability.
    // Text shared with the SP-A probe (VORON_PASSIVE2).
    const VORON_P2 = VORON_PASSIVE2;

    it('Voron: "transforms the damage into a Damage over Time effect" builds a reactive self-DoT transform', () => {
        const abilities = abilitiesFor({ secondPassiveSkillText: VORON_P2 }, 'passive');
        const transform = abilities.find((a) => a.config.type === 'transform-incoming-to-dot');
        expect(transform?.trigger).toBe('on-attacked');
        expect(transform?.target).toBe('self');
        expect(transform && 'turns' in transform.config && transform.config.turns).toBe(3);
    });

    // Verbatim from docs/ship-skills.csv (second_passive_skill_text field) — Orel's variant of
    // the SAME transform family, gated on the ATTACKER holding Taunt or Provoke.
    const OREL_P2 =
        'When directly damaged by an enemy effected by <unit-skill>Taunt</unit-skill> or <unit-skill>Provoke</unit-skill>, this unit transforms the damage into a <unit-skill>Damage over Time effect</unit-skill> for 3 turns.';
    it('Orel: transform is gated on the attacker being Taunted or Provoked', () => {
        const abilities = abilitiesFor({ secondPassiveSkillText: OREL_P2 }, 'passive');
        const transform = abilities.find((a) => a.config.type === 'transform-incoming-to-dot');
        expect(transform?.trigger).toBe('on-attacked');
        expect(transform?.target).toBe('self');
        expect(transform && 'condition' in transform.config && transform.config.condition).toBe(
            'attacker-taunted-or-provoke'
        );
    });

    // Verbatim from docs/ship-skills.csv (second_passive_skill_text field). NOTE: Belladonna also
    // appears in SP-D (Task 5) for the charge skill's "3+ Acidic Decay" count-gate clause — a
    // DISTINCT clause. This probe is ONLY the passive's Corrosion→Acidic Decay conversion.
    const BELLADONNA_P2 =
        'When an ally inflicts <unit-skill>Corrosion</unit-skill>, this Unit has a chance to convert the <unit-skill>Corrosion</unit-skill> into <unit-skill>Acidic Decay</unit-skill> of the same level, with the chance scaling at 1% per 10 Hacking.<br /><br />Upon converting <unit-skill>Corrosion</unit-skill>, this Unit extends the newly applied <unit-skill>Acidic Decay</unit-skill> status for 1 turn, with the chance to equal to its crit power.';

    it('Belladonna: "convert the Corrosion into Acidic Decay" rides the live ally-inflicts-debuff reactive trigger (SP-E, Task E4 — closed)', () => {
        const abilities = abilitiesFor({ secondPassiveSkillText: BELLADONNA_P2 }, 'passive');
        // Anchor by `buffName` across ALL `config.type` values — NOT restricted to
        // `config.type === 'debuff'` (review finding). SP-E's family is literally "DoT
        // transforms & conversions": the faithful fix RETYPED this ability away from the
        // generic auto-filled `'debuff'` config into a dedicated `'convert-dot'`
        // AbilityConfig. If the finder stayed pinned to `config.type === 'debuff'`, that
        // reshape would have made `.find()` return undefined FOREVER. `buffName` is carried
        // by the new `'convert-dot'` config too (src/types/abilities.ts), so it survives the
        // config reshape — mirrors the config-agnostic discipline the Voron probe above
        // already uses (asserts on the top-level `target` field, not `config.type`).
        const acidicDecay = abilities.find(
            (a) => 'buffName' in a.config && a.config.buffName === 'Acidic Decay'
        );
        // CLOSED (SP-E, Task E4): the bare, ungated auto-filled "Acidic Decay" debuff is now
        // replaced (buildShipAbilities.ts's mergeBuff) with a dedicated `'convert-dot'`
        // AbilityConfig riding the live `on-ally-debuff-inflicted` trigger — an EXPLICIT
        // trigger assignment for this enemy-target conversion case, alongside (not replacing)
        // Oleander's existing target==='ally'-only gate for its own buff-grant case. The
        // reactive `convert-dot` executor (triggers.ts) retags the ally's just-applied
        // Corrosion entries (family:'Acidic Decay', unremovable:true, same tier), gated
        // deterministically on the owner's live Hacking (1% per 10) via a RateGate, then
        // folds the paired crit-power duration extension (parseCritPowerExtend) into the same
        // executor — proven end-to-end (both directions) in corrosionToAcidicDecay.test.ts.
        // A Corrosion-specific filter is enforced at drain time (intent.eventCtx.dotType !==
        // cfg.fromDotType → no-op), so the widened routing does not over-fire on any other
        // ally-inflicted debuff/DoT.
        expect(acidicDecay?.trigger).toBe('on-ally-debuff-inflicted');
    });
});

describe('SP-F — deep one-offs', () => {
    // ── Part A: the two KNOWN SP-F ships (allowlist: instead-replacement / detonation +
    // debuff-duration-reduction) ──────────────────────────────────────────────────────

    // Verbatim from docs/ship-skills.csv (active_skill_text field).
    const PANON_ACTIVE =
        'This Unit grants all allies <unit-skill>Terran Guard II</unit-skill> for 2 turns and deals <unit-damage>80% damage</unit-damage> with an additional Damage equal to <unit-damage>70%</unit-damage> of its Defense.<br /><br />If this Unit is Provoked or Taunted, this Unit instead gains <unit-skill>Terran Guard III</unit-skill> for 2 turns and deals <unit-damage>120% damage</unit-damage> with an additional Damage equal to <unit-damage>90%</unit-damage> of its Defense.';

    it('Panon active: emits a gated replacement damage branch (120%/90%) when Provoked/Taunted', () => {
        const abilities = abilitiesFor({ activeSkillText: PANON_ACTIVE }, 'active');
        const dmg = abilities.filter((a) => a.config.type === 'damage');
        const add = abilities.filter((a) => a.config.type === 'additional-damage');
        // base + replacement of each
        expect(dmg).toHaveLength(2);
        expect(add).toHaveLength(2);
        const base = dmg.find((a) => (a.config as { multiplier: number }).multiplier === 80)!;
        const repl = dmg.find((a) => (a.config as { multiplier: number }).multiplier === 120)!;
        // replacement gated anyOf Taunt/Provoke
        expect(repl.conditions.some((c) => c.buffName === 'Taunt' && c.anyOf)).toBe(true);
        // base gated on BOTH absent (eq 0)
        expect(
            base.conditions.filter((c) => c.countComparator === 'eq' && c.countThreshold === 0)
        ).toHaveLength(2);
    });

    // Verbatim from docs/ship-skills.csv (charge_skill_text field) — the SAME "instead"
    // structure as the active skill above, on the charged skill (Barrier grant + 170%/130%).
    const PANON_CHARGED =
        'This Unit deals <unit-damage>140% damage</unit-damage> plus an additional <unit-damage>100%</unit-damage> of its Defense.<br /><br />If this Unit is affected by <unit-skill>Provoke</unit-skill> or <unit-skill>Taunt</unit-skill>, it instead gains <unit-skill>Barrier</unit-skill> for 1 hit and deals <unit-damage>170% damage</unit-damage> with an additional Damage equal to <unit-damage>130%</unit-damage> of its Defense.';

    it('Panon charged: emits a gated replacement damage branch (170%/130%) when Provoked/Taunted', () => {
        const abilities = abilitiesFor({ chargeSkillText: PANON_CHARGED }, 'charged');
        const dmg = abilities.filter((a) => a.config.type === 'damage');
        const add = abilities.filter((a) => a.config.type === 'additional-damage');
        // base + replacement of each
        expect(dmg).toHaveLength(2);
        expect(add).toHaveLength(2);
        const base = dmg.find((a) => (a.config as { multiplier: number }).multiplier === 140)!;
        const repl = dmg.find((a) => (a.config as { multiplier: number }).multiplier === 170)!;
        // replacement gated anyOf Taunt/Provoke
        expect(repl.conditions.some((c) => c.buffName === 'Taunt' && c.anyOf)).toBe(true);
        // base gated on BOTH absent (eq 0)
        expect(
            base.conditions.filter((c) => c.countComparator === 'eq' && c.countThreshold === 0)
        ).toHaveLength(2);
    });

    // Verbatim from docs/ship-skills.csv (charge_skill_text field). Lingshe's clause is a
    // CHARGED skill → slot 'charged' (not 'active').
    const LINGSHE_CHARGED =
        'This Unit reduces all <unit-skill>Bombs</unit-skill> on the enemy targets by 1 turn, <unit-skill>Bombs</unit-skill> reduced to 0 turns by this skill will detonate.<br />This reduction effect requires hacking.<br /><br />This Unit inflicts <unit-skill>Bomb III</unit-skill> for 3 turns.';

    it('Lingshe: charged "reduces all Bombs on the enemy targets by 1 turn ... will detonate" countdown-reduction rider builds a bomb-countdown-reduce ability alongside the Bomb III DoT-apply', () => {
        const abilities = abilitiesFor({ chargeSkillText: LINGSHE_CHARGED }, 'charged');
        // SP-F F3: the countdown-reduction sentence now builds a dedicated
        // `bomb-countdown-reduce` ability (all-enemies, hacking-gated at runtime via
        // `landsTimedEnemyApplicationLive('inflict')`), alongside the existing Bomb III
        // DoT-apply from the second sentence — so the array now has more than the lone
        // Bomb III entry it had before this task.
        expect(abilities.length).toBeGreaterThan(1);
        const reduce = abilities.find((a) => a.config.type === 'bomb-countdown-reduce');
        expect(reduce).toBeDefined();
        expect(reduce?.target).toBe('all-enemies');
        expect(reduce?.config).toMatchObject({ type: 'bomb-countdown-reduce', turns: 1 });
    });

    // ── Part B: discovery — 5 unpinned one-off mechanics, ship(s) identified by corpus
    // keyword search (docs/ship-skills.csv), cross-checked against `npm run audit:skills`
    // (0 findings — none of these mechanics trip the rule-based audit; confirmed genuinely
    // unpinned) and scripts/auditSkills.allowlist.ts (no existing entries for any of the five).
    // ──────────────────────────────────────────────────────────────────────────────────

    // overheal-redirect: NO CARRIER FOUND. Exhaustive keyword search across every text column
    // (overheal, excess heal/repair, heal/repair beyond|over|above max, redirect, spillover,
    // overflow, surplus, wasted heal, capped heal, heal-to-shield, repair-to-shield) turned up
    // no ship whose clause converts healing that would exceed max HP into a shield or any other
    // redirected effect. The closest false-hit was Hemlock's "Toxic Overflow" (a DoT name, not
    // an overheal mechanic) and Lionheart's "damage redirected through Protection" (a damage
    // -redirect shield-stack mechanic, unrelated to healing). DROPPED from SP-F — no probe.

    // defense-substitution — CARRIER: Meatshield (third_passive_skill_text, R4/refit-active;
    // second_passive_skill_text at R2 lacks the substitution sentence). Verbatim from
    // docs/ship-skills.csv.
    const MEATSHIELD_P4 =
        "At the start of combat, this Unit gains 3 stacks of <unit-skill>Protection</unit-skill>.<br /><br />Any damage this Unit takes from <unit-skill>Protection</unit-skill> is transformed into a <unit-aid>Damage over Time effect</unit-aid> for 2 turns.<br /><br />Any direct damage dealt to a non-defender ally that is not transferred by <unit-skill>Protection</unit-skill> is dealt as if that ally had this Unit's defense.";

    it('Meatshield: "dealt as if that ally had this Unit\'s defense" builds an ally-scoped defense-substitution ability (SP-F F5)', () => {
        const abilities = abilitiesFor({ thirdPassiveSkillText: MEATSHIELD_P4 }, 'passive');
        // SHIPPED: SP-F F5 (defense-substitution, approximation — Protection-transfer
        // itself stays deferred; see the docs/superpowers spec §6 and the
        // 'transform-incoming-to-dot' allowlist row below for the sibling DoT-transform
        // clause, which remains deliberately unmodelled). buildShipAbilities now emits a
        // dedicated `{ type: 'defense-substitution' }` config for this sentence, ally-
        // scoped (`target: 'all-allies'`) — distinct from the self-target
        // "gains 3 stacks of Protection" buff (auto-filled, recurring) that already built,
        // and from the still-unbuilt "damage taken from Protection transforms into a DoT"
        // sibling sentence (deliberately deferred — no assertion on it here).
        const substitution = abilities.filter(
            (a) =>
                a.config.type === 'defense-substitution' &&
                (a.target === 'ally' || a.target === 'all-allies')
        );
        expect(substitution).toHaveLength(1);
        expect(substitution[0].target).toBe('all-allies');
    });

    it('Meatshield refit-active passive emits a self-protection-redirect DoT transform', () => {
        const abilities = abilitiesFor({ thirdPassiveSkillText: MEATSHIELD_P4 }, 'passive');
        const transform = abilities.find((a) => a.config.type === 'transform-incoming-to-dot');
        expect(transform).toBeDefined();
        expect(transform?.config).toMatchObject({
            type: 'transform-incoming-to-dot',
            turns: 2,
            condition: 'self-protection-redirect',
        });
    });

    // forced-affinity — CARRIER: Wusheng (charge_skill_text) — the cleanest single-clause,
    // single-ship instance ("deals damage WITH affinity advantage", no team-composition
    // dependency). RELATED but NOT separately probed: Isha ("gains Offensive Affinity
    // Override" / "gains Defensive Affinity Override") and Nayra (the reciprocal grant, "if
    // Isha is on the same team, it also gains Offensive Affinity Override") carry the SAME
    // underlying gap (no engine consumption of an "Affinity Override" buff name anywhere in
    // src/utils/combat/*.ts's affinity-advantage/-disadvantage resolution), but as a two-ship,
    // team-composition-gated synergy rather than a one-off — out of scope for this probe, flagged
    // here for SP-F's awareness.
    const WUSHENG_CHARGED =
        'This Unit deals <unit-damage>220% damage</unit-damage> with affinity advantage and inflicts <unit-skill>Stasis</unit-skill> for 2 turns.';

    // CLOSED (SP-F F4): the parser now recognises "with affinity advantage" adjacent to the
    // <unit-damage> tag and sets `forceAffinityAdvantage: true` on the damage config. The three
    // affinity seams in playerTurn.ts (damage mult, crit cap/penalty, debuff-landing) read the
    // flag off the firing damage ability and locally force affinity ADVANTAGE for that cast and
    // its paired Stasis 'apply' landing. See forcedAffinityOverride.test.ts for the end-to-end
    // engine proof (advantage-level damage + un-penalty-capped crit + Stasis lands even at a real
    // disadvantage, player and enemy side).
    it('Wusheng: charged "deals 220% damage with affinity advantage" sets forceAffinityAdvantage on the damage config', () => {
        const abilities = abilitiesFor({ chargeSkillText: WUSHENG_CHARGED }, 'charged');
        const damage = abilities.find(
            (a) => a.config.type === 'damage' && a.config.multiplier === 220
        );
        expect(
            damage?.config.type === 'damage' && damage.config.forceAffinityAdvantage === true
        ).toBe(true);
    });

    // affinity-override (buff-driven, reciprocal) — CARRIERS: Isha + Nayra (second_passive,
    // R2/refit-active). Verbatim from docs/ship-skills.csv. These build the correct ability
    // SHAPE already (start-of-round self-buff grants + a reciprocal `ally-on-team` co-gate); the
    // SP-F F4 work is the ENGINE CONSUMPTION of those Override buff names at the affinity seams
    // + making `ally-on-team` a live roster check. Locked as regression guards on the shape; the
    // runtime override + reciprocal gate are proven in forcedAffinityOverride.test.ts.
    const ISHA_P2 =
        'At the start of the round this Unit gains <unit-skill>Offensive Affinity Override</unit-skill>.<br />If Nayra is on the same team, it also gains <unit-skill>Defensive Affinity Override</unit-skill>.';
    const NAYRA_P2 =
        'This Unit gains <unit-skill>Defensive Affinity Override</unit-skill> at the start of the round, and if Isha is on the same team, it also gains <unit-skill>Offensive Affinity Override</unit-skill>.';

    it('Isha: builds unconditional start-of-round Offensive Override + Nayra-gated Defensive Override', () => {
        const abilities = abilitiesFor({ secondPassiveSkillText: ISHA_P2 }, 'passive');
        const offensive = abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Offensive Affinity Override'
        );
        const defensive = abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Defensive Affinity Override'
        );
        expect(offensive?.trigger === 'start-of-round' && offensive.conditions.length === 0).toBe(
            true
        );
        expect(
            defensive?.trigger === 'start-of-round' &&
                defensive.conditions.some(
                    (c) => c.subject === 'ally-on-team' && c.buffName === 'Nayra'
                )
        ).toBe(true);
    });

    it('Nayra: builds unconditional start-of-round Defensive Override + Isha-gated Offensive Override', () => {
        const abilities = abilitiesFor({ secondPassiveSkillText: NAYRA_P2 }, 'passive');
        const defensive = abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Defensive Affinity Override'
        );
        const offensive = abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Offensive Affinity Override'
        );
        expect(defensive?.trigger === 'start-of-round' && defensive.conditions.length === 0).toBe(
            true
        );
        expect(
            offensive?.trigger === 'start-of-round' &&
                offensive.conditions.some(
                    (c) => c.subject === 'ally-on-team' && c.buffName === 'Isha'
                )
        ).toBe(true);
    });

    // charge-loss-immunity — CARRIER: Lev (second_passive_skill_text, R2/refit-active;
    // third_passive_skill_text is the CSV's literal "null" placeholder, i.e. no R4 passive
    // text exists for this ship). Verbatim from docs/ship-skills.csv.
    const LEV_P2 =
        "This Unit is immune to charge loss effects. This Unit's Crit Rate and Crit Power are increased by 20%.<br />This Unit gains 1 stack of <unit-skill>Blast</unit-skill> every turn.";

    it('Lev: "immune to charge loss effects" already sets ship.chargeLossImmune (FP — already modeled)', () => {
        // FALSE POSITIVE, not an SP-F gap: parseChargeLossImmune (skillTextParser.ts) +
        // buildShipAbilities' `chargeLossImmune` fold (buildShipAbilities.ts ~L2669-2674,
        // consumed by the engine as CombatActor.chargeLossImmune) already model this literal
        // phrase end to end. Dry-run confirmed `buildShipAbilities(...).chargeLossImmune ===
        // true` for this exact text. Locked as a regression guard, not wrapped in it.fails.
        const built = buildShipAbilities(ship({ secondPassiveSkillText: LEV_P2 }));
        expect(built.chargeLossImmune).toBe(true);
    });

    // on-ally-shield-destroyed — CARRIER: AEGIS (second_passive_skill_text, R2/refit-active;
    // third_passive_skill_text is the CSV's literal "null" placeholder). Verbatim from
    // docs/ship-skills.csv.
    const AEGIS_P2 =
        'This Unit grants <unit-skill>Defense Up II</unit-skill> for 1 turn and <unit-aid>cleanses all</unit-aid> debuffs when an ally within the Active pattern has their Shield destroyed.';

    // CLOSED (SP-F F2): both abilities now ride the live `on-ally-shield-destroyed` reactive
    // trigger, target:'ally' (routes to the ally whose shield was destroyed via
    // eventCtx.damagedAllyId; footprintFilteredRecipients then scopes it to AEGIS's Active
    // pattern). See onAllyShieldDestroyed.test.ts for the full engine-integration proof
    // (reaction fires, footprint-gated, team-symmetric).
    it('AEGIS: "when an ally ... has their Shield destroyed" rides the live on-ally-shield-destroyed trigger, target ally', () => {
        const abilities = abilitiesFor({ secondPassiveSkillText: AEGIS_P2 }, 'passive');
        expect(
            abilities.some((a) => a.trigger === 'on-ally-shield-destroyed' && a.target === 'ally')
        ).toBe(true);
    });
});

describe('SP-G — engine known-limitations', () => {
    // These six mechanics are ENGINE-TIMING limitations, not `buildShipAbilities` output gaps —
    // `buildShipAbilities` already emits the "faithful" ability shape (correct trigger, correct
    // config); the bug lives entirely in how the COMBAT ENGINE consumes that trigger at runtime
    // (drain ordering, eventCtx amount plumbing, missing recurring cadence, positional-path event
    // wiring). So none of these are `it.fails` build-proxy probes — each `it` below is a
    // KNOWN-LIMITATION MARKER: it asserts a real, CURRENTLY-TRUE fact about the production build
    // output (the shape SP-G will fix the CONSUMPTION of), and points at the actual integration
    // test where the limitation itself is pinned/exercised end-to-end. This mirrors the design
    // doc's guidance (`docs/superpowers/specs/2026-07-05-sp0-triage-design.md`, "SP-G
    // known-limitations": "the pin references the existing integration test rather than
    // duplicating it").

    // ── Cobalt: start-of-turn charge drain-ordering ─────────────────────────────────────
    // Verbatim from docs/ship-skills.csv (first_passive_skill_text field).
    const COBALT_P1_SPG =
        'This Unit <unit-aid>adds 1 charge</unit-aid> to its charged skill at the start of the turn if it is at full HP.';

    it('Cobalt: start-of-turn charge ability builds correctly; the KNOWN LIMITATION is the engine drain-ordering, not this shape', () => {
        const abilities = abilitiesFor({ firstPassiveSkillText: COBALT_P1_SPG }, 'passive');
        const charge = abilities.find((a) => a.type === 'charge' && a.trigger === 'start-of-turn');
        // TRUE TODAY: buildShipAbilities already resolves this clause into a self-target,
        // start-of-turn, full-HP-gated charge ability. See
        // src/utils/combat/__tests__/cobaltStartOfTurnCharge.integration.test.ts — its final
        // describe block ("Cobalt Out. Damage Up II — engine consumption (recurring; alternating
        // cadence pinned)") is the actual KNOWN-LIMITATION pin: the start-of-turn grant DRAINS
        // after the owner's own cast (not before), so a sibling start-of-turn buff on this same
        // passive boosts only every OTHER turn instead of every turn. That test explicitly says
        // "When the ordering fix lands, the alternation assertions below MUST flip to
        // every-turn — that is the point of pinning them." SP-G's job is that ordering fix;
        // this probe just anchors the ability shape the fix operates on.
        expect(charge).toBeDefined();
    });

    // ── FrontLine: charged-cast-reaction shield amount plumbing ─────────────────────────
    // SAME text as SP-B's FrontLine reactive-trigger FP probe above (that probe covers only the
    // trigger; this one covers only the shield's magnitude). Single-sourced via FRONTLINE_PASSIVE2.
    it('FrontLine: on-enemy-charged-cast shield ability builds; the KNOWN LIMITATION is its flat attack-basis amount, not the trigger', () => {
        const abilities = abilitiesFor({ secondPassiveSkillText: FRONTLINE_PASSIVE2 }, 'passive');
        const shieldReaction = abilities.find(
            (a) => a.type === 'shield' && a.trigger === 'on-enemy-charged-cast'
        );
        // TRUE TODAY: the reaction correctly rides on-enemy-charged-cast (SP-B's FP finding
        // above) and today builds as `config: { type: 'shield', basis: 'attack', pct: 24 }` — a
        // flat approximation of "gains a Shield equal to 30% of the damage dealt" (30% of the
        // clause's own 80%-damage hit ≈ 24% of attack), NOT the actual per-cast dealt amount. See
        // src/utils/combat/__tests__/enemyChargedCast.integration.test.ts, describe('FrontLine
        // damage+shield-on-enemy-charged (engine integration)'), it('the shield magnitude tracks
        // attack (basis attack × 24%): a 2× attack FrontLine yields ~2× shield') — that test pins
        // the CURRENT (limited) attack-proportional behaviour end to end. SP-G needs to plumb the
        // real eventCtx dealt-amount into the reactive-shield executor so the shield instead
        // tracks the ACTUAL damage dealt by this specific cast (which can diverge from a flat
        // attack% under crit, affinity, or incoming-amplification modifiers).
        expect(shieldReaction).toBeDefined();
    });

    // ── Meatshield / Kinetik / Cinya: recurring per-turn grants (no recurring trigger today) ──
    // Verbatim from docs/ship-skills.csv (first_passive_skill_text field, all three).
    const MEATSHIELD_P1_SPG =
        'At the start of combat, this Unit gains 3 stacks of <unit-skill>Protection</unit-skill>.';
    const KINETIK_P1_SPG =
        'This Unit gains a <unit-damage>Shield equal to 4%</unit-damage> of its Max HP every turn.';
    const CINYA_P1_SPG =
        'This Unit <unit-damage>repairs 3.5%</unit-damage> of its Max HP every turn.';

    it('Meatshield: "gains 3 stacks of Protection" is a one-time pre-combat grant (SP-G G1b)', () => {
        const abilities = abilitiesFor({ firstPassiveSkillText: MEATSHIELD_P1_SPG }, 'passive');
        const protection = abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Protection'
        );
        // SP-G G1b: a start-of-combat "N stacks" grant no longer climbs per-round — it seeds all
        // N stacks once at combat start. Pinned end-to-end by roundBoundaryTriggerConsistency.test.ts
        // ('Meatshield: start-of-combat Protection stacks → one-time pre-combat 3-stack grant').
        expect(protection?.trigger).toBe('pre-combat');
    });

    it('Kinetik: "gains a Shield ... every turn" rides start-of-turn (SP-G G1a)', () => {
        const abilities = abilitiesFor({ firstPassiveSkillText: KINETIK_P1_SPG }, 'passive');
        const shield = abilities.find((a) => a.type === 'shield');
        // SP-G G1a: detectEveryTurnTrigger routes the trailing "every turn" self-shield to the
        // start-of-turn LIVE trigger. Pinned end-to-end by roundBoundaryTriggerConsistency.test.ts
        // ('Kinetik / Cinya: "every turn" self shield/heal ride start-of-turn (SP-G G1a)').
        expect(shield?.trigger).toBe('start-of-turn');
    });

    it('Cinya: "repairs ... every turn" rides start-of-turn (SP-G G1a)', () => {
        const abilities = abilitiesFor({ firstPassiveSkillText: CINYA_P1_SPG }, 'passive');
        const heal = abilities.find((a) => a.type === 'heal');
        expect(heal?.trigger).toBe('start-of-turn');
    });

    // ── Butcher: positional-path Rage — SATISFIED by a positional integration pin (SP-G G4) ──
    // Butcher's "On inflicting a debuff, this Unit gains Marauder Rage II" (second_passive_skill_
    // text) has a build-output probe (buildShipAbilities.test.ts, "Butcher p2: remove Overload on
    // kill + Marauder Rage II on debuff-inflicted") AND a Channel-A integration pin
    // (overloadLifecycle.test.ts, "3. Butcher gains Marauder Rage II when it inflicts a debuff").
    // SP0 empirically found the reaction did NOT fire on the POSITIONAL two-team `simulateBattle`
    // path — a team-symmetry gap with no `buildShipAbilities`-observable proxy (the built ability
    // is byte-identical regardless of which engine channel consumes it).
    //
    // SP-G G4 ROOT-CAUSED and FIXED this: "On inflicting a debuff" was double-classified — promoted
    // to the on-debuff-inflicted TRIGGER (detectReactiveTrigger / APPLYING_DEBUFF_RE) AND, from the
    // same phrase, given a redundant `enemy-debuff` GATE condition (detectGrantConditions'
    // appliesDebuffGate). That `derivable:true` condition gates the reactive drain against the
    // enemy's LIVE debuff store — populated on the aggregate DPS path (shared enemy dummy) but NOT
    // positionally (DoTs live in per-victim stores) — so it silently blocked Marauder Rage II in
    // real team battles. The fix (buildShipAbilities.ts) drops the redundant `enemy-debuff`
    // condition when the trigger is on-debuff-inflicted (the trigger IS the gate — the exact
    // COLLISION-SCOPE pattern already used for on-enemy-buffed/enemy-buff).
    //
    // The Butcher SP-G marker is therefore satisfied by the new POSITIONAL-PATH integration pins
    // (overloadLifecycle.test.ts tests "3b" player-side + "3c" enemy-side team-symmetry) rather
    // than a corpus `it.fails` flip — there is nothing build-observable to assert here.
});

describe('confirm-GREEN-only — locked FPs', () => {
    // These mechanics stay allowlisted (NOT epic work) — they are data-layer facts or
    // harness/clause-scoping false positives, not `buildShipAbilities` gaps. Each `it` below is
    // a PLAIN green regression guard (not `it.fails`): if any of these goes RED, it is NOT an FP
    // — it is a real gap that must be pulled out and reassigned to a sub-project, not forced
    // green. Two mechanics from the allowlist (shield-penetration-innate × 10 ships, Nosorog
    // damage-reflection) have NO production probe here — see
    // `docs/model-completeness-triage-2026-07-05.md` for why (data-layer stat fill / harness-only
    // misfire, nothing for `buildShipAbilities` to assert on).

    // ── Asphodel: "always critical" is a data-layer fact (import sets crit 100%) ──────────
    // Verbatim from docs/ship-skills.csv (second_passive_skill_text field).
    const ASPHODEL_P2 =
        "This Unit's attacks are always critical and <unit-aid>adds 1 charge</unit-aid> to its Charged Skill after critically damaging an enemy.";

    it('Asphodel: "attacks are always critical" mints no phantom always-crit ability — only the self-crit-conditioned charge grant builds (FP: crit is a data-layer stat, not a parser flag)', () => {
        const abilities = abilitiesFor({ secondPassiveSkillText: ASPHODEL_P2 }, 'passive');
        // Dry-run confirmed: exactly ONE ability builds for this whole two-clause text — the
        // "adds 1 charge after critically damaging an enemy" grant, self-crit-conditioned. The
        // "attacks are always critical" clause mints NOTHING (no ability of any type carries an
        // always-crit/guaranteed-crit flag — verified no such field/type exists anywhere in
        // src/types/abilities.ts or buildShipAbilities.ts/skillTextParser.ts). This is correct:
        // the import pipeline sets this ship's `crit` stat to 100 directly (CritChance mapping,
        // see CLAUDE.md); a parser-minted always-crit modifier would double-count.
        expect(abilities).toHaveLength(1);
        expect(abilities[0].type).toBe('charge');
        expect(abilities[0].conditions).toEqual([{ subject: 'self-crit', derivable: true }]);
    });

    // ── Tormenter: "always lands critical hits" (same data-layer fact) + base-damage clause ──
    // Verbatim from docs/ship-skills.csv (second_passive_skill_text field).
    const TORMENTER_P2 =
        'This Unit always lands critical hits and gains up to <unit-damage>30% damage</unit-damage> reduction as its health decreases.';

    it('Tormenter: "always lands critical hits" mints no phantom always-crit ability — only the two hp-scaled incoming-reduction abilities build (FP: same data-layer fact as Asphodel)', () => {
        const abilities = abilitiesFor({ secondPassiveSkillText: TORMENTER_P2 }, 'passive');
        // Dry-run confirmed: exactly TWO abilities build (a 'direct'-scope and a 'dot'-scope
        // incoming-reduction, both carrying the same hpScaling) — nothing else. The "always
        // lands critical hits" clause contributes no third ability and no crit-flag field on
        // either of these two.
        expect(abilities.length).toBeGreaterThan(0);
        expect(abilities.every((a) => a.type === 'incoming-reduction')).toBe(true);
    });

    it('Tormenter: "gains up to 30% damage reduction as its health decreases" builds an hp-scaled incoming-reduction ability, not a phantom damage ability', () => {
        const abilities = abilitiesFor({ secondPassiveSkillText: TORMENTER_P2 }, 'passive');
        // FP (base-damage bucket): the clause is a self-mitigation stat modifier, not a damage
        // dealt to an enemy — buildShipAbilities correctly routes it onto the EXISTING
        // `incoming-reduction` ability type with an hpScaling rule (perUnit 0.3, cap 30 — i.e.
        // "up to 30%... as health decreases"), never as a `type: 'damage'` ability.
        const reduction = abilities.find(
            (a) => a.config.type === 'incoming-reduction' && a.config.hpScaling?.perUnit === 0.3
        );
        expect(reduction).toBeDefined();
        expect(abilities.every((a) => a.type !== 'damage')).toBe(true);
    });

    // ── Rikra: clause-scoping — the Taunt/Provoke gate scopes the damage bonus, not the buff ──
    // Verbatim from docs/ship-skills.csv (charge_skill_text field).
    const RIKRA_CHARGE =
        'This Unit gains <unit-skill>Defense Up II</unit-skill> for 2 turns, and deals <unit-damage>180% damage</unit-damage> with additional <unit-damage>80%</unit-damage> damage against Taunted or Provoked enemies.';

    it('Rikra: charged "gains Defense Up II ... deals 180% damage with additional 80% damage against Taunted or Provoked enemies" grants Defense Up II unconditionally — only the damage bonus is Taunt/Provoke-gated (FP: correct clause scoping)', () => {
        const abilities = abilitiesFor(
            { chargeSkillText: RIKRA_CHARGE, chargeSkillCharge: 2 },
            'charged'
        );
        const buff = abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Defense Up II'
        );
        // FP: "against Taunted or Provoked enemies" grammatically attaches only to the trailing
        // damage clause, not to the co-located "gains Defense Up II" grant earlier in the
        // sentence. buildShipAbilities scopes it correctly: the buff builds fully unconditional.
        expect(buff?.conditions).toEqual([]);
        const damage = abilities.find((a) => a.type === 'damage');
        expect(damage?.conditions.length).toBeGreaterThan(0);
    });

    // ── Madax: "while this Unit deals..." is simultaneity, not a gate on the buff ───────────
    // Verbatim from docs/ship-skills.csv (charge_skill_text field).
    const MADAX_CHARGE =
        "All allies are granted <unit-skill>Terran Bolster II</unit-skill> for 3 turns, while this Unit deals <unit-damage>130% damage</unit-damage>, including additional damage equal to <unit-damage>80%</unit-damage> of this Unit's Defense.";

    it('Madax: charged "All allies are granted Terran Bolster II for 3 turns, while this Unit deals 130% damage..." grants the buff unconditionally — "while" is simultaneity, not a gate (FP: correct clause scoping)', () => {
        const abilities = abilitiesFor(
            { chargeSkillText: MADAX_CHARGE, chargeSkillCharge: 4 },
            'charged'
        );
        const buff = abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Terran Bolster II'
        );
        // FP: "while this Unit deals..." describes two things happening AT THE SAME TIME (the
        // buff grant and the damage), not a conditional dependency of one on the other.
        // buildShipAbilities builds both fully unconditional — no spurious gate is minted.
        expect(buff?.conditions).toEqual([]);
        const damage = abilities.find((a) => a.type === 'damage');
        expect(damage?.conditions).toEqual([]);
    });

    // ── Oleander: "per debuffed enemy" scopes the repair, not the co-granted buff ───────────
    // Verbatim from docs/ship-skills.csv (active_skill_text field).
    const OLEANDER_ACTIVE =
        'This Unit grants <unit-skill>Hacking Up III</unit-skill> for 2 turns and <unit-damage>repairs 100%</unit-damage> of its Max HP, with an additional <unit-damage>8.5%</unit-damage> repair for each debuffed enemy.';

    it('Oleander: active "grants Hacking Up III ... repairs 100% of its Max HP, with an additional 8.5% repair for each debuffed enemy" scopes the per-debuffed-enemy scaling to the repair only — Hacking Up III builds ungated (FP: already modeled)', () => {
        const abilities = abilitiesFor({ activeSkillText: OLEANDER_ACTIVE }, 'active');
        const buff = abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Hacking Up III'
        );
        // FP: "with an additional 8.5% repair for each debuffed enemy" modifies only the
        // trailing "repairs 100%" clause, not the "grants Hacking Up III" buff earlier in the
        // sentence. buildShipAbilities already scopes the per-debuffed-enemy scaling onto the
        // heal ability alone; the buff builds fully unconditional (no spurious ungated-buff FP).
        expect(buff?.conditions).toEqual([]);
        const heal = abilities.find((a) => a.type === 'heal');
        expect(heal?.scaling?.perUnit).toBe(8.5);
        expect(heal?.conditions.some((c) => c.subject === 'enemy-debuff')).toBe(true);
    });

    // ── Valkyrie: the passive's "Echoing Burst explodes" REFERENCE is parser-guard-filtered ──
    // Verbatim from docs/ship-skills.csv (second_passive_skill_text field).
    const VALKYRIE_P2 =
        'This Unit gains <unit-skill>Speed Up II</unit-skill> for 1 turn at the start of the round.<br /><br />When an <unit-aid>Echoing Burst</unit-aid> explodes on an enemy, this Unit and the ally with the lowest current health percentage <unit-damage>repair 5%</unit-damage> of damage dealt.<br /><br />This Unit starts combat fully Charged.';

    it('Valkyrie: passive "When an Echoing Burst explodes on an enemy, ... repair 5% of damage dealt" does NOT mint a second accumulate-detonate application — it is a reactive heal off the existing on-bomb-detonated trigger (FP: parser-guard-filtered)', () => {
        const abilities = abilitiesFor({ secondPassiveSkillText: VALKYRIE_P2 }, 'passive');
        // FP: the passive merely REFERENCES an Echoing Burst detonating (to react with a heal);
        // it does not itself INFLICT Echoing Burst, so it must not mint its own
        // accumulate-detonate application. Dry-run confirmed: this text builds a start-of-round
        // Speed Up II buff plus two `on-bomb-detonated` heal reactions (ally + self) — no
        // accumulate-detonate ability anywhere in the passive slot.
        expect(abilities.length).toBeGreaterThan(0);
        expect(abilities.every((a) => a.type !== 'accumulate-detonate')).toBe(true);
        expect(abilities.filter((a) => a.trigger === 'on-bomb-detonated')).toHaveLength(2);
    });

    // Verbatim from docs/ship-skills.csv (charge_skill_text field).
    const VALKYRIE_CHARGE =
        "This Unit's attack ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill>, deals <unit-damage>240% damage</unit-damage>, and inflicts <unit-skill>Inc. Damage Up II</unit-skill> and <unit-skill>Echoing Burst</unit-skill> for 2 turns.";

    it('Valkyrie: charged "...inflicts Inc. Damage Up II and Echoing Burst for 2 turns" correctly builds the accumulate-detonate application (the ACTUAL inflict, distinct from the passive\'s mere reference above)', () => {
        const abilities = abilitiesFor(
            { chargeSkillText: VALKYRIE_CHARGE, chargeSkillCharge: 2 },
            'charged'
        );
        expect(abilities.some((a) => a.type === 'accumulate-detonate')).toBe(true);
    });
});
