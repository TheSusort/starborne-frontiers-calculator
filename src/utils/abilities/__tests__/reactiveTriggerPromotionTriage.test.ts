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

    it('Quixilver: reactive shield-on-hit rides on-attacked', () => {
        const abilities = abilitiesFor({ firstPassiveSkillText: QUIXILVER_PASSIVE }, 'passive');
        const shield = abilities.find((a) => a.type === 'shield');
        expect(shield?.trigger).toBe('on-attacked');
        // GAP: tag-only — the shield builder never calls detectDamageReactionTrigger at all
        // (no reaction path), unlike the buff/debuff/heal builders which already fall back to it.
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

    it('Malvex: reactive shield-on-hit (primary-target clause) rides on-attacked', () => {
        const abilities = abilitiesFor({ firstPassiveSkillText: MALVEX_PASSIVE }, 'passive');
        const shield = abilities.find((a) => a.type === 'shield');
        expect(shield?.trigger).toBe('on-attacked');
        // GAP: tag-only — same shield-builder-has-no-reaction-path gap as Quixilver. (The
        // "as a primary target" qualifier is a separate, not-yet-modeled condition/capture
        // concern for a follow-on fix-PR, out of scope for this trigger probe.)
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
