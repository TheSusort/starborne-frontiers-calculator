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
        reason: 'detonation: countdown-reduction + crit-scaling Bomb detonation (charged skill), plus the crit-power-scaled "detonation damage" modifier (passive2/3) — neither is a detonate-dot consumption. The passive2/3 "gains Stealth on detonating a Bomb" grant carries an on-bomb-detonated trigger (not ungated). ungated-effect-with-trigger: passive1\'s "When this Unit inflicts a Bomb it gains Stealth" is a reactive on-self-inflicting-a-DoT trigger the parser does not derive (distinct from the detonate trigger above) — modelled manually.',
    },

    // ── ungated-effect-with-trigger: intentionally not auto-gated ───────────────
    // Reactive triggers (on-cleanse / on-kill / on-damaged / enemy-uses-charged / on-resist /
    // on-death) — modelled manually by the user, never auto-derived in single-ship DPS.
    {
        ship: 'Ravager',
        rules: ['ungated-effect-with-trigger'],
        reason: 'Reactive: when its debuff is resisted.',
    },
    {
        ship: 'Curator',
        rules: ['ungated-effect-with-trigger'],
        reason: 'Reactive: when an enemy uses its Charged skill.',
    },
    {
        ship: 'Paracelsus',
        rules: ['ungated-effect-with-trigger'],
        reason: 'Reactive: on being killed.',
    },
    {
        ship: 'Yazid',
        rules: ['ungated-effect-with-trigger'],
        reason: 'Recurring/reactive: start of combat / Cheat Death.',
    },
    {
        ship: 'Nosorog',
        rules: ['ungated-effect-with-trigger'],
        reason: 'Reactive: when this Unit removes a debuff.',
    },
    // Self-HP / stat-comparison gates — not modelled (sim assumes full HP, no stat comparisons).
    // (Hermes's "If the target has less than N% HP" Cheat-Death gate is now parser-modeled —
    // Phase 4c PR 3, detectTargetHpGate — so it no longer needs an allowlist entry.)
    {
        ship: 'Bayah',
        rules: ['ungated-effect-with-trigger'],
        reason: 'Stat comparison gate (Crit Power vs target).',
    },
    // Niche counts / conversions / clause-split false positives.
    {
        ship: 'Belladonna',
        rules: ['ungated-effect-with-trigger'],
        reason: 'Crit-power extension now parsed; remaining: named-DoT count (3+ Acidic Decay → Stasis) + Corrosion→Acidic Decay conversion (team mode).',
    },
    {
        ship: 'Berserker',
        rules: ['ungated-effect-with-trigger'],
        reason: 'Multi-target count ("hitting 3+ enemies").',
    },
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
    // from it. Modeling the actual incoming-reduction mechanic is deferred to epic PR12
    // (incoming-reduction phrasings: Anemone/Panon/Wusheng/Tormenter).
    {
        ship: 'Tormenter',
        rules: ['base-damage'],
        reason: 'passive2 "gains up to 30% damage reduction as its health decreases" is HP-scaled incoming damage reduction, not an attack — deferred to epic PR12 (incoming-reduction phrasings).',
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
    ].map((ship) => ({
        ship,
        rules: ['shield-penetration-innate'],
        reason: 'Shield penetration already filled as a ship stat by import/template data.',
    })),

    // Burst-explosion reference — not an accumulate-detonate application.
    {
        ship: 'Valkyrie',
        rules: ['accumulate-detonate'],
        reason:
            'Passive mentions "When an Echoing Burst explodes" as a heal-on-burst reaction, not an infliction. The charged skill correctly parses the accumulate-detonate; the passive reference is filtered by the parser guard.',
    },
];
