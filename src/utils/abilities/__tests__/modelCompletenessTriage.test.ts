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

describe('SP-C — stat-comparison gates', () => {
    // Verbatim from docs/ship-skills.csv (charge_skill_text field).
    const BAYAH_CHARGE =
        'This Unit deals <unit-damage>150% damage</unit-damage> plus an additional amount equal to <unit-damage>30%</unit-damage> of its Defense and inflicts <unit-skill>Crit Rate Down II</unit-skill> for 2 turns. If this Unit has more Crit Power than the target, it inflicts <unit-skill>Stasis</unit-skill> for 1 turn.';

    it.fails(
        'Bayah: "If this Unit has more Crit Power than the target, inflicts Stasis" is not gated on a Crit Power comparison',
        () => {
            const abilities = abilitiesFor(
                { chargeSkillText: BAYAH_CHARGE, chargeSkillCharge: 2 },
                'charged'
            );
            const stasis = abilities.find(
                (a) => a.config.type === 'control' && a.config.effect === 'stasis'
            );
            // GAP: SP-C — no owner-vs-target stat-comparison ConditionSubject exists yet (verified:
            // `ConditionSubject` in src/types/abilities.ts has no "self stat greater than target
            // stat" literal; the nearest analogues, `OutgoingCondition['amplify-vs-higher-attack']`
            // and `HealAmpCondition['target-hp-below-self']`, are narrow single-purpose comparisons
            // wired only to the Giant Slayer implant / heal-amp seam, not a general gate usable
            // here). Today the Stasis inflict builds fully ungated (conditions: []). Proxy per the
            // decision rule: conditions.length, which is 0 now and must be >0 once SP-C models the
            // Crit-Power-vs-target gate.
            expect(stasis?.conditions.length).toBeGreaterThan(0);
        }
    );

    // Verbatim from docs/ship-skills.csv (active_skill_text field).
    const CHAKARA_ACTIVE =
        'This Unit deals <unit-damage>180% damage</unit-damage> with additional damage equal to <unit-damage>80%</unit-damage> of its Defense. If all damaged enemies have more Speed than this Unit, it <unit-aid>adds 1 charge</unit-aid> to its Charged Skill.';

    it.fails(
        'Chakara: "If all damaged enemies have more Speed than this Unit, adds 1 charge" is not gated on a Speed comparison',
        () => {
            const abilities = abilitiesFor({ activeSkillText: CHAKARA_ACTIVE }, 'active');
            const chargeGain = abilities.find((a) => a.config.type === 'charge');
            // GAP: SP-C — same missing-comparison-subject gap as Bayah, distinct proxy: this charge
            // grant already carries a condition, but it's the default unconditional annotation
            // (subject: 'always', derivable: true) applied to every auto-filled ability, NOT the
            // "enemies have more Speed than this Unit" comparison from the clause. Proxy: assert a
            // NON-'always' condition subject is present, false now (only 'always' present), true
            // once SP-C adds the real Speed-comparison subject.
            expect(chargeGain?.conditions.some((c) => c.subject !== 'always')).toBe(true);
        }
    );

    // Verbatim from docs/ship-skills.csv (active_skill_text field). NOTE: Cobalt also appears in
    // SP-G (Task 8) for its passive "adds 1 charge ... at the start of the turn if it is at full
    // HP" start-of-turn charge drain-ordering clauses — a DISTINCT engine-timing limitation. This
    // probe is ONLY the active skill's owner-vs-target HP comparison.
    const COBALT_ACTIVE =
        "This Unit purges <unit-aid>1 buff</unit-aid> from the enemy and deals <unit-damage>200% damage</unit-damage>. If this Unit has more HP than the enemy, it additionally deals <unit-damage>damage equal to 25%</unit-damage> of this Unit's max HP.";

    it.fails(
        'Cobalt: "If this Unit has more HP than the enemy, deals additional damage equal to 25% of max HP" is not gated on an HP comparison',
        () => {
            const abilities = abilitiesFor({ activeSkillText: COBALT_ACTIVE }, 'active');
            const bonusDamage = abilities.find(
                (a) =>
                    a.config.type === 'additional-damage' &&
                    a.config.stat === 'hp' &&
                    a.config.pct === 25
            );
            // GAP: SP-C — same missing-comparison-subject gap as Bayah/Chakara. Today the 25%-max-HP
            // additional-damage ability builds fully ungated (conditions: []). Proxy: conditions.length,
            // 0 now, must be >0 once SP-C models the owner-HP-vs-target-HP gate. Distinct from the
            // SP-G start-of-turn full-HP self-check on this same ship's passives (a self-only
            // threshold, not an owner-vs-target comparison) — no overlap in mechanism.
            expect(bonusDamage?.conditions.length).toBeGreaterThan(0);
        }
    );
});

