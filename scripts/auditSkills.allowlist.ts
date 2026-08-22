/**
 * Intentionally-unmodelled coverage findings, kept out of the audit report.
 * Add an entry when a flagged mechanic is deliberately not parsed (out of scope for
 * single-ship DPS, a game bug, or a one-off too complex to generalise).
 *
 * Each entry suppresses the listed rule ids for one ship. Keep a short reason.
 */
export interface AllowEntry {
    ship: string;
    rules: string[];
    reason: string;
}

export const ALLOWLIST: AllowEntry[] = [
    {
        ship: 'Lingshe',
        rules: ['detonation', 'ungated-effect-with-trigger'],
        reason: 'detonation: crit-scaling Bomb detonation (charged skill\'s countdown-reduction rider is now modelled — SP-F F3, `bomb-countdown-reduce` — but the crit-power-scaled "detonation damage" modifier on passive2/3 is not a detonate-dot consumption). The passive2/3 "gains Stealth on detonating a Bomb" grant carries an on-bomb-detonated trigger (not ungated). ungated-effect-with-trigger: passive1\'s "When this Unit inflicts a Bomb it gains Stealth" is a reactive on-self-inflicting-a-DoT trigger the parser does not derive (distinct from the detonate trigger above) — modelled manually.',
    },

    // ── ungated-effect-with-trigger: intentionally not auto-gated ───────────────
    // Reactive triggers (on-cleanse / on-kill / on-damaged / enemy-uses-charged / on-resist /
    // on-death) — modelled manually by the user, never auto-derived in single-ship DPS.
    {
        ship: 'Rikra',
        rules: ['ungated-effect-with-trigger'],
        reason: 'Charged Defense Up II is granted UNCONDITIONALLY; the "against Taunted or Provoked enemies" trigger words in the same sentence gate the co-located +80% damage BONUS (parser-modeled as an enemy-effect scaling condition on the damage ability, PR6a), not the buff. clauseFor scopes the whole sentence, so the audit sees "against" beside the ungated buff — a scoping false flag, not a missing gate.',
    },
    // Self-HP / stat-comparison gates — not modelled (sim assumes full HP, no stat comparisons).
    // (Hermes's "If the target has less than N% HP" Cheat-Death gate is now parser-modeled —
    // Phase 4c PR 3, detectTargetHpGate — so it no longer needs an allowlist entry. Bayah's
    // Crit-Power-vs-target Stasis gate is now parser-modeled too — SP-C, detectGrantConditions'
    // stat-vs-target detector — so its entry is likewise removed.)
    // Niche counts / conversions / clause-split false positives.
    {
        ship: 'Oleander',
        rules: ['ungated-effect-with-trigger'],
        reason: 'Trigger ("per debuffed enemy") scopes the repair, not the buff.',
    },
    {
        ship: 'Madax',
        rules: ['ungated-effect-with-trigger'],
        reason: '"while this Unit deals…" is simultaneity, not a gate.',
    },

    // ── always-crit: handled at the DATA layer, not the parser ──────────────────
    // These ships' crit rate is set to 100% by the game-data import, so the "always
    // critical" clause needs no ability-model flag (a flag would double-count).
    {
        ship: 'Asphodel',
        rules: ['always-crit'],
        reason: 'Crit rate set to 100% in import data; parser flag would double-count.',
    },
    {
        ship: 'Tormenter',
        rules: ['always-crit'],
        reason: 'Crit rate set to 100% in import data; parser flag would double-count.',
    },

    // ── base-damage: incoming-reduction clause, not an attack (epic PR1) ────────
    // "gains up to 30% damage reduction as its health decreases" matches the base-damage
    // keyword regex (contains "N% damage") but is HP-scaled incoming damage reduction, not an
    // attack — PR1 fixed parseSkillDamage to stop minting a phantom on-cast damage{30} ability
    // from it. The actual incoming-reduction mechanic is now modeled (epic PR12(C),
    // hpScaling on the `incoming-reduction` ability config) — this entry stays because the
    // `base-damage` rule's keyword still matches the "N% damage" substring and the clause is
    // STILL correctly not a damage ability (it's incoming-reduction instead); the new
    // `incoming-damage-reduction` rule confirms it IS handled.
    {
        ship: 'Tormenter',
        rules: ['base-damage'],
        reason: 'passive2 "gains up to 30% damage reduction as its health decreases" is HP-scaled incoming damage reduction, not an attack — modeled via `incoming-reduction`.hpScaling (epic PR12(C)), never a `damage` ability.',
    },

    // ── epic PR12(A): damage-reflection rule — audit-harness scoping false positive ──
    // The audit's `abilitiesFor` helper always parses a slot's text as the ACTIVE skill
    // (scripts/auditSkills.ts:113-117), regardless of the CSV column it came from — there is
    // no slot-aware harness path (the same reason no `counter` rule exists for the
    // Stalwart/Nyxen/Centurion passive-gated counterattacks). Nosorog's reflect wiring is
    // correctly gated `slot === 'passive'` in buildShipAbilities (production routes it via the
    // real ship's `secondPassiveSkillText`/`thirdPassiveSkillText`, verified in
    // buildShipAbilities.test.ts's epic PR12(A) describe block) — it is simply invisible to
    // this harness's active-only re-parse, not a missing gate (mirrors the Rikra
    // clauseFor-scoping precedent above).
    {
        ship: 'Nosorog',
        rules: ['damage-reflection'],
        reason: "Passive-gated (buildShipAbilities checks slot === 'passive'); the audit harness's abilitiesFor always re-parses text as the ACTIVE slot, so the reflect ability never builds under audit even though production (real Ship with secondPassiveSkillText/thirdPassiveSkillText) handles it correctly — a harness scoping false flag, not a missing gate.",
    },

    // ── shield-penetration-innate: handled at the DATA layer, not the parser ─────
    // "This Unit has X% Shield Penetration" ships already carry shield penetration as a
    // filled ship stat (import/template data); parsing the clause would double-count.
    ...[
        'Crucialis',
        'Curator',
        'FrontLine',
        'Guardian',
        'Liberator',
        'Medved',
        'Provider',
        'Sustainer',
        'Vindicator',
        'Xcellence',
        // Prophet (#361): stat VERIFIED against docs/ship-data.json — shieldPenetration 45,
        // matching its R4 "has 45% shield penetration" exactly, so parsing it would double-count
        // as the rule intends. NOTE this entry covers the INNATE clause only; Prophet's sibling
        // "when an ally resists a debuff infliction, this Unit gains 2% MORE shield penetration"
        // is a permanently accumulating stat gain that is still unmodelled and tracked on #361 —
        // it is a different clause and this allowlist entry is not a claim about it.
        'Prophet',
    ].map((ship) => ({
        ship,
        rules: ['shield-penetration-innate'],
        reason: 'Shield penetration already filled as a ship stat by import/template data.',
    })),

    // ── incoming-damage-reduction: the corpus's first ALLY-SCOPED reduction aura ──
    {
        ship: 'Fuying',
        rules: ['incoming-damage-reduction'],
        reason: "#363: \"All Tianchao allies with Stealth take 30% less direct damage\" is an aura on OTHER ships, gated on BOTH faction and a status. Every other ship this rule matches (Iridium/Anemone/Wusheng/Panon/Tormenter) reduces damage on ITSELF, which the 'incoming-reduction' ability type models; an ally-scoped, faction-and-status-gated aura needs plumbing that does not exist yet. Allowlisted as unmodelled, NOT as intentional: the modelling is tracked on #363. The separate defect where this clause was mis-parsed as a 30% outgoing ATTACK is fixed.",
    },

    // Burst-explosion reference — not an accumulate-detonate application.
    {
        ship: 'Valkyrie',
        rules: ['accumulate-detonate'],
        reason: 'Passive mentions "When an Echoing Burst explodes" as a heal-on-burst reaction, not an infliction. The charged skill correctly parses the accumulate-detonate; the passive reference is filtered by the parser guard.',
    },

    // extend-status: genuine gap, out of scope for ship-kit wave 4 (Sokol/Ripper/Lev only).
    {
        ship: 'Asphyxiator',
        rules: ['extend-status'],
        reason: 'passive3: "After this Unit applies a Debuff with a Critical hit the newly applied Debuff is extended by 1 turn" is a single-target, on-crit-gated extend of the JUST-APPLIED debuff — a different shape from wave 4\'s generic all-debuffs/all-buffs extend (Sokol/Ripper/Lev). Deferred to a later wave.',
    },
];
