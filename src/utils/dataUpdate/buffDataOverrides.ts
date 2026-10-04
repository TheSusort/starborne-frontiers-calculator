/**
 * Hand corrections to the upstream buff data that `npm run fetch-buffs` (updateBuffsData.ts)
 * re-applies after every fetch, so a regen cannot revert them. Each value here must also be what
 * `src/constants/buffs.ts` holds today — `buffDataOverrides.test.ts` fails when they differ.
 *
 * The official unit catalogue (starborne.com/frontiers/units, `statusEffects`) is the source for
 * every tier-magnitude correction below; the upstream fetch source has these tiers wrong.
 */
export const MANUAL_DESCRIPTION_OVERRIDES: Record<string, string> = {
    // The in-app tooltip for the bomb, including its destroyed-before-expiry splash (#161).
    'Bomb III':
        'Deals 300% Damage upon expiration. If this ship is destroyed before expiring it instead deals 75% damage to all adjacent ships. Detonation damage bypasses defense.',
    // Catalogue: "Increases Speed by 15/30/45%."
    'Speed Up I': '+15% Speed',
    // Catalogue: "Increases Security by 10/20/30 and Defense by 5/10/15%."
    'Binderburg Resilience I': '+10 Security, +5% Defense',
    'Binderburg Resilience II': '+20 Security, +10% Defense',
    // Catalogue: "Increases Incoming Repair by 10/20/30% and Security by 10/15/20"
    'Everliving Regeneration I': '+10% Incoming Repair, +10 Security',
    'Everliving Regeneration II': '+20% Incoming Repair, +15 Security',
    // Catalogue: "Increase outgoing detonation damage by 10/20/30%."
    'Out. Detonation Damage Up III': '+30% Outgoing Detonation Damage',
};

/**
 * Buff/debuff classification corrections. The catalogue files `Inc. DoT Damage Up` under
 * `kind: "Debuff"` ("Increases incoming DoT (Damage over Time) damage by 10/20/30%"); the upstream
 * fetch types it as a buff. The skill-text parser reads this type to put an "applies X" or an
 * "enemies with X" clause on the right side.
 */
export const MANUAL_TYPE_OVERRIDES: Record<string, 'buff' | 'debuff' | 'effect'> = {
    'Inc. DoT Damage Up I': 'debuff',
    'Inc. DoT Damage Up II': 'debuff',
    'Inc. DoT Damage Up III': 'debuff',
};
