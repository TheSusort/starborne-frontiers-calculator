/**
 * Phase 3 reactive-trigger promotion — TRIAGE PROBE CORPUS (PR0).
 *
 * One probe per family-C ship, routed through the REAL production path (buildShipAbilities)
 * with skill text copied VERBATIM from docs/ship-skills.csv (parser source of truth).
 *
 * GREEN = the reactive effect is already correctly triggered → the sweep finding was a false
 * positive (locked here as a regression guard). RED = a real gap; the matching cluster fix-PR
 * flips it green. Red probes are INTENTIONAL and committed — a red CI is accepted until Phase 3
 * completes (no deploy before then). Each red probe carries a `// GAP:` comment naming its bucket.
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

// Cluster describe-blocks are appended by Tasks 2–9.

describe('Phase 3 reactive-trigger triage — corpus scaffold', () => {
    it('abilitiesFor helper is available', () => {
        expect(typeof abilitiesFor).toBe('function');
    });
});

// ─── Task 2 / Cluster 1 — on-attacked ───────────────────────────────────────────────────────
//
// Bizon, Purifier, Quixilver, Iridium, Malvex, Warden, Nyxen, Sansi, Panguan. Every text below
// is copied VERBATIM from docs/ship-skills.csv's first_passive_skill_text column (parser source
// of truth). Each probe was first run with a console.log of the raw abilities array (per the
// task's ambiguity clause) to confirm the actual ability `type` before asserting — several
// ships' real ability shape differs from the task brief's illustrative text (see report).
describe('cluster 1 — on-attacked', () => {
    // Bizon's passive is a self-BUFF grant (XAOC Swiftness II), NOT a damage ability as the task
    // brief's illustrative example text assumed — confirmed via buildShipAbilities output.
    const BIZON_PASSIVE =
        'Upon receiving direct Damage, this Unit gains <unit-skill>XAOC Swiftness II</unit-skill> for 1 turn.';

    it('Bizon: "upon receiving direct Damage" self-buff rides on-attacked', () => {
        const abilities = abilitiesFor({ firstPassiveSkillText: BIZON_PASSIVE }, 'passive');
        const buff = abilities.find((a) => a.type === 'buff');
        expect(buff?.trigger).toBe('on-attacked');
        // GAP: tag-only — detectDamageReactionTrigger's DR_DIRECT_DAMAGE_RE only recognizes
        // "when (this Unit is) directly damaged" / "when attacked"; Bizon's "Upon receiving
        // direct Damage" phrasing isn't matched, so the buff-grant machinery (proven live by
        // Panguan below) falls through and the ability keeps the default on-cast trigger.
    });

    const PURIFIER_PASSIVE =
        'This Unit <unit-aid>cleanses 1</unit-aid> debuff when directly damaged.';

    it('Purifier: cleanse-on-hit rides on-attacked', () => {
        const abilities = abilitiesFor({ firstPassiveSkillText: PURIFIER_PASSIVE }, 'passive');
        const cleanse = abilities.find((a) => a.type === 'cleanse');
        expect(cleanse?.trigger).toBe('on-attacked');
        // GAP: tag-only — the cleanse builder (buildShipAbilities.ts ~1411) only derives a
        // reaction trigger for the crit-repair phrasing; a direct-damage cleanse has no
        // reaction wiring at all and stays on-cast.
    });

    const QUIXILVER_PASSIVE =
        'This Unit gains <unit-damage>Shield equal to 25%</unit-damage> of the damage taken when taking HP damage and still having Shield.';

    it('Quixilver: damage-taken leech shield with the requiresHpDamage punch-through gate (FP — engine-modeled)', () => {
        const abilities = abilitiesFor({ firstPassiveSkillText: QUIXILVER_PASSIVE }, 'passive');
        const shield = abilities.find((a) => a.type === 'shield');
        // FP (re-classified PR-A): NOT a trigger gap. This is a `damage-taken` leech shield the
        // engine procs per enemy attack via its dedicated leech block (engine.ts ~2627/2887),
        // which IGNORES the ability trigger. The "when taking HP damage and still having Shield"
        // clause is modeled by requiresHpDamage (punch-through gate — leech.test.ts locks it).
        // Promoting the trigger to on-attacked would partition it OFF the leech path onto the
        // reactive path (no requiresHpDamage gate there), REGRESSING behavior — so it correctly
        // stays on-cast at the model level. The lock asserts the leech modeling instead.
        expect(shield?.config).toMatchObject({ basis: 'damage-taken', requiresHpDamage: true });
        expect(shield?.trigger).toBe('on-cast');
    });

    const IRIDIUM_PASSIVE =
        'When directly damaged, This Unit <unit-aid>purges 1</unit-aid> buff from the enemy and inflicts <unit-skill>Speed Down I</unit-skill> for 1 turn.';

    it('Iridium: purge + debuff on direct-damage already ride on-attacked (FP regression lock)', () => {
        const abilities = abilitiesFor({ firstPassiveSkillText: IRIDIUM_PASSIVE }, 'passive');
        const purge = abilities.find((a) => a.type === 'purge');
        const debuff = abilities.find((a) => a.type === 'debuff');
        expect(purge?.trigger).toBe('on-attacked');
        expect(debuff?.trigger).toBe('on-attacked');
    });

    const MALVEX_PASSIVE =
        'When directly damaged as a primary target, this Unit gains <unit-damage>Shield equal to 15%</unit-damage> of the Damage dealt to them.';

    it('Malvex: damage-taken leech shield (FP — engine-modeled, same leech path as Quixilver)', () => {
        const abilities = abilitiesFor({ firstPassiveSkillText: MALVEX_PASSIVE }, 'passive');
        const shield = abilities.find((a) => a.type === 'shield');
        // FP (re-classified PR-A): same as Quixilver — a `damage-taken` leech shield procced per
        // attack by the engine's leech block ("15% of the Damage dealt to them"; leech.test.ts
        // locks it), NOT a trigger gap. No "still having Shield" clause, so no requiresHpDamage
        // gate. Trigger stays on-cast (leech path ignores it); promoting it would regress.
        expect(shield?.config).toMatchObject({ basis: 'damage-taken' });
        expect(shield?.config).not.toHaveProperty('requiresHpDamage');
        expect(shield?.trigger).toBe('on-cast');
    });

    const WARDEN_PASSIVE =
        'When directly damaged, this Unit inflicts <unit-skill>Corrosion I</unit-skill> for 2 turns on that enemy and repairs itself 3% of its Max HP.';

    it('Warden: debuff + self-heal on direct-damage already ride on-attacked (FP regression lock)', () => {
        const abilities = abilitiesFor({ firstPassiveSkillText: WARDEN_PASSIVE }, 'passive');
        const debuff = abilities.find((a) => a.type === 'debuff');
        const heal = abilities.find((a) => a.type === 'heal');
        expect(debuff?.trigger).toBe('on-attacked');
        expect(heal?.trigger).toBe('on-attacked');
    });

    const NYXEN_PASSIVE =
        'This Unit deals <unit-damage>100% damage</unit-damage> when its Shield is directly damaged.';

    it('Nyxen: shield-hit counter-damage already rides on-attacked (FP regression lock)', () => {
        const abilities = abilitiesFor({ firstPassiveSkillText: NYXEN_PASSIVE }, 'passive');
        const counter = abilities.find((a) => a.type === 'counter');
        expect(counter?.trigger).toBe('on-attacked');
    });

    const SANSI_PASSIVE =
        'When hit, this Unit inflicts <unit-skill>Inc. Repair Down III</unit-skill> for 1 turn.';

    it('Sansi: "when hit" debuff rides on-attacked', () => {
        const abilities = abilitiesFor({ firstPassiveSkillText: SANSI_PASSIVE }, 'passive');
        const debuff = abilities.find((a) => a.type === 'debuff');
        expect(debuff?.trigger).toBe('on-attacked');
        // GAP: tag-only — detectDamageReactionTrigger's DR_DIRECT_DAMAGE_RE recognizes
        // "when (this Unit is) directly damaged" / "when attacked" but not bare "when hit";
        // same reaction machinery as Warden above, just a narrower regex.
    });

    const PANGUAN_PASSIVE =
        'This Unit Gains <unit-skill>Stealth</unit-skill> for 2 turns when directly damaged.';

    it('Panguan: self-buff on direct-damage already rides on-attacked (FP regression lock)', () => {
        const abilities = abilitiesFor({ firstPassiveSkillText: PANGUAN_PASSIVE }, 'passive');
        const buff = abilities.find((a) => a.type === 'buff');
        expect(buff?.trigger).toBe('on-attacked');
    });
});

// ─── cluster 2 — on-enemy-repaired ──────────────────────────────────────────────────────────
describe('cluster 2 — on-enemy-repaired', () => {
    const RUINER_P2 =
        'This Unit inflicts <unit-skill>Bomb II</unit-skill> for 2 turns on any enemy performing a <unit-aid>repair</unit-aid>, once per round per enemy.';

    it('Ruiner: Bomb-on-enemy-repair debuff rides on-enemy-repaired', () => {
        const ab = abilitiesFor({ firstPassiveSkillText: RUINER_P2 }, 'passive');
        expect(ab.some((a) => a.type === 'debuff' && a.trigger === 'on-enemy-repaired')).toBe(true);
        // GAP: needs-capture (detector-recognition) — the passive emits NO ability at all; the
        // "on any enemy performing a repair" phrasing is unrecognized. Trigger on-enemy-repaired
        // + eventCtx.repairerId already exist (Zosimos), so the fix is parser recognition +
        // routing the Bomb to the repairer; the "once per round per enemy" cap keys owner:ability:repairerId.
    });
});

// ─── cluster 3 — on-ally-debuff-inflicted ───────────────────────────────────────────────────
describe('cluster 3 — on-ally-debuff-inflicted', () => {
    const OLEANDER_P3 =
        "When an ally inflicts a debuff, this Unit <unit-aid>adds 1 charge</unit-aid> to it's Charged Skill and then, once per ally per round, grants <unit-skill>Repair Over Time II</unit-skill> to that Ally for 2 turns.";

    it('Oleander: per-ally RoT grant rides on-ally-debuff-inflicted (charge half already does)', () => {
        const ab = abilitiesFor({ firstPassiveSkillText: OLEANDER_P3 }, 'passive');
        const buff = ab.find((a) => a.type === 'buff' && a.target === 'ally');
        expect(buff?.trigger).toBe('on-ally-debuff-inflicted');
        // GAP: needs-capture — the charge half ALREADY rides on-ally-debuff-inflicted, but the
        // "grants RoT to that Ally" buff stays on-cast. on-ally-debuff-inflicted fires but captures
        // no ally id (triggers.ts:365-378), so "that Ally" can't be routed. Add which-ally capture
        // off the repairedAllyIds precedent; per-ally cap keys owner:ability:allyId.
    });
});

// ─── cluster 4 — on-enemy-buffed (event correction: NOT on-enemy-cleansed) ───────────────────
describe('cluster 4 — on-enemy-buffed (Nuqtu)', () => {
    const NUQTU_P2 =
        'This Unit <unit-aid>Cleanses 1</unit-aid> debuff from itself (once per round) and gains <unit-skill>Terran Bolster III</unit-skill> for 1 turn when an enemy gets buffed.';

    it('Nuqtu: self-cleanse + self-buff ride the "enemy gets buffed" reactive trigger, not on-cast', () => {
        const ab = abilitiesFor({ firstPassiveSkillText: NUQTU_P2 }, 'passive');
        const cleanse = ab.find((a) => a.type === 'cleanse');
        expect(cleanse?.trigger).not.toBe('on-cast');
        // GAP: needs-capture (NEW event) — the sweep filed Nuqtu under on-enemy-cleansed, but the
        // real clause is "when an enemy gets buffed". No on-enemy-buffed trigger exists in the
        // AbilityTrigger union, and there is no buff-applied CombatEvent (only debuff-applied). Fix
        // needs a new event + trigger. Both the cleanse and the Terran-Bolster buff (self-target,
        // once-per-round) hang off it.
    });
});

// ─── cluster 5 — on-enemy-destroyed / on-kill ───────────────────────────────────────────────
describe('cluster 5 — on-enemy-destroyed / on-kill', () => {
    const HARVESTER_P2 =
        'When an allied Unit is destroyed, this Unit gains 1 extra end of round action.';
    it('Harvester: extra-action on ally-destroyed already rides on-ally-destroyed (FP lock)', () => {
        const ab = abilitiesFor({ firstPassiveSkillText: HARVESTER_P2 }, 'passive');
        const ea = ab.find((a) => a.type === 'extra-action');
        expect(ea?.trigger).toBe('on-ally-destroyed');
    });

    const RAVAGER_P2 =
        'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and, upon killing an enemy, loses <unit-skill>Overload</unit-skill> and gains <unit-skill>Marauder Rage III</unit-skill> for 3 turns.';
    it('Ravager: Overload kill-reset buff already rides on-enemy-destroyed (FP lock)', () => {
        const ab = abilitiesFor({ firstPassiveSkillText: RAVAGER_P2 }, 'passive');
        expect(ab.some((a) => a.type === 'buff' && a.trigger === 'on-enemy-destroyed')).toBe(true);
    });

    const MADAX_P2 =
        "This Unit <unit-damage>repairs itself for 13%</unit-damage> of its Max HP when an enemy dies.";
    it('Madax: self-heal-on-enemy-death rides on-enemy-destroyed', () => {
        const ab = abilitiesFor({ firstPassiveSkillText: MADAX_P2 }, 'passive');
        const heal = ab.find((a) => a.type === 'heal');
        expect(heal?.trigger).toBe('on-enemy-destroyed');
        // GAP: tag-only — heal is self-target (no actor needed); the heal builder's reaction chain
        // doesn't recognize "when an enemy dies" → stays on-cast. on-enemy-destroyed trigger exists.
    });

    const OBSIDIAN_P2 =
        'This Unit <unit-aid>adds 2 charges</unit-aid> to its Charged Skill upon killing an enemy.';
    it('Obsidian: charge-on-kill rides on-enemy-destroyed', () => {
        const ab = abilitiesFor({ firstPassiveSkillText: OBSIDIAN_P2 }, 'passive');
        expect(ab.some((a) => a.type === 'charge' && a.trigger === 'on-enemy-destroyed')).toBe(true);
        // GAP: tag-only (detector-recognition) — emits NO ability; the charge builder doesn't
        // detect "upon killing an enemy". Self charge, no actor needed; on-enemy-destroyed exists.
    });

    const VALIANT_P2 =
        'This Unit <unit-aid>gains 1 charge</unit-aid> for its Charged Skill upon killing an enemy.';
    it('Valiant: charge-on-kill rides on-enemy-destroyed', () => {
        const ab = abilitiesFor({ firstPassiveSkillText: VALIANT_P2 }, 'passive');
        expect(ab.some((a) => a.type === 'charge' && a.trigger === 'on-enemy-destroyed')).toBe(true);
        // GAP: tag-only (detector-recognition) — same as Obsidian, emits nothing.
    });

    const RIKRA_P2 =
        'This Unit <unit-damage>repairs 30%</unit-damage> of its Max HP for each enemy Unit destroyed by the attack upon killing them.';
    it('Rikra: self-heal-on-kill rides on-enemy-destroyed', () => {
        const ab = abilitiesFor({ firstPassiveSkillText: RIKRA_P2 }, 'passive');
        const heal = ab.find((a) => a.type === 'heal');
        expect(heal?.trigger).toBe('on-enemy-destroyed');
        // GAP: tag-only — self-target heal on self-kill; heal builder doesn't recognize "upon
        // killing". (Rikra already allowlisted for the ungated against-Taunted damage bonus — distinct.)
    });
});

// ─── cluster 6 — on-bomb-detonated ──────────────────────────────────────────────────────────
describe('cluster 6 — on-bomb-detonated', () => {
    const DEMOLISHER_P2 =
        "When a bomb explodes on an enemy, this unit <unit-aid>removes 2 charges</unit-aid> from the enemy's charged skill.";
    it('Demolisher: charge-removal on bomb-explode already rides on-bomb-detonated (FP lock)', () => {
        const ab = abilitiesFor({ firstPassiveSkillText: DEMOLISHER_P2 }, 'passive');
        const charge = ab.find((a) => a.type === 'charge');
        expect(charge?.trigger).toBe('on-bomb-detonated');
    });

    const VALKYRIE_P2 =
        "When an <unit-aid>Echoing Burst</unit-aid> explodes on an enemy, this Unit and the ally with the lowest current health percentage <unit-damage>repair 5%</unit-damage> of damage dealt.";
    it('Valkyrie: repair on Echoing-Burst detonation rides on-bomb-detonated', () => {
        const ab = abilitiesFor({ firstPassiveSkillText: VALKYRIE_P2 }, 'passive');
        const heal = ab.find((a) => a.type === 'heal');
        expect(heal?.trigger).toBe('on-bomb-detonated');
    });

    const LINGSHE_P3 =
        'When this Unit detonates a <unit-skill>Bomb</unit-skill> it gains <unit-skill>Stealth</unit-skill> for 1 turn.';
    it('Lingshe: Stealth on own-detonation already rides on-bomb-detonated (FP lock)', () => {
        const ab = abilitiesFor({ firstPassiveSkillText: LINGSHE_P3 }, 'passive');
        const buff = ab.find((a) => a.type === 'buff');
        expect(buff?.trigger).toBe('on-bomb-detonated');
    });
});

// ─── cluster 7 — ally-crit / cleanse-reactive / DoT-crit / debuff-resisted ───────────────────
describe('cluster 7 — ally-crit / cleanse-reactive / DoT-crit / debuff-resisted', () => {
    const HOWLER_P2 =
        'This Unit <unit-aid>cleanses 1</unit-aid> debuff from an ally when that ally crits an enemy.';
    it('Howler: cleanse-an-ally-on-that-ally-crit rides on-ally-crit', () => {
        const ab = abilitiesFor({ firstPassiveSkillText: HOWLER_P2 }, 'passive');
        const cleanse = ab.find((a) => a.type === 'cleanse');
        expect(cleanse?.trigger).toBe('on-ally-crit');
        // GAP: needs-capture — cleanse target is "that ally" (the crit-er); on-ally-crit (triggers.ts:441)
        // captures no actor. Cleanse builder only derives on-ally-critically-repaired. Needs which-ally capture.
    });

    const CULTIVATOR_P2 =
        "When this Unit <unit-aid>cleanses a Debuff</unit-aid>, it also <unit-damage>repairs that ally for 4%</unit-damage> of this Unit's Max HP.";
    it('Cultivator: repair-on-own-cleanse is reactive, not on-cast', () => {
        const ab = abilitiesFor({ firstPassiveSkillText: CULTIVATOR_P2 }, 'passive');
        const heal = ab.find((a) => a.type === 'heal');
        expect(heal?.trigger).not.toBe('on-cast');
        // GAP: needs-capture (NEW trigger) — "when this Unit cleanses a debuff" has no self-cleanse
        // reactive trigger; heal targets "that ally" (the cleansed ally) → also needs which-ally capture.
    });

    const HAYYAN_P3 =
        "When a debuff is inflicted on an ally, this Unit <unit-damage>repairs the ally for 6%</unit-damage> of this Unit's Max HP.";
    it('Hayyan: repair-on-ally-debuffed rides on-ally-debuffed', () => {
        const ab = abilitiesFor({ firstPassiveSkillText: HAYYAN_P3 }, 'passive');
        const heal = ab.find((a) => a.type === 'heal');
        expect(heal?.trigger).toBe('on-ally-debuffed');
        // GAP: needs-capture — NEW `on-ally-debuffed` trigger (victim-scoped `debuff-applied`,
        // targetId is the debuffed ally; mirrors self-scoped `on-debuffed`).
    });

    const MORAO_P3 =
        "This Unit <unit-damage>repairs 5%</unit-damage> of its Max HP every turn and, upon <unit-aid>Cleansing a</unit-aid> Debuff, repairs an additional <unit-damage>5%</unit-damage> of its Max HP while gaining <unit-skill>Defense Up II</unit-skill> for 2 turns.";
    it('Morao: repair/buff-on-own-cleanse is reactive, not on-cast', () => {
        const ab = abilitiesFor({ firstPassiveSkillText: MORAO_P3 }, 'passive');
        // Both the extra repair and Defense Up ride "upon cleansing"; today everything is on-cast.
        expect(ab.some((a) => a.trigger !== 'on-cast')).toBe(true);
        // GAP: needs-capture (NEW trigger on-own-cleanse; self-target so no actor). The "every turn"
        // repair is a separate recurring-trigger gap, out of this family.
    });

    const CROCUS_P2 =
        "When another ally inflicts a Damage Over Time (DoT) effect with a critical hit, this Unit <unit-damage>repairs itself for 3%</unit-damage> of its Max HP.";
    it('Crocus: self-repair on ally DoT-crit rides on-ally-crit-dot', () => {
        const ab = abilitiesFor({ firstPassiveSkillText: CROCUS_P2 }, 'passive');
        const heal = ab.find((a) => a.type === 'heal');
        expect(heal?.trigger).toBe('on-ally-crit-dot');
    });

    const VINDICATOR_P3 =
        "When this Unit resists a debuff infliction from an enemy, it deals <unit-damage>damage equal to 30%</unit-damage> of this Unit's max HP to that enemy.";
    it('Vindicator: reactive damage on debuff-resisted rides on-debuff-resisted', () => {
        const ab = abilitiesFor({ firstPassiveSkillText: VINDICATOR_P3 }, 'passive');
        expect(ab.some((a) => a.type === 'damage' && a.trigger === 'on-debuff-resisted')).toBe(true);
        // GAP: DEFERRED (Phase 3 PR-C, 2026-07-04) — two independent infra gaps beyond Layer-1 tag
        // inheritance: (1) no maxHP-scaled damage model — the 'damage' AbilityConfig only carries an
        // attack%-based multiplier (applyReactiveDamage sources ownerStats.attack), so "30% of max HP"
        // cannot be emitted faithfully; (2) no-capturable-actor — the debuff-resisted event carries only
        // targetId (the resister), no source/attacker id, so "that enemy" cannot be resolved. Spec-locked
        // out-of-scope (no-capturable-actor → candidate future work). Probe intentionally left RED.
    });

    const AMARTYA_P2 =
        'When an enemy defender is directly repaired, this Unit inflicts 1 stack of <unit-skill>Defense Shred</unit-skill> on that defender.';
    it('Amartya: Defense-Shred on repaired-enemy-defender rides on-enemy-repaired', () => {
        const ab = abilitiesFor({ firstPassiveSkillText: AMARTYA_P2 }, 'passive');
        const debuff = ab.find((a) => a.type === 'debuff');
        expect(debuff?.trigger).toBe('on-enemy-repaired');
        // GAP: needs-capture — target is "that defender" = the REPAIRED recipient, not the repairer.
        // on-enemy-repaired captures repairerId (the performer), not the recipient. Needs recipient capture.
    });

    const APEX_P2 =
        'This Unit gains a <unit-damage>Shield equal to 3%</unit-damage> of their Max HP when an enemy gets debuffed.';
    it('APEX: shield-on-enemy-debuffed already rides on-debuff-inflicted (FP lock)', () => {
        const ab = abilitiesFor({ firstPassiveSkillText: APEX_P2 }, 'passive');
        const shield = ab.find((a) => a.type === 'shield');
        expect(shield?.trigger).toBe('on-debuff-inflicted');
    });
});

// ─── cluster 8 — target-has-shield CONDITION (out of reactive-trigger family) ────────────────
describe('cluster 8 — target-has-shield (Malvex): condition, not a trigger', () => {
    const MALVEX_ACTIVE =
        'This Unit deals <unit-damage>220% damage</unit-damage> with additional damage equal to <unit-damage>12%</unit-damage> of its current Shield and removes 30% of the enemy’s Shield. If the target has a Shield, it gains <unit-skill>Barrier</unit-skill> for 1 hit.';
    it('Malvex: Barrier grant is correctly on-cast — the gap is a target-has-shield CONDITION, not a trigger', () => {
        const ab = abilitiesFor({ activeSkillText: MALVEX_ACTIVE }, 'active');
        const buff = ab.find((a) => a.type === 'buff');
        // The Barrier buff IS an on-cast active-skill effect (correct trigger). This probe documents
        // that Malvex is OUT-OF-FAMILY for reactive-trigger promotion: "If the target has a Shield"
        // is a conditional gate (a target-state condition), not a reactive trigger. Deferred to
        // condition-gate work (allowlisted). GREEN by design — no trigger gap here.
        expect(buff?.trigger).toBe('on-cast');
    });
});