describe('SP-D — count-based gates', () => {
    // Verbatim from docs/ship-skills.csv (second_passive_skill_text field). NOTE: CSV typo
    // "3 ore more" preserved verbatim (not "or more").
    const BERSERKER_P2 =
        'This Unit gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns when hitting 3 ore more enemies.';

    it.fails(
        'Berserker: "gains Marauder Rage II when hitting 3 ore more enemies" is not gated on a hit-count threshold',
        () => {
            const abilities = abilitiesFor({ secondPassiveSkillText: BERSERKER_P2 }, 'passive');
            const rageBuff = abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Marauder Rage II'
            );
            // GAP: SP-D — no hit-count ConditionSubject exists (verified: ConditionSubject in
            // src/types/abilities.ts has no "N enemies hit this cast" literal). Today the
            // Marauder Rage II grant builds fully ungated (conditions: []). Proxy per the
            // decision rule: conditions.length, 0 now, must be >0 once SP-D models the
            // "hitting 3+ enemies" gate.
            expect(rageBuff?.conditions.length).toBeGreaterThan(0);
        }
    );

    // Verbatim from docs/ship-skills.csv (active_skill_text field).
    const TYGR_ACTIVE =
        'This Unit deals <unit-damage>180% damage</unit-damage> and inflicts <unit-skill>Security Down II</unit-skill> for 2 turns. If it damages 2 or more enemies, it adds <unit-aid>adds 1 charge</unit-aid> to its Charged Skill.';

    it.fails(
        'Tygr: "If it damages 2 or more enemies, adds 1 charge" is not gated on an actual ≥2 hit-count threshold',
        () => {
            const abilities = abilitiesFor({ activeSkillText: TYGR_ACTIVE }, 'active');
            const chargeGain = abilities.find((a) => a.config.type === 'charge');
            // GAP: SP-D — dry-run curiosity, NOT a clean FP: classifyChargeCondition
            // (skillTextParser.ts, matching literal "damages 2") already attaches a non-default
            // `enemy-adjacent` condition here, reusing the splash-adjacency count as a coarse
            // presence-only proxy for "hit multiple enemies" — so the naive "a non-'always'
            // subject is present" proxy (the one used for Chakara/Cobalt in SP-C) is ALREADY
            // TRUE today and would be a trivially-true trap if used here. Neither call site that
            // emits 'enemy-adjacent' (skillTextParser.ts) ever sets countComparator/countThreshold
            // — so today ANY adjacent enemy satisfies the gate (presence, count>0), not the
            // clause's actual "2 or more". Proxy: countThreshold on the condition, undefined now,
            // must be set once SP-D models the real ≥N hit-count threshold.
            // ASSUMPTION: `.find()` takes the first non-'always' condition — valid only if SP-D
            // augments this existing single condition in place (sets countThreshold on it) rather
            // than appending a second condition object. The charge-condition slot is single-
            // condition today (in-place augmentation is the natural extension), so risk is low,
            // but an append-a-second-condition fix would leave this `.find()` still pointing at
            // the untouched original and the proxy would never flip.
            const cond = chargeGain?.conditions.find((c) => c.subject !== 'always');
            expect(cond?.countThreshold).toBeDefined();
        }
    );

    // Verbatim from docs/ship-skills.csv (charge_skill_text field). NOTE: Belladonna also
    // appears in SP-E (Task 6) for its passive "convert Corrosion into Acidic Decay" clause —
    // a DISTINCT clause. This probe is ONLY the charge skill's Acidic-Decay-count → Stasis gate.
    const BELLADONNA_CHARGE =
        'This Unit deals <unit-damage>180% damage</unit-damage> and inflicts <unit-skill>Corrosion II</unit-skill> for 2 turns.<br />If the enemy has 3 or more <unit-skill>Acidic Decay</unit-skill>, inflict <unit-skill>Stasis</unit-skill> for 1 turn.';

    it.fails(
        'Belladonna: "If the enemy has 3 or more Acidic Decay, inflict Stasis" is not gated on a named-DoT-stack-count threshold',
        () => {
            const abilities = abilitiesFor(
                { chargeSkillText: BELLADONNA_CHARGE, chargeSkillCharge: 3 },
                'charged'
            );
            const stasis = abilities.find(
                (a) => a.config.type === 'control' && a.config.effect === 'stasis'
            );
            // GAP: SP-D — no named-DoT-stack-count ConditionSubject exists (verified:
            // countGateCondition in skillTextParser.ts only recognises the literal words
            // "buffs?"/"debuffs?" in its count-threshold regexes — "Acidic Decay" never matches,
            // so this clause reaches no count-gate classifier at all). Today the Stasis inflict
            // builds fully ungated (conditions: []). Proxy: conditions.length, 0 now, must be
            // >0 once SP-D models the "3+ Acidic Decay stacks on target" gate.
            expect(stasis?.conditions.length).toBeGreaterThan(0);
        }
    );

    // Verbatim from docs/ship-skills.csv (charge_skill_text field).
    const ANEMONE_CHARGE =
        'This Unit deals <unit-damage>200% damage</unit-damage> and inflicts <unit-skill>Corrosion III</unit-skill> for 2 turns. If the primary enemy has 3 or more Damage over Time effects, this Unit gains <unit-skill>Taunt</unit-skill> for 1 turn.';

    it.fails(
        'Anemone: "If the primary enemy has 3 or more Damage over Time effects, gains Taunt" is not gated on a DoT-stack-count threshold',
        () => {
            const abilities = abilitiesFor(
                { chargeSkillText: ANEMONE_CHARGE, chargeSkillCharge: 3 },
                'charged'
            );
            const taunt = abilities.find(
                (a) => a.config.type === 'control' && a.config.effect === 'taunt'
            );
            // GAP: SP-D — dry-run curiosity, NOT a clean ungated-array case: this ability already
            // carries ONE condition, `{ subject: 'self-buff', buffName: 'Taunt', derivable: true }`
            // — but that is a SPURIOUS artifact of an unrelated detector (skillTextParser.ts's
            // Taunt/Provoke self-status rule matches the bare word "Taunt" anywhere in the
            // sentence, including in the granted-effect verb "gains Taunt", not just in an actual
            // "if this Unit is Taunted" gate). It has nothing to do with the "3+ Damage over Time
            // effects on the primary enemy" count clause, which no ConditionSubject models today
            // (verified against the full ConditionSubject union). Proxy: a condition whose subject
            // is something OTHER than that spurious 'self-buff' entry — false now (only the
            // spurious one is present), true once SP-D adds the real DoT-count gate (regardless
            // of whether the spurious entry is also cleaned up).
            expect(taunt?.conditions.some((c) => c.subject !== 'self-buff')).toBe(true);
        }
    );

    // Verbatim from docs/ship-skills.csv (second_passive_skill_text field).
    const SNAKEROOT_P2 =
        'This Unit deals <unit-damage>120% damage</unit-damage> for every 4 stacks of damage over time inflicted on to a single enemy.';

    it.fails(
        'Snakeroot: "deals 120% damage for every 4 stacks of damage over time" is not gated/scaled on a DoT-stack count',
        () => {
            const abilities = abilitiesFor({ secondPassiveSkillText: SNAKEROOT_P2 }, 'passive');
            // GAP: SP-D — this is a per-stack SCALING gate, not a binary threshold: `scaling`
            // (ScalingRule: `{ conditionIndex, perUnit, cap? }`, a top-level Ability field) is
            // the EXISTING type-valid mechanism for this shape (used by the self-crit-power/
            // enemy-stealth-count/conditional-damage scaling sources). It requires BOTH a
            // DoT-stack-count Condition (which does not exist — same gap as Belladonna/Anemone)
            // AND a `scaling` rule referencing it. Today the sole ability this clause builds is
            // flat: `type: 'damage'`, `config.multiplier: 120`, no `scaling` field at all
            // (verified via dry-run dump of buildShipAbilities' output for this text — one
            // ability, no scaling). NOT matched on `multiplier === 120`: the faithful fix may
            // either (a) attach conditions+scaling directly to this same `type: 'damage'`
            // ability — the parseConditionalDamage precedent (buildShipAbilities.ts ~L1186) — or
            // (b) reshape the clause into a `type: 'modifier'` ability with a 0 base value and
            // `scaling.perUnit` carrying the 120 (the "X% (more) damage for each <thing>"
            // convention, buildShipAbilities.ts ~L403-420); either shape keeps `scaling` as a
            // top-level Ability field, so the proxy below is flip-valid under both. Proxy:
            // any damage/modifier/additional-damage-typed ability with `.scaling` defined —
            // false now (no ability here has `.scaling`), true once SP-D models the "per 4 DoT
            // stacks on target" scaling gate regardless of which of the two shapes it lands on.
            const scaled = abilities.find(
                (a) =>
                    (a.config.type === 'damage' ||
                        a.config.type === 'modifier' ||
                        a.config.type === 'additional-damage') &&
                    a.scaling !== undefined
            );
            expect(scaled).toBeDefined();
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
    const VORON_P2 =
        'When directly damaged, this Unit transforms the damage into a <unit-skill>Damage over Time effect</unit-skill> lasting for 3 turns.<br /><br />This Unit takes <unit-damage>20% less damage</unit-damage> from <unit-skill>Damage over Time effects</unit-skill>.';

    it.fails(
        'Voron: "transforms the damage into a Damage over Time effect" builds a reactive self-DoT conversion',
        () => {
            const abilities = abilitiesFor({ secondPassiveSkillText: VORON_P2 }, 'passive');
            // GAP: SP-E — dry-run confirmed: today the WHOLE passive slot builds NO abilities at
            // all for this text (same empty-array finding SP-A's probe already made), so neither
            // half of the clause exists yet. No damage-to-DoT transform/conversion config exists
            // in AbilityConfig (verified against the full union in src/types/abilities.ts) — and
            // the clause names no specific DoT family (unlike Corrosion/Inferno/Bomb), so the
            // existing `{ type: 'dot'; dotType: DoTType; ... }` shape (DoTType is only
            // 'corrosion' | 'inferno' | 'bomb') cannot represent it without SP-E ALSO widening
            // DoTType — a shape we can't predict or assert on today. What IS certain regardless of
            // that shape choice: this is a REACTIVE conversion fired when Voron itself takes
            // damage, applied to ITSELF — i.e. it must ride the EXISTING, already-wired
            // `on-attacked` trigger (used throughout buildShipAbilities.ts for every "when
            // directly damaged" passive reaction: Stalwart's counter, Cultivator's heal,
            // Purifier's cleanse) with `target: 'self'`. This is distinct from SP-A's reduction
            // (a passive stat modifier, `trigger: 'on-cast'`, per the existing incoming-reduction
            // build sites at buildShipAbilities.ts ~L2082-2117) and from the `counter` ability
            // shape (also `on-attacked` but `target: 'enemy'`) — so the proxy below cannot be
            // trivially satisfied by either sibling mechanic landing first. Proxy: an ability with
            // `trigger === 'on-attacked' && target === 'self'` — false now (array is empty), true
            // once SP-E's transform ships, survives whatever config.type/DoTType shape it lands on.
            expect(abilities.some((a) => a.trigger === 'on-attacked' && a.target === 'self')).toBe(
                true
            );
        }
    );

    // Verbatim from docs/ship-skills.csv (second_passive_skill_text field). NOTE: Belladonna also
    // appears in SP-D (Task 5) for the charge skill's "3+ Acidic Decay" count-gate clause — a
    // DISTINCT clause. This probe is ONLY the passive's Corrosion→Acidic Decay conversion.
    const BELLADONNA_P2 =
        'When an ally inflicts <unit-skill>Corrosion</unit-skill>, this Unit has a chance to convert the <unit-skill>Corrosion</unit-skill> into <unit-skill>Acidic Decay</unit-skill> of the same level, with the chance scaling at 1% per 10 Hacking.<br /><br />Upon converting <unit-skill>Corrosion</unit-skill>, this Unit extends the newly applied <unit-skill>Acidic Decay</unit-skill> status for 1 turn, with the chance to equal to its crit power.';

    it.fails(
        'Belladonna: "convert the Corrosion into Acidic Decay" does not ride the live ally-inflicts-debuff reactive trigger',
        () => {
            const abilities = abilitiesFor({ secondPassiveSkillText: BELLADONNA_P2 }, 'passive');
            const acidicDecay = abilities.find(
                (a) => a.config.type === 'debuff' && a.config.buffName === 'Acidic Decay'
            );
            // GAP: SP-E — dry-run: today this clause auto-fills a bare, UNGATED "Acidic Decay"
            // debuff-application ability (trigger 'on-cast', conditions: []) — a spurious
            // artifact of the generic buff/debuff-name auto-fill picking up "Acidic Decay" from
            // the text, unconnected to the ally's Corrosion cast. No 'convert'/'transform'
            // AbilityConfig exists (verified against the full union). The live, already-wired
            // `on-ally-debuff-inflicted` trigger (Oleander's ally-target RoT grant,
            // buildShipAbilities.ts ~L2351-2362) is EXACTLY this "when an ally inflicts a debuff"
            // phrasing family — but its gate is hardcoded to `target === 'ally' && config.type ===
            // 'buff'`, and the code's own comment there calls out "Provider's enemy-target Crit
            // Rate Down II counter-debuff in the same phrasing family stays on-cast (a deferred
            // deep one-off)" — Belladonna's enemy-target 'debuff' config is that exact same
            // deferred case. Proxy: the Acidic Decay ability's trigger equals the EXISTING literal
            // 'on-ally-debuff-inflicted' — false now ('on-cast'), true once SP-E widens that gate
            // to cover enemy-target debuff conversions too.
            expect(acidicDecay?.trigger).toBe('on-ally-debuff-inflicted');
        }
    );
});
