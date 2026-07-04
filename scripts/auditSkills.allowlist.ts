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
        rules: ['detonation', 'ungated-effect-with-trigger', 'debuff-duration-reduction'],
        reason: 'detonation: countdown-reduction + crit-scaling Bomb detonation (charged skill), plus the crit-power-scaled "detonation damage" modifier (passive2/3) — neither is a detonate-dot consumption. The passive2/3 "gains Stealth on detonating a Bomb" grant carries an on-bomb-detonated trigger (not ungated). ungated-effect-with-trigger: passive1\'s "When this Unit inflicts a Bomb it gains Stealth" is a reactive on-self-inflicting-a-DoT trigger the parser does not derive (distinct from the detonate trigger above) — modelled manually. debuff-duration-reduction (epic PR11): the charge skill\'s "reduces all Bombs on the enemy targets by 1 turn, Bombs reduced to 0 turns by this skill will detonate. This reduction effect requires hacking." is a STRUCTURALLY DIFFERENT mechanic from Heliodor/Pestilence\'s generic timed-debuff-store shrink this rule otherwise catches: it targets the ENEMY\'s PendingBomb countdown (a separate container from the generic debuff store the new engine primitive touches), carries a hacking-vs-security landing gate with no established precedent for a duration-MODIFYING (vs debuff-INFLICTING) action, and a forced-immediate-detonation-at-zero rider that would need to reach into the detonation payout/attribution pipeline outside the normal per-round tick cadence. Reducing the countdown WITHOUT the immediate-detonation rider is not a faithful partial model (the bomb would sit at 0 turns, undetonated, until an unrelated natural tick) — a "one-off too complex to generalise" per this file\'s own convention (mirrors the Panon instead-branch precedent, PR6b). Revisit if Lingshe becomes a priority ship.',
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
        ship: 'Nosorog',
        rules: ['ungated-effect-with-trigger'],
        reason: 'Reactive: when this Unit removes a debuff.',
    },
    {
        ship: 'Panon',
        rules: ['instead-replacement'],
        reason: 'Active + charged carry an "If this Unit is Provoked or Taunted, it instead gains <buff> and deals <higher>% damage" full-branch replacement (the only such shape in the corpus). Deferred (PR6b, user decision): a faithful model needs complementary/negated self-conditions AND sim damage-branch selection (the sim reads only the first damage ability) — bespoke infra for one ship. The base branch is already correct in single-ship DPS (self never Provoked/Taunted); only the combat-sim Provoked/Taunted state is imperfect. Revisit as a dedicated design if a second "instead"-branch ship appears.',
    },
    {
        ship: 'Rikra',
        rules: ['ungated-effect-with-trigger'],
        reason: 'Charged Defense Up II is granted UNCONDITIONALLY; the "against Taunted or Provoked enemies" trigger words in the same sentence gate the co-located +80% damage BONUS (parser-modeled as an enemy-effect scaling condition on the damage ability, PR6a), not the buff. clauseFor scopes the whole sentence, so the audit sees "against" beside the ungated buff — a scoping false flag, not a missing gate.',
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
        reason: 'Passive mentions "When an Echoing Burst explodes" as a heal-on-burst reaction, not an infliction. The charged skill correctly parses the accumulate-detonate; the passive reference is filtered by the parser guard.',
    },
];
