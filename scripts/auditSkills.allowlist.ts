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
    /** True when the entry suppresses text only the official catalogue carries (the sync gate in
     *  scripts/lib/skillTextGate.ts relies on it), so the CSV audit never consults it and the
     *  stale-entry report must not flag it. */
    catalogueOnly?: boolean;
}

export const ALLOWLIST: AllowEntry[] = [
    {
        ship: 'Lingshe',
        rules: ['detonation'],
        reason: 'detonation: crit-scaling Bomb detonation (charged skill\'s countdown-reduction rider is modelled as `bomb-countdown-reduce`, but the crit-power-scaled "detonation damage" modifier on passive2/3 is not a detonate-dot consumption). The passive2/3 "gains Stealth on detonating a Bomb" grant rides on-self-bomb-detonated, and passive1\'s "When this Unit inflicts a Bomb it gains Stealth" rides on-debuff-inflicted narrowed to Bomb (triggerStatusFilter).',
    },

    // ── ungated-effect-with-trigger: intentionally not auto-gated ───────────────
    // Reactive triggers (on-cleanse / on-kill / on-damaged / enemy-uses-charged / on-resist /
    // on-death) — modelled manually by the user, never auto-derived in single-ship DPS.
    // Niche counts / conversions / clause-split false positives.
    {
        ship: 'Oleander',
        rules: ['ungated-effect-with-trigger'],
        reason: 'Trigger ("per debuffed enemy") scopes the repair, not the buff.',
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

    // ── epic PR12(A): damage-reflection rule — audit-harness scoping false positive ──
    // The audit's `abilitiesFor` helper always parses a slot's text as the ACTIVE skill
    // (scripts/auditSkills.ts:113-117), regardless of the CSV column it came from — there is
    // no slot-aware harness path (the same reason no `counter` rule exists for the
    // Stalwart/Nyxen/Centurion passive-gated counterattacks). Nosorog's reflect wiring is
    // correctly gated `slot === 'passive'` in buildShipAbilities (production routes it via the
    // real ship's `secondPassiveSkillText`/`thirdPassiveSkillText`, verified in
    // buildShipAbilities.test.ts's epic PR12(A) describe block) — it is simply invisible to
    // this harness's active-only re-parse, not a missing gate.
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

    // ── defense-penetration-innate: handled at the DATA layer, not the parser ────
    // "This Unit has X% defense penetration" describes the refit ascension stat (user ruling
    // 2026-10-02), which the ship's stats already carry; parsing the clause would double-count.
    // Verified against the official catalogue's ascensionStats: Judge DefensePenetration 0.2 at
    // level 0 (innate), Ravager 0.1 at level 2. Ravager's entry only suppresses the catalogue
    // text ("This Unit has 10% defense penetration"); ours reads "ignores 10% of Defense".
    ...['Judge', 'Ravager'].map((ship) => ({
        ship,
        rules: ['defense-penetration-innate'],
        reason: 'Defense penetration is the refit ascension stat the ship already carries.',
        ...(ship === 'Ravager' ? { catalogueOnly: true } : {}),
    })),

    // Burst-explosion reference — not an accumulate-detonate application.
    {
        ship: 'Valkyrie',
        rules: ['accumulate-detonate'],
        reason: 'Passive mentions "When an Echoing Burst explodes" as a heal-on-burst reaction, not an infliction. The charged skill correctly parses the accumulate-detonate; the passive reference is filtered by the parser guard.',
    },
];
