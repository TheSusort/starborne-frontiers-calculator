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
        rules: ['detonation'],
        reason: 'Countdown-reduction + crit-scaling Bomb detonation (charged skill). The "gains Stealth on detonating a Bomb" passive now carries an on-bomb-detonated trigger (no longer ungated). (NOTE: currently a multi-line CSV record dropped by the audit reader — kept until the reader is fixed.)',
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
        reason: 'Reactive: when an enemy uses its Charged skill. (NOTE: currently a multi-line CSV record dropped by the audit reader — kept until the reader is fixed.)',
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

    // Burst-explosion reference — not an accumulate-detonate application.
    {
        ship: 'Valkyrie',
        rules: ['accumulate-detonate'],
        reason:
            'Passive mentions "When an Echoing Burst explodes" as a heal-on-burst reaction, not an infliction. The charged skill correctly parses the accumulate-detonate; the passive reference is filtered by the parser guard.',
    },
];
